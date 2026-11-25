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

module.exports = router;
