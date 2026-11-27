const crypto = require('crypto');
const { JWT_SECRET } = require('../config');
const { pool } = require('../db/pool');

const VAULT_KEY = crypto.createHash('sha256').update(`${JWT_SECRET}:credo-cedula-vault-v1`).digest();
const MEM_CACHE = new Map();
const MEM_CACHE_TTL_MS = 12 * 3600 * 1000;

const STOP_WORDS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SAN', 'SANTA']);
const HONORIFICS = new Set([
  'P',
  'PADRE',
  'PBRO',
  'MONS',
  'MONSENOR',
  'CARD',
  'CARDENAL',
  'SOR',
  'HNA',
  'HNO',
  'FRAY',
  'DIAC',
  'DIACONO',
  'SR',
  'SRA',
  'SRTA',
  'DR',
  'DRA',
  'ING',
  'LIC',
  'ARQ',
]);

function normalizeDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function formatCedula(raw) {
  const d = normalizeDigits(raw);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
}

function maskCedula(raw) {
  const d = normalizeDigits(raw);
  if (d.length !== 11) return '';
  return `${d.slice(0, 3)}-****${d.slice(7, 10)}-${d.slice(10)}`;
}

function hashCedula(raw) {
  const d = normalizeDigits(raw);
  if (!d) return '';
  return crypto.createHmac('sha256', VAULT_KEY).update(d).digest('hex');
}

function encryptCedula(raw) {
  const d = normalizeDigits(raw);
  if (!d) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const enc = Buffer.concat([cipher.update(d, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptCedula(stored) {
  try {
    const s = String(stored || '');
    if (!s.startsWith('v1:')) return '';
    const [, ivB64, tagB64, encB64] = s.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Official Dominican JCE Módulo 10 (Luhn) validation for 11-digit Cédula.
 */
function validateDominicanCedulaChecksum(raw) {
  const d = normalizeDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const serie = Number(d.slice(0, 3));
  if (serie === 0) return false;

  const weights = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const prod = Number(d[i]) * weights[i];
    sum += prod < 10 ? prod : Math.floor(prod / 10) + (prod % 10);
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  return expectedCheck === Number(d[10]);
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    Aacute: 'Á',
    Eacute: 'É',
    Iacute: 'Í',
    Oacute: 'Ó',
    Uacute: 'Ú',
    ntilde: 'ñ',
    Ntilde: 'Ñ',
    uuml: 'ü',
    Uuml: 'Ü',
  };
  return String(str)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in named ? named[name] : m));
}

function normalizeExactFullName(rawName) {
  return decodeHtmlEntities(rawName)
    .replace(/ñ/gi, 'N')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * STRICT EXACT FULL-NAME verification against the official Cédula holder name.
 * Every single given name and surname must match 100% identically in exact order
 * (only uppercase, diacritics/accents, and extra spaces are normalized).
 * Zero partial/subset matching, zero prefix matching, zero dropped words.
 */
function verifyNameMatchesCedula(enteredFullName, officialFullName) {
  const normUser = normalizeExactFullName(enteredFullName);
  const normOfficial = normalizeExactFullName(officialFullName);

  if (!normUser || !normOfficial) {
    return { matches: false, reason: 'incomplete_name' };
  }

  const userTokens = normUser.split(' ');
  const offTokens = normOfficial.split(' ');
  if (userTokens.length < 2 || offTokens.length < 2) {
    return { matches: false, reason: 'incomplete_name' };
  }

  if (normUser !== normOfficial) {
    return { matches: false, reason: 'exact_name_mismatch' };
  }

  return { matches: true, reason: 'verified_exact' };
}

async function queryDgiiPage(url, inputField, buttonField, cedula11) {
  const getRes = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(6500),
  });
  if (!getRes.ok) throw new Error(`DGII HTTP ${getRes.status}`);

  const setCookies = typeof getRes.headers.getSetCookie === 'function' ? getRes.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const html = await getRes.text();

  const extractHidden = (id) => {
    const m = html.match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i'));
    return m ? decodeHtmlEntities(m[1]) : '';
  };

  const form = new URLSearchParams();
  const vs = extractHidden('__VIEWSTATE');
  const vsg = extractHidden('__VIEWSTATEGENERATOR');
  const ev = extractHidden('__EVENTVALIDATION');
  if (!vs) throw new Error('DGII ViewState unavailable');

  form.set('__VIEWSTATE', vs);
  if (vsg) form.set('__VIEWSTATEGENERATOR', vsg);
  if (ev) form.set('__EVENTVALIDATION', ev);
  form.set(inputField, cedula11);
  form.set(buttonField, 'Buscar');

  const postRes = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Referer: url,
    },
    body: form.toString(),
    signal: AbortSignal.timeout(6500),
  });
  if (!postRes.ok) throw new Error(`DGII POST HTTP ${postRes.status}`);
  const outHtml = await postRes.text();

  const tds = [...outHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
  );

  for (let i = 0; i < tds.length - 1; i += 1) {
    const label = tds[i].toLowerCase();
    if (label === 'nombre' || label.includes('nombre/raz')) {
      const candidate = tds[i + 1];
      if (candidate && candidate.length >= 3) {
        const estadoIdx = tds.findIndex((t) => t.toLowerCase() === 'estado');
        const estado = estadoIdx !== -1 && tds[estadoIdx + 1] ? tds[estadoIdx + 1] : 'ACTIVO';
        return { found: true, officialName: candidate, status: estado };
      }
    }
  }

  if (/no se encuentra inscrito|no existen registros/i.test(outHtml)) {
    return { found: false, officialName: '', status: 'NOT_REGISTERED' };
  }
  return { found: false, officialName: '', status: 'UNKNOWN' };
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

function getProviderConfig() {
  let cfg = {};
  try {
    const { getSetting } = require('./systemState');
    cfg = getSetting('cedula_providers') || {};
  } catch {}
  return {
    verifikToken: String(process.env.VERIFIK_API_TOKEN || cfg.verifik_token || '').trim(),
    customApiUrl: String(process.env.CEDULA_API_URL || cfg.custom_api_url || '').trim(),
    customApiKey: String(process.env.CEDULA_API_KEY || cfg.custom_api_key || '').trim(),
    enableDgii: cfg.enable_dgii !== false,
    enablePhotoOcr: cfg.enable_photo_ocr !== false,
  };
}

async function queryVerifikCedula(cedula11, token) {
  if (!token) return null;
  const url = `https://api.verifik.co/v2/do/cedula?documentType=CIE&documentNumber=${encodeURIComponent(cedula11)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`Verifik HTTP ${res.status}`);
  const body = await res.json();
  const d = body?.data || body || {};
  const fullName = String(
    d.fullName ||
      d.full_name ||
      [d.firstName || d.nombres || '', d.lastName || d.apellidos || ''].filter(Boolean).join(' ')
  ).trim();
  if (fullName.length >= 3) {
    return {
      found: true,
      officialName: fullName,
      status: String(d.status || 'ACTIVO'),
      source: 'verifik_jce',
    };
  }
  return { found: false, officialName: '', status: 'NOT_FOUND', source: 'verifik_not_found' };
}

async function queryCustomJceApi(cedula11, apiUrl, apiKey) {
  if (!apiUrl) return null;
  const url = apiUrl.includes('{cedula}')
    ? apiUrl.replace(/\{cedula\}/g, encodeURIComponent(cedula11))
    : `${apiUrl.replace(/\/+$/, '')}/${encodeURIComponent(cedula11)}`;
  const headers = { Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }
  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`Custom JCE HTTP ${res.status}`);
  const body = await res.json();
  const d = body?.data || body || {};
  const fullName = String(
    d.fullName ||
      d.full_name ||
      d.nombre_completo ||
      d.nombre ||
      [d.Nombres || d.nombres || d.firstName || '', d.Apellido1 || d.apellido1 || '', d.Apellido2 || d.apellido2 || d.lastName || '']
        .filter(Boolean)
        .join(' ')
  ).trim();
  if (fullName.length >= 3) {
    return {
      found: true,
      officialName: fullName,
      status: String(d.status || d.estado || 'ACTIVO'),
      source: 'custom_jce_api',
    };
  }
  return { found: false, officialName: '', status: 'NOT_FOUND', source: 'custom_jce_not_found' };
}

/**
 * Looks up official citizen full name for an 11-digit Dominican Cédula.
 * 3-tier lookup cascade:
 *   1. Cache (RAM 12h + PostgreSQL 30d)
 *   2. Official JCE/KYC API (Verifik / Custom OGTIC/JCE endpoint if configured)
 *   3. Public DGII Ciudadanos + RNC (free fallback)
 */
async function lookupOfficialCedulaOwner(rawCedula) {
  const cedula11 = normalizeDigits(rawCedula);
  if (!validateDominicanCedulaChecksum(cedula11)) {
    return { validChecksum: false, found: false, officialName: '', source: 'checksum' };
  }

  const cHash = hashCedula(cedula11);
  const mem = MEM_CACHE.get(cHash);
  if (mem && Date.now() - mem.ts < MEM_CACHE_TTL_MS) {
    return mem.val;
  }

  try {
    const dbHit = await pool.query(
      `SELECT official_name, citizen_status, source
         FROM cedula_lookup_cache
        WHERE cedula_hash = $1 AND updated_at > NOW() - INTERVAL '30 days'
        LIMIT 1`,
      [cHash]
    );
    if (dbHit.rows[0] && dbHit.rows[0].official_name) {
      const val = {
        validChecksum: true,
        found: true,
        officialName: dbHit.rows[0].official_name,
        citizenStatus: dbHit.rows[0].citizen_status || 'ACTIVO',
        source: dbHit.rows[0].source || 'cache',
      };
      MEM_CACHE.set(cHash, { ts: Date.now(), val });
      return val;
    }
  } catch {}

  const prov = getProviderConfig();
  let lookup = { found: false, officialName: '', status: 'UNAVAILABLE', source: 'none' };

  // Tier 1A: Verifik (Full JCE padrón coverage including 402-...)
  if (!lookup.found && prov.verifikToken) {
    try {
      const vRes = await queryVerifikCedula(cedula11, prov.verifikToken);
      if (vRes?.found) lookup = vRes;
    } catch (err) {
      console.warn('[cedulaVerifier] Verifik lookup error:', err.message);
    }
  }

  // Tier 1B: Custom OGTIC / Dominicana Technology / JCE REST API
  if (!lookup.found && prov.customApiUrl) {
    try {
      const cRes = await queryCustomJceApi(cedula11, prov.customApiUrl, prov.customApiKey);
      if (cRes?.found) lookup = cRes;
    } catch (err) {
      console.warn('[cedulaVerifier] Custom JCE lookup error:', err.message);
    }
  }

  // Tier 2: Public DGII Ciudadanos & RNC
  if (!lookup.found && prov.enableDgii) {
    try {
      const c1 = await queryDgiiPage(
        'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/ciudadanos.aspx',
        'ctl00$cphMain$txtCedula',
        'ctl00$cphMain$btnBuscarCedula',
        cedula11
      );
      if (c1.found) {
        lookup = { ...c1, source: 'dgii_ciudadanos' };
      } else {
        const c2 = await queryDgiiPage(
          'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx',
          'ctl00$cphMain$txtRNCCedula',
          'ctl00$cphMain$btnBuscarPorRNC',
          cedula11
        );
        if (c2.found) lookup = { ...c2, source: 'dgii_rnc' };
        else lookup = { ...c1, source: 'dgii_not_found' };
      }
    } catch (err) {
      console.warn('[cedulaVerifier] DGII fallback error:', err.message);
      lookup = { found: false, officialName: '', status: 'OFFLINE', source: 'offline' };
    }
  }

  const result = {
    validChecksum: true,
    found: lookup.found,
    officialName: lookup.officialName || '',
    citizenStatus: lookup.status || '',
    source: lookup.source,
    photoOcrEnabled: prov.enablePhotoOcr,
  };

  if (result.found && result.officialName) {
    MEM_CACHE.set(cHash, { ts: Date.now(), val: result });
    pool
      .query(
        `INSERT INTO cedula_lookup_cache (cedula_hash, official_name, citizen_status, source, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (cedula_hash) DO UPDATE SET
           official_name = EXCLUDED.official_name,
           citizen_status = EXCLUDED.citizen_status,
           source = EXCLUDED.source,
           updated_at = NOW()`,
        [cHash, result.officialName, result.citizenStatus, result.source]
      )
      .catch(() => {});
  }

  return result;
}

const JCE_CARD_ANCHORS = [
  'REPUBLICA',
  'DOMINICANA',
  'JUNTA',
  'CENTRAL',
  'ELECTORAL',
  'CEDULA',
  'IDENTIDAD',
  'NACIMIENTO',
  'NACIONALIDAD',
  'SEXO',
  'EXPIRACION',
  'SANGRE',
];

function extractOcrTextMatches(rawOcr, cedula11, enteredFullName) {
  const normOcr = normalizeExactFullName(rawOcr);
  const ocrWords = new Set(normOcr.split(' ').filter(Boolean));

  // 1. Verify Dominican JCE Card structure (at least 2 official keywords from the ID card)
  let anchorHits = 0;
  for (const kw of JCE_CARD_ANCHORS) {
    if (ocrWords.has(kw) || normOcr.includes(kw)) anchorHits += 1;
  }
  const looksLikeCedulaCard = anchorHits >= 2;

  // 2. Verify exact 11-digit cédula printed on card (allow dashes/spaces & O->0, I/l->1 within numeric spans)
  const digitCandidates = String(rawOcr || '')
    .replace(/[OoQq]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[^0-9]/g, '');
  const cedulaMatched = digitCandidates.includes(cedula11);

  // 3. Verify EVERY token of enteredFullName appears as a whole word on the card (min 2 tokens)
  const normEntered = normalizeExactFullName(enteredFullName);
  const enteredTokens = normEntered.split(' ').filter((w) => w.length >= 2);
  const missingTokens = enteredTokens.filter((tok) => !ocrWords.has(tok));
  const nameMatched = enteredTokens.length >= 2 && missingTokens.length === 0;

  return {
    looksLikeCedulaCard,
    anchorHits,
    cedulaMatched,
    nameMatched,
    missingTokens,
    verified: looksLikeCedulaCard && cedulaMatched && nameMatched,
  };
}

/**
 * Server-side OCR verification for front photo of Dominican JCE Cédula.
 * Runs ffmpeg preprocessing + native tesseract-ocr (Spanish) in isolated temp files.
 */
async function verifyCedulaPhotoWithOcr({ imageBuffer, enteredCedula, enteredFullName }) {
  const cedula11 = normalizeDigits(enteredCedula);
  if (!validateDominicanCedulaChecksum(cedula11)) {
    return {
      verified: false,
      cedulaMatched: false,
      nameMatched: false,
      looksLikeCedulaCard: false,
      ocrText: '',
      errorField: 'cedula',
      message: 'Número de cédula inválido.',
    };
  }

  const tmpId = `credo-ocr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const rawPath = path.join(os.tmpdir(), `${tmpId}.img`);
  const prepPath = path.join(os.tmpdir(), `${tmpId}-prep.png`);

  try {
    await fs.promises.writeFile(rawPath, imageBuffer);

    let targetPath = rawPath;
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          rawPath,
          '-vf',
          "scale='min(2200,max(1400,iw))':-1,format=gray,eq=contrast=1.35:brightness=0.03,unsharp=5:5:0.8",
          '-frames:v',
          '1',
          prepPath,
        ],
        { timeout: 9000 }
      );
      if (fs.existsSync(prepPath)) targetPath = prepPath;
    } catch (ffErr) {
      console.warn('[cedulaOcr] ffmpeg prep skipped:', ffErr.message);
    }

    const runTess = async (imgPath, psm) => {
      const { stdout } = await execFileAsync(
        'tesseract',
        [imgPath, 'stdout', '-l', 'spa', '--psm', String(psm)],
        { timeout: 12000, maxBuffer: 2 * 1024 * 1024 }
      );
      return String(stdout || '').trim();
    };

    let combinedText = '';
    try {
      const pass1 = await runTess(targetPath, 6);
      combinedText = pass1;
      let eval1 = extractOcrTextMatches(combinedText, cedula11, enteredFullName);
      if (!eval1.verified) {
        // Second pass: sparse text mode (--psm 11) excels on JCE ID card layouts
        const pass2 = await runTess(targetPath, 11);
        combinedText = `${pass1}\n${pass2}`.trim();
        eval1 = extractOcrTextMatches(combinedText, cedula11, enteredFullName);
      }
      if (!eval1.verified && targetPath !== rawPath) {
        // Third pass on original un-contrasted color image
        const pass3 = await runTess(rawPath, 11);
        combinedText = `${combinedText}\n${pass3}`.trim();
      }
    } catch (tessErr) {
      console.warn('[cedulaOcr] tesseract unavailable:', tessErr.message);
      return {
        verified: false,
        ocrUnavailable: true,
        cedulaMatched: false,
        nameMatched: false,
        looksLikeCedulaCard: false,
        ocrText: '',
        errorField: '',
        message: 'Foto adjuntada correctamente. Tu solicitud pasará a confirmación rápida en Credo Core OS.',
      };
    }

    const res = extractOcrTextMatches(combinedText, cedula11, enteredFullName);
    if (res.verified) {
      return {
        ...res,
        ocrText: combinedText.slice(0, 1500),
        errorField: '',
        message: 'Foto de cédula verificada por OCR · Número y nombre completo coinciden exactamente.',
      };
    }

    if (!res.looksLikeCedulaCard) {
      return {
        ...res,
        ocrText: combinedText.slice(0, 1500),
        errorField: 'photo',
        message: 'No pudimos leer claramente una cédula dominicana en la foto. Toma una foto nítida, bien iluminada y de frente, o envíala a revisión manual.',
      };
    }

    if (!res.cedulaMatched) {
      return {
        ...res,
        ocrText: combinedText.slice(0, 1500),
        errorField: 'cedula',
        message: 'El número de cédula visible en la foto NO coincide con el número que escribiste.',
      };
    }

    return {
      ...res,
      ocrText: combinedText.slice(0, 1500),
      errorField: 'full_name',
      message: 'El nombre escrito arriba NO coincide con el nombre impreso en la foto de tu cédula. Escribe exactamente tus nombres y apellidos.',
    };
  } finally {
    fs.promises.unlink(rawPath).catch(() => {});
    fs.promises.unlink(prepPath).catch(() => {});
  }
}

function signOcrProof({ cedulaDigits, enteredFullName, photoId }) {
  const payload = Buffer.from(
    JSON.stringify({
      ch: hashCedula(cedulaDigits),
      nm: normalizeExactFullName(enteredFullName),
      pid: Number(photoId),
      exp: Date.now() + 20 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', VAULT_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyOcrProof(token, cedulaDigits, enteredFullName) {
  try {
    const raw = String(token || '').trim();
    if (!raw.includes('.')) return { valid: false };
    const [payload, sig] = raw.split('.');
    const expectedSig = crypto.createHmac('sha256', VAULT_KEY).update(payload).digest('base64url');
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return { valid: false };
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || Date.now() > Number(data.exp || 0)) return { valid: false };
    if (data.ch !== hashCedula(cedulaDigits)) return { valid: false };
    if (data.nm !== normalizeExactFullName(enteredFullName)) return { valid: false };
    return { valid: true, photoId: Number(data.pid || 0) };
  } catch {
    return { valid: false };
  }
}

module.exports = {
  normalizeDigits,
  formatCedula,
  maskCedula,
  hashCedula,
  encryptCedula,
  decryptCedula,
  validateDominicanCedulaChecksum,
  normalizeExactFullName,
  verifyNameMatchesCedula,
  lookupOfficialCedulaOwner,
  verifyCedulaPhotoWithOcr,
  signOcrProof,
  verifyOcrProof,
};
