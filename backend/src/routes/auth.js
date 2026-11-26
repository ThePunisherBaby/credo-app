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

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      username,
      full_name,
      ecclesiastical_rank = 'lay',
      title_prefix,
      current_office_title = '',
      bio = '',
      motto = '',
      country_code = 'DO',
      preferred_locale = 'es',
    } = req.body || {};

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password and full_name are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!ALL_RANKS.includes(ecclesiastical_rank)) {
      return res.status(400).json({ error: 'Invalid ecclesiastical_rank' });
    }
    if (ecclesiastical_rank === 'pope') {
      return res.status(400).json({ error: 'Rank not available for self-registration' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const baseUsername = (username || cleanEmail.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 28);
    const finalUsername = baseUsername || `user_${Date.now()}`;

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1',
      [cleanEmail, finalUsername]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already registered' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const prefix =
      title_prefix !== undefined
        ? String(title_prefix).trim()
        : DEFAULT_PREFIX_BY_RANK[ecclesiastical_rank] || '';
    const avatarColor = DEFAULT_COLOR_BY_RANK[ecclesiastical_rank] || '#007AFF';
    const verificationStatus = isClergyRank(ecclesiastical_rank) ? 'pending' : 'unverified';

    const { rows } = await pool.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, religious_order_initials, primary_unit_id,
         religious_order_id, current_office_title, bio, motto,
         country_code, languages, preferred_locale, avatar_color,
         verification_status
       ) VALUES ($1,$2,$3,$4,$5,$6,'',NULL,NULL,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        cleanEmail,
        passwordHash,
        finalUsername,
        String(full_name).trim(),
        prefix,
        ecclesiastical_rank,
        String(current_office_title).trim(),
        String(bio).trim(),
        String(motto).trim(),
        String(country_code).trim().toUpperCase().slice(0, 4),
        [String(preferred_locale || 'es').slice(0, 5)],
        String(preferred_locale || 'es').slice(0, 5),
        avatarColor,
        verificationStatus,
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
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { identifier, email, password } = req.body || {};
    const loginId = String(identifier || email || '').trim().toLowerCase();
    if (!loginId || !password) {
      return res.status(400).json({ error: 'identifier/email and password are required' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1 LIMIT 1`,
      [loginId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    const enriched = await enrichUser(user);
    return res.json({ token, user: enriched });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const enriched = await enrichUser(req.user);
    return res.json({ user: enriched });
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

