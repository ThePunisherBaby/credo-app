const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { ALL_RANKS, isClergyRank } = require('../config');
const { requireAuth, signToken } = require('../middleware/auth');
const { getUnitLineage, serializeUserSummary } = require('../utils/hierarchy');

const router = express.Router();

const DEFAULT_PREFIX_BY_RANK = {
  pope: 'S.S.',
  cardinal: 'S.E.R. Card.',
  archbishop: 'S.E.R. Mons.',
  bishop: 'S.E.R. Mons.',
  monsignor: 'Mons.',
  priest: 'P.',
  deacon: 'Diác.',
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
  priest: '#2C3038',
  deacon: '#355070',
  religious: '#5C4033',
  seminarian: '#4A5568',
  catechist: '#2F6F6D',
  lay: '#2A6F6B',
};

async function enrichUser(userRow) {
  const lineage = await getUnitLineage(userRow.primary_unit_id);
  let orderUnit = null;
  if (userRow.religious_order_id) {
    const { rows } = await pool.query(
      'SELECT id, slug, name, unit_type, country_code, accent_color FROM ecclesiastical_units WHERE id = $1',
      [userRow.religious_order_id]
    );
    orderUnit = rows[0] || null;
  }
  return serializeUserSummary(userRow, lineage, orderUnit);
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
      primary_unit_id,
      religious_order_id,
      religious_order_initials = '',
      current_office_title = '',
      bio = '',
      motto = '',
      country_code = 'VA',
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
    // Public registration cannot self-assign pope
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
      'SELECT id FROM users WHERE email = $1 OR username = $2',
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
    const avatarColor = DEFAULT_COLOR_BY_RANK[ecclesiastical_rank] || '#2A6F6B';
    const verificationStatus = isClergyRank(ecclesiastical_rank) ? 'pending' : 'unverified';

    const { rows } = await pool.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, religious_order_initials, primary_unit_id,
         religious_order_id, current_office_title, bio, motto,
         country_code, languages, preferred_locale, avatar_color,
         verification_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        cleanEmail,
        passwordHash,
        finalUsername,
        String(full_name).trim(),
        prefix,
        ecclesiastical_rank,
        String(religious_order_initials).trim().toUpperCase().slice(0, 12),
        primary_unit_id ? Number(primary_unit_id) : null,
        religious_order_id ? Number(religious_order_id) : null,
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

    // Record initial primary assignment if a unit was chosen
    if (user.primary_unit_id) {
      await pool.query(
        `INSERT INTO user_assignments (user_id, unit_id, role_title, start_year, is_current, is_primary)
         VALUES ($1, $2, $3, EXTRACT(YEAR FROM NOW())::int, TRUE, TRUE)`,
        [
          user.id,
          user.primary_unit_id,
          user.current_office_title || (isClergyRank(user.ecclesiastical_rank) ? 'Clero adscrito' : 'Miembro de comunidad'),
        ]
      );

      // Auto-join pastoral groups along the user's lineage (if any exist)
      const lineage = await getUnitLineage(user.primary_unit_id);
      const lineageIds = lineage.map((u) => u.id);
      if (lineageIds.length > 0) {
        await pool.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role)
           SELECT id, $1, 'member'
             FROM conversations
            WHERE kind = 'pastoral_group' AND unit_id = ANY($2::int[])
           ON CONFLICT DO NOTHING`,
          [user.id, lineageIds]
        );
      }
    }

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
