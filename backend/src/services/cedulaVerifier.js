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

function normalizeNameTokens(rawName, { dropHonorifics = false } = {}) {
  const ascii = decodeHtmlEntities(rawName)
    .replace(/ñ/gi, 'N')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ');
  const parts = ascii.split(/\s+/).filter(Boolean);
  return parts.filter((tok, idx) => {
    if (STOP_WORDS.has(tok)) return false;
    if (dropHonorifics && idx < 2 && HONORIFICS.has(tok)) return false;
    return tok.length >= 2;
  });
}

/**
 * Compares user-entered full_name against the official Cédula holder name.
 * Requires >= 2 real tokens (given name + surname), zero mismatched tokens,
 * and coverage of both the start (given name) and end (surname) of the official name.
 */
function verifyNameMatchesCedula(enteredFullName, officialFullName) {
  const userTokens = normalizeNameTokens(enteredFullName, { dropHonorifics: true });
  const offTokens = normalizeNameTokens(officialFullName, { dropHonorifics: false });

  if (userTokens.length < 2 || offTokens.length < 2) {
    return { matches: false, reason: 'incomplete_name' };
  }

  const matchedOfficialIndices = new Set();

  for (const ut of userTokens) {
    let foundIdx = offTokens.findIndex((ot, i) => !matchedOfficialIndices.has(i) && ot === ut);
    if (foundIdx === -1 && ut.length >= 4) {
      foundIdx = offTokens.findIndex((ot, i) => !matchedOfficialIndices.has(i) && ot.startsWith(ut));
    }
    if (foundIdx === -1) {
      return { matches: false, reason: 'token_mismatch' };
    }
    matchedOfficialIndices.add(foundIdx);
  }

  // Must match at least one given-name token (first half) AND at least one surname token (second half)
  const indices = [...matchedOfficialIndices].sort((a, b) => a - b);
  const firstIdx = indices[0];
  const lastIdx = indices[indices.length - 1];
  const surnameStart = Math.max(1, offTokens.length - 2);
  if (firstIdx > 1 || lastIdx < surnameStart) {
    return { matches: false, reason: 'missing_given_or_surname' };
  }

  return { matches: true, reason: 'verified' };
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

/**
 * Looks up official citizen full name for an 11-digit Dominican Cédula.
 * Uses 2-tier cache (RAM + PostgreSQL cedula_lookup_cache) + official DGII Ciudadanos/RNC.
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

  let lookup = { found: false, officialName: '', status: 'UNAVAILABLE', source: 'none' };
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
    console.warn('[cedulaVerifier] Live lookup fallback:', err.message);
    lookup = { found: false, officialName: '', status: 'OFFLINE', source: 'offline' };
  }

  const result = {
    validChecksum: true,
    found: lookup.found,
    officialName: lookup.officialName || '',
    citizenStatus: lookup.status || '',
    source: lookup.source,
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

module.exports = {
  normalizeDigits,
  formatCedula,
  maskCedula,
  hashCedula,
  encryptCedula,
  decryptCedula,
  validateDominicanCedulaChecksum,
  verifyNameMatchesCedula,
  lookupOfficialCedulaOwner,
};
