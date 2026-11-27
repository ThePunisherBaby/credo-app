const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { ALL_RANKS, isClergyRank } = require('../config');
const { requireAuth, signToken } = require('../middleware/auth');
const { serializeUserSummary } = require('../utils/hierarchy');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

const DEFAULT_PREFIX_BY_RANK = {
  pope: 'S.S.',
  cardinal: 'S.E.R. Card.',
  archbishop: 'S.E.R. Mons.',
  bishop: 'S.E.R. Mons.',
  monsignor: 'Mons.',
  priest: 'P.',
  deacon: 'Diác.',
  church: '',
  parish: '',
  religious: 'Hno./Hna.',
  seminarian: 'Sem.',
  catechist: '',
  lay: '',
};

const DEFAULT_COLOR_BY_RANK = {
  pope: '#B8860B',
  cardinal: '#9B1C2E',
  archbishop: '#6B2D5C',
  bishop: '#5B2C6F',
  monsignor: '#8E3A59',
  priest: '#0F1E36',
  deacon: '#355070',
  church: '#0A84FF',
  parish: '#0A84FF',
  religious: '#5C4033',
  seminarian: '#4A5568',
  catechist: '#2F6F6D',
  lay: '#007AFF',
};

async function enrichUser(userRow) {
  return serializeUserSummary(userRow, [], null);
}

const {
  normalizeDigits,
  maskCedula,
  hashCedula,
  encryptCedula,
  validateDominicanCedulaChecksum,
  verifyNameMatchesCedula,
  lookupOfficialCedulaOwner,
} = require('../services/cedulaVerifier');

// Ranks that MUST go through administrative approval in voxon.cloud/diosesmiguia (never auto-activated!)
const APPROVAL_REQUIRED_RANKS = new Set([
  'pope',
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
  'religious',
  'seminarian',
  'church',
  'parish',
]);

// Lightweight per-IP rate limiter for real-time Cédula checks
const cedulaCheckWindow = new Map();
function allowCedulaProbe(ip) {
  const now = Date.now();
  const key = String(ip || 'anon');
  const prev = (cedulaCheckWindow.get(key) || []).filter((t) => now - t < 5 * 60 * 1000);
  if (prev.length >= 25) return false;
  prev.push(now);
  cedulaCheckWindow.set(key, prev);
  return true;
}

// POST /api/v1/auth/verify-cedula — Real-time Cédula & Name match verification (never exposes official name)
router.post('/verify-cedula', async (req, res) => {
  try {
    if (!allowCedulaProbe(req.ip)) {
      return res.status(429).json({
        valid_cedula: false,
        error_field: 'cedula',
        message: 'Demasiadas consultas seguidas. Espera un minuto e inténtalo de nuevo.',
      });
    }

    const { cedula = '', full_name = '', ecclesiastical_rank = 'lay' } = req.body || {};
    const digits = normalizeDigits(cedula);

    if (digits.length !== 11 || !validateDominicanCedulaChecksum(digits)) {
      return res.status(200).json({
        valid_cedula: false,
        duplicate: false,
        name_matches: false,
        error_field: 'cedula',
        message: 'Ingresa una cédula válida de 11 dígitos (000-0000000-0).',
      });
    }

    const cHash = hashCedula(digits);
    const [dupUser, dupReq] = await Promise.all([
      pool.query(`SELECT id FROM users WHERE cedula_hash = $1 LIMIT 1`, [cHash]),
      pool.query(`SELECT id FROM registration_requests WHERE cedula_hash = $1 AND status = 'pending' LIMIT 1`, [cHash]),
    ]);
    if (dupUser.rows.length > 0 || dupReq.rows.length > 0) {
      return res.status(200).json({
        valid_cedula: true,
        duplicate: true,
        name_matches: false,
        error_field: 'cedula',
        message: 'Esta cédula ya tiene una cuenta o solicitud activa en Credo.',
      });
    }

    const isClergyOrConsecrated = APPROVAL_REQUIRED_RANKS.has(String(ecclesiastical_rank || 'lay'));
    const lookup = await lookupOfficialCedulaOwner(digits);

    if (isClergyOrConsecrated) {
      return res.status(200).json({
        valid_cedula: true,
        duplicate: false,
        requires_approval: true,
        name_matches: lookup.found ? verifyNameMatchesCedula(full_name, lookup.officialName).matches : true,
        lookup_status: lookup.found ? 'verified_padron' : 'manual_review',
        error_field: '',
        message: 'Cédula válida · Tu solicitud será confirmada por la administración de Credo.',
      });
    }

    // Civil Laico: name MUST match official Cédula owner 100% EXACTLY!
    if (lookup.found && lookup.officialName) {
      const cmp = verifyNameMatchesCedula(full_name, lookup.officialName);
      if (!cmp.matches) {
        return res.status(200).json({
          valid_cedula: true,
          duplicate: false,
          name_matches: false,
          lookup_status: 'mismatch',
          error_field: 'full_name',
          message:
            'El nombre escrito NO coincide exactamente con el titular de esta cédula. Escribe tus nombres y apellidos completos exactos tal como figuran en tu cédula.',
        });
      }
      return res.status(200).json({
        valid_cedula: true,
        duplicate: false,
        name_matches: true,
        lookup_status: 'matched',
        error_field: '',
        message: 'Identidad exacta confirmada con tu cédula.',
      });
    }

    // Valid JCE checksum, not found in online padrón: NEVER fake green match — route to manual review!
    const nameWords = String(full_name || '').trim().split(/\s+/).filter((w) => w.length >= 2);
    if (nameWords.length < 2) {
      return res.status(200).json({
        valid_cedula: true,
        duplicate: false,
        name_matches: false,
        lookup_status: 'incomplete_name',
        error_field: 'full_name',
        message: 'Escribe tus nombres y apellidos completos exactos tal como figuran en tu cédula.',
      });
    }

    return res.status(200).json({
      valid_cedula: true,
      duplicate: false,
      name_matches: false,
      requires_approval: true,
      lookup_status: 'manual_review',
      error_field: '',
      message: 'Cédula no disponible en padrón en línea · Pasará a verificación manual antes de activar acceso.',
    });
  } catch (err) {
    console.error('[auth/verify-cedula]', err);
    return res.status(500).json({ error: 'No se pudo verificar la cédula en este momento.' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { getSetting, getClientIp } = require('../services/systemState');
    if (getSetting('block_registrations')?.enabled) {
      return res.status(503).json({
        error: 'Los nuevos registros están temporalmente pausados por la administración de Credo.',
      });
    }

    const {
      email,
      password,
      username,
      full_name,
      phone = '',
      cedula = '',
      ecclesiastical_rank = 'lay',
      title_prefix,
      current_office_title = '',
      bio = '',
      motto = '',
      country_code = 'DO',
      preferred_locale = 'es',
    } = req.body || {};

    const cleanName = String(full_name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim().slice(0, 32);
    const cedulaDigits = normalizeDigits(cedula);
    const clientIp = getClientIp(req);

    if (!cleanEmail || !password || !cleanName) {
      return res.status(400).json({ error: 'Completa tu nombre completo, correo electrónico y contraseña.' });
    }
    if (cleanPhone.replace(/\D/g, '').length < 8) {
      return res.status(400).json({ field: 'phone', error: 'Ingresa un número de teléfono válido.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ field: 'password', error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (cedulaDigits.length !== 11 || !validateDominicanCedulaChecksum(cedulaDigits)) {
      return res.status(400).json({
        error_code: 'INVALID_CEDULA',
        field: 'cedula',
        error: 'Ingresa un número de cédula válido de 11 dígitos.',
      });
    }
    if (!ALL_RANKS.includes(ecclesiastical_rank) || ecclesiastical_rank === 'pope') {
      return res.status(400).json({ error: 'Estado eclesiástico no válido.' });
    }

    const baseUsername = (username || cleanEmail.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 28);
    const finalUsername = baseUsername || `user_${Date.now()}`;
    const cHash = hashCedula(cedulaDigits);
    const cEnc = encryptCedula(cedulaDigits);
    const cMasked = maskCedula(cedulaDigits);

    const [existingUser, existingReq] = await Promise.all([
      pool.query(
        `SELECT id, email, username, cedula_hash
           FROM users
          WHERE LOWER(email) = $1 OR LOWER(username) = $2 OR cedula_hash = $3
          LIMIT 1`,
        [cleanEmail, finalUsername, cHash]
      ),
      pool.query(
        `SELECT id, status, email, cedula_hash
           FROM registration_requests
          WHERE (LOWER(email) = $1 OR cedula_hash = $2) AND status = 'pending'
          LIMIT 1`,
        [cleanEmail, cHash]
      ),
    ]);

    if (existingUser.rows.length > 0) {
      const hit = existingUser.rows[0];
      if (hit.cedula_hash === cHash) {
        return res.status(409).json({
          field: 'cedula',
          error: 'Esta cédula ya está vinculada a una cuenta en Credo.',
        });
      }
      return res.status(409).json({
        field: 'email',
        error: 'Este correo o nombre de usuario ya está registrado.',
      });
    }
    if (existingReq.rows.length > 0) {
      return res.status(409).json({
        pending_approval: true,
        error: 'Ya existe una solicitud pendiente de revisión con este correo o cédula.',
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const prefix =
      title_prefix !== undefined
        ? String(title_prefix).trim()
        : DEFAULT_PREFIX_BY_RANK[ecclesiastical_rank] || '';
    const lookup = await lookupOfficialCedulaOwner(cedulaDigits);
    const nameMatch = lookup.found ? verifyNameMatchesCedula(cleanName, lookup.officialName).matches : false;
    const isApprovalRank = APPROVAL_REQUIRED_RANKS.has(ecclesiastical_rank);

    // 1. Clergy / Religious / Deacon / Nun / Seminarian / Church -> ALWAYS submit a pending request to voxon.cloud/diosesmiguia!
    if (isApprovalRank) {
      const { rows: reqRows } = await pool.query(
        `INSERT INTO registration_requests (
           request_kind, full_name, username, email, phone, password_hash,
           ecclesiastical_rank, title_prefix, current_office_title, bio,
           country_code, preferred_locale, cedula_hash, cedula_encrypted,
           cedula_masked, cedula_official_name, cedula_name_matched, status, ip_address
         ) VALUES (
           'clergy', $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12, $13,
           $14, $15, $16, 'pending', $17
         ) RETURNING id, created_at`,
        [
          cleanName,
          finalUsername,
          cleanEmail,
          cleanPhone,
          passwordHash,
          ecclesiastical_rank,
          prefix,
          String(current_office_title || '').trim().slice(0, 160),
          String(bio || '').trim().slice(0, 500),
          String(country_code || 'DO').trim().toUpperCase().slice(0, 4),
          String(preferred_locale || 'es').slice(0, 5),
          cHash,
          cEnc,
          cMasked,
          lookup.officialName || '',
          Boolean(nameMatch),
          String(req.ip || '').slice(0, 64),
        ]
      );

      return res.status(202).json({
        pending_approval: true,
        request_id: reqRows[0].id,
        message:
          'Solicitud enviada correctamente. Tu identidad y ministerio serán confirmados por la administración de Credo antes de activar el acceso.',
      });
    }

    // 2. Civil Laico -> Name MUST match Cédula owner or entry is strictly blocked!
    if (lookup.found && lookup.officialName) {
      if (!nameMatch) {
        return res.status(422).json({
          error_code: 'NAME_CEDULA_MISMATCH',
          field: 'full_name',
          error:
            'Los datos de tu nombre no coinciden con los de tu cédula. Corrige tu nombre y apellido exactos para poder entrar.',
        });
      }
    } else {
      // Valid JCE checksum Cédula not yet listed in online padrón -> route to manual confirmation queue so bots cannot slip in!
      const nameWords = cleanName.split(/\s+/).filter((w) => w.length >= 2);
      if (nameWords.length < 2) {
        return res.status(422).json({
          error_code: 'NAME_CEDULA_MISMATCH',
          field: 'full_name',
          error: 'Escribe tu nombre y apellido reales tal como figuran en tu cédula.',
        });
      }
      const { rows: reqRows } = await pool.query(
        `INSERT INTO registration_requests (
           request_kind, full_name, username, email, phone, password_hash,
           ecclesiastical_rank, title_prefix, current_office_title, bio,
           country_code, preferred_locale, cedula_hash, cedula_encrypted,
           cedula_masked, cedula_official_name, cedula_name_matched, status, ip_address
         ) VALUES (
           'lay_manual', $1, $2, $3, $4, $5,
           $6, '', '', '',
           $7, $8, $9, $10,
           $11, '', FALSE, 'pending', $12
         ) RETURNING id`,
        [
          cleanName,
          finalUsername,
          cleanEmail,
          cleanPhone,
          passwordHash,
          ecclesiastical_rank,
          String(country_code || 'DO').trim().toUpperCase().slice(0, 4),
          String(preferred_locale || 'es').slice(0, 5),
          cHash,
          cEnc,
          cMasked,
          String(req.ip || '').slice(0, 64),
        ]
      );
      return res.status(202).json({
        pending_approval: true,
        request_id: reqRows[0].id,
        message:
          'Tu solicitud de registro fue enviada a verificación manual por el equipo de Credo.',
      });
    }

    const avatarColor = DEFAULT_COLOR_BY_RANK[ecclesiastical_rank] || '#007AFF';
    const { rows } = await pool.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, religious_order_initials, primary_unit_id,
         religious_order_id, current_office_title, bio, motto,
         country_code, languages, preferred_locale, avatar_color,
         verification_status, phone, cedula_hash, cedula_encrypted,
         cedula_masked, cedula_official_name, cedula_verified, account_status
       ) VALUES ($1,$2,$3,$4,$5,$6,'',NULL,NULL,$7,$8,$9,$10,$11,$12,$13,'verified',$14,$15,$16,$17,$18,TRUE,'active')
       RETURNING *`,
      [
        cleanEmail,
        passwordHash,
        finalUsername,
        cleanName,
        prefix,
        ecclesiastical_rank,
        String(current_office_title).trim(),
        String(bio).trim(),
        String(motto).trim(),
        String(country_code).trim().toUpperCase().slice(0, 4),
        [String(preferred_locale || 'es').slice(0, 5)],
        String(preferred_locale || 'es').slice(0, 5),
        avatarColor,
        cleanPhone,
        cHash,
        cEnc,
        cMasked,
        lookup.officialName || '',
      ]
    );

    const user = rows[0];
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');

    const token = signToken(user);
    const enriched = await enrichUser(user);
    return res.status(201).json({ token, user: enriched });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'No se pudo procesar el registro.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, email, password } = req.body || {};
    const loginId = String(identifier || email || '').trim().toLowerCase();
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Ingresa tu correo/usuario y contraseña.' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1 LIMIT 1`,
      [loginId]
    );
    const user = rows[0];
    if (!user) {
      const pendingCheck = await pool.query(
        `SELECT status FROM registration_requests WHERE LOWER(email) = $1 OR LOWER(username) = $1 ORDER BY created_at DESC LIMIT 1`,
        [loginId]
      );
      if (pendingCheck.rows[0]?.status === 'pending') {
        return res.status(403).json({
          pending_approval: true,
          error: 'Tu solicitud de cuenta está en revisión por la administración de Credo.',
        });
      }
      if (pendingCheck.rows[0]?.status === 'rejected') {
        return res.status(403).json({
          error: 'Tu solicitud de registro no fue aprobada.',
        });
      }
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    if (
      (user.account_status && user.account_status !== 'active') ||
      user.moderation_status === 'banned' ||
      (user.moderation_status === 'suspended' &&
        (!user.suspended_until || new Date(user.suspended_until).getTime() > Date.now()))
    ) {
      return res.status(403).json({
        error:
          user.moderation_reason ||
          (user.account_status === 'pending'
            ? 'Tu cuenta está pendiente de confirmación administrativa.'
            : 'Esta cuenta ha sido suspendida o bloqueada por la administración de Credo.'),
      });
    }

    const { getClientIp } = require('../services/systemState');
    pool
      .query(`UPDATE users SET last_ip = $2, last_user_agent = $3, last_seen_at = NOW() WHERE id = $1`, [
        user.id,
        getClientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 220),
      ])
      .catch(() => {});

    const token = signToken(user);
    const enriched = await enrichUser(user);
    return res.json({ token, user: { ...enriched, role: user.role || 'user' } });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const enriched = await enrichUser(req.user);
    return res.json({
      user: {
        ...enriched,
        role: req.user.role || 'user',
        moderation_status: req.user.moderation_status || 'active',
        is_impersonating: Boolean(req.user._impersonated_by),
        impersonator_name: req.user._impersonator_name || '',
      },
    });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

const crypto = require('crypto');

function hashClaimToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '').trim()).digest('hex');
}

async function issueProfileClaimLink({ userId, createdBy = null, daysValid = 30, prefix = 'bienvenida' }) {
  const safePrefix = String(prefix || 'bienvenida')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'bienvenida';
  const rawToken = `${safePrefix}-${crypto.randomBytes(12).toString('hex')}`;
  const tokenHash = hashClaimToken(rawToken);
  const safeDays = Math.max(1, Math.min(90, Number(daysValid) || 30));

  const { rows } = await pool.query(
    `INSERT INTO profile_claim_tokens (user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4)
     RETURNING id, expires_at`,
    [userId, tokenHash, String(safeDays), createdBy]
  );

  return {
    id: rows[0].id,
    token: rawToken,
    url: `https://credoapp.tech/bienvenida/${rawToken}`,
    expires_at: rows[0].expires_at,
  };
}

// GET /api/v1/auth/claim/:token — Preview pre-created profile for VIP onboarding
router.get('/claim/:token', async (req, res) => {
  try {
    const tokenHash = hashClaimToken(req.params.token);
    const { rows } = await pool.query(
      `SELECT pct.id AS claim_id, pct.expires_at, pct.claimed_at,
              u.id, u.email, u.username, u.full_name, u.title_prefix,
              u.ecclesiastical_rank, u.current_office_title, u.bio,
              u.avatar_url, u.avatar_color, u.is_ceo, u.verification_status,
              (SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id) AS posts_count
         FROM profile_claim_tokens pct
         JOIN users u ON u.id = pct.user_id
        WHERE pct.token_hash = $1
        LIMIT 1`,
      [tokenHash]
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({
        error: 'Enlace de bienvenida no válido o no encontrado.',
      });
    }
    if (row.claimed_at) {
      return res.status(410).json({
        error: 'Este perfil ya fue activado. Puedes iniciar sesión directamente con tu correo y contraseña.',
        already_claimed: true,
      });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({
        error: 'Este enlace de bienvenida ha expirado. Solicita uno nuevo al administrador.',
        expired: true,
      });
    }

    const isSeedPlaceholderEmail =
      !row.email || row.email.endsWith('@credo.org') || row.email.endsWith('@credo.local');

    return res.json({
      valid: true,
      expires_at: row.expires_at,
      profile: {
        id: row.id,
        full_name: row.full_name,
        title_prefix: row.title_prefix || '',
        username: row.username,
        email: isSeedPlaceholderEmail ? '' : row.email,
        current_office_title: row.current_office_title || '',
        bio: row.bio || '',
        avatar_url: row.avatar_url || '',
        avatar_color: row.avatar_color || '#0F1E36',
        is_ceo: Boolean(row.is_ceo),
        is_verified: row.verification_status === 'verified',
        ecclesiastical_rank: row.ecclesiastical_rank,
        posts_count: row.posts_count || 0,
      },
    });
  } catch (err) {
    console.error('[auth/claim GET]', err);
    return res.status(500).json({ error: 'No se pudo verificar el enlace de bienvenida.' });
  }
});

// POST /api/v1/auth/claim/:token — Set personal email, password & profile details and sign in immediately
router.post('/claim/:token', async (req, res) => {
  const client = await pool.connect();
  try {
    const rawPassword = req.body?.password ?? req.body?.['new-password'] ?? req.body?.new_password ?? '';
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const rawFullName = String(req.body?.full_name || '').trim();
    const rawTitlePrefix = req.body?.title_prefix !== undefined ? String(req.body.title_prefix).trim().slice(0, 24) : null;
    const rawUsername = req.body?.username !== undefined ? String(req.body.username).trim().toLowerCase() : null;
    const rawOffice = req.body?.current_office_title !== undefined ? String(req.body.current_office_title).trim().slice(0, 140) : null;
    const rawBio = req.body?.bio !== undefined ? String(req.body.bio).trim().slice(0, 500) : null;

    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
    }
    if (!rawFullName) {
      return res.status(400).json({ error: 'Ingresa tu nombre.' });
    }
    if (String(rawPassword).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const tokenHash = hashClaimToken(req.params.token);
    await client.query('BEGIN');

    const tokRes = await client.query(
      `SELECT pct.id AS claim_id, pct.user_id, pct.expires_at, pct.claimed_at, u.*
         FROM profile_claim_tokens pct
         JOIN users u ON u.id = pct.user_id
        WHERE pct.token_hash = $1
        FOR UPDATE OF pct`,
      [tokenHash]
    );
    const claimRow = tokRes.rows[0];
    if (!claimRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Enlace de bienvenida no válido.' });
    }
    if (claimRow.claimed_at) {
      await client.query('ROLLBACK');
      return res.status(410).json({
        error: 'Este perfil ya fue activado. Inicia sesión con tu correo y contraseña.',
      });
    }
    if (new Date(claimRow.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Este enlace de bienvenida ha expirado.' });
    }

    const targetUserId = claimRow.user_id;
    let finalUsername = claimRow.username;
    if (rawUsername) {
      const cleanedUser = rawUsername.replace(/^@+/, '').replace(/[^a-z0-9_.]/g, '_').slice(0, 28);
      if (cleanedUser.length >= 3) {
        finalUsername = cleanedUser;
      }
    }

    const conflictRes = await client.query(
      `SELECT id, email, username FROM users
        WHERE id <> $1 AND (LOWER(email) = $2 OR LOWER(username) = $3)
        LIMIT 1`,
      [targetUserId, rawEmail, finalUsername]
    );
    if (conflictRes.rows.length > 0) {
      await client.query('ROLLBACK');
      const dupEmail = String(conflictRes.rows[0].email || '').toLowerCase() === rawEmail;
      return res.status(409).json({
        error: dupEmail
          ? 'Ese correo electrónico ya está vinculado a otra cuenta.'
          : 'Ese nombre de usuario ya está en uso. Elige otro.',
      });
    }

    const passwordHash = await bcrypt.hash(String(rawPassword), 10);
    const updRes = await client.query(
      `UPDATE users
          SET email = $2,
              password_hash = $3,
              username = $4,
              full_name = $5,
              title_prefix = COALESCE($6, title_prefix),
              current_office_title = COALESCE($7, current_office_title),
              bio = COALESCE($8, bio)
        WHERE id = $1
        RETURNING *`,
      [
        targetUserId,
        rawEmail,
        passwordHash,
        finalUsername,
        rawFullName.slice(0, 100),
        rawTitlePrefix,
        rawOffice,
        rawBio,
      ]
    );

    await client.query(
      `UPDATE profile_claim_tokens
          SET claimed_at = NOW()
        WHERE user_id = $1 AND claimed_at IS NULL`,
      [targetUserId]
    );

    await client.query('COMMIT');

    const updatedUser = updRes.rows[0];
    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    apiCache.invalidate('stats:');
    apiCache.invalidate('vids:');

    const jwtToken = signToken(updatedUser);
    const enriched = await enrichUser(updatedUser);
    return res.status(200).json({ token: jwtToken, user: enriched });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[auth/claim POST]', err);
    return res.status(500).json({ error: 'No se pudo completar la activación de tu perfil.' });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/admin/claim-links — Admin/CEO endpoint to mint a fresh 1-click onboarding link
router.post('/admin/claim-links', requireAuth, async (req, res) => {
  try {
    if (!req.user?.is_admin && !req.user?.is_ceo) {
      return res.status(403).json({ error: 'Solo administradores pueden generar enlaces de activación.' });
    }
    const { user_id, username, days_valid = 30, prefix = 'bienvenida' } = req.body || {};
    const targetRes = await pool.query(
      `SELECT id, username, full_name FROM users
        WHERE ($1::int IS NOT NULL AND id = $1)
           OR ($2::text <> '' AND LOWER(username) = LOWER($2))
        LIMIT 1`,
      [user_id ? Number(user_id) : null, String(username || '').trim()]
    );
    if (!targetRes.rows[0]) {
      return res.status(404).json({ error: 'Perfil no encontrado.' });
    }
    const issued = await issueProfileClaimLink({
      userId: targetRes.rows[0].id,
      createdBy: req.user.id,
      daysValid: days_valid,
      prefix,
    });
    return res.status(201).json({
      user: targetRes.rows[0],
      ...issued,
    });
  } catch (err) {
    console.error('[auth/admin/claim-links]', err);
    return res.status(500).json({ error: 'No se pudo generar el enlace.' });
  }
});

router.issueProfileClaimLink = issueProfileClaimLink;
module.exports = router;

