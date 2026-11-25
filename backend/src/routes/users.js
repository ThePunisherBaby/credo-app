const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { ALL_RANKS, CLERGY_RANKS, isClergyRank } = require('../config');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');
const { serializeUserSummary } = require('../utils/hierarchy');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

const USER_PUBLIC_COLS = `
  id, username, full_name, title_prefix, ecclesiastical_rank,
  religious_order_initials, primary_unit_id, religious_order_id,
  current_office_title, bio, motto, ordination_date, country_code,
  languages, preferred_locale, avatar_color, avatar_url,
  verification_status, is_admin, is_ceo, website_links,
  is_credo_plus, credo_plus_plan,
  followers_count, following_count, posts_count, created_at
`;

// International directory & search of official accounts, churches & community members
router.get('/', async (req, res) => {
  try {
    const { q, rank, clergy_only, country_code, verified_only, limit = 60 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 150);

    const runDirQuery = async () => {
      const clauses = [];
      const params = [];

      if (rank && ALL_RANKS.includes(String(rank))) {
        params.push(String(rank));
        clauses.push(`u.ecclesiastical_rank = $${params.length}`);
      } else if (clergy_only === 'true') {
        params.push([...CLERGY_RANKS]);
        clauses.push(`u.ecclesiastical_rank = ANY($${params.length}::text[])`);
      }

      if (country_code) {
        params.push(String(country_code).toUpperCase());
        clauses.push(`UPPER(u.country_code) = $${params.length}`);
      }

      if (verified_only === 'true') {
        clauses.push(`u.verification_status = 'verified'`);
      }

      if (q && String(q).trim()) {
        params.push(`%${String(q).trim()}%`);
        const idx = params.length;
        clauses.push(
          `(u.full_name ILIKE $${idx} OR u.username ILIKE $${idx} OR u.current_office_title ILIKE $${idx} OR u.bio ILIKE $${idx})`
        );
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(safeLimit);

      const { rows } = await pool.query(
        `SELECT ${USER_PUBLIC_COLS}
           FROM users u
          ${whereSql}
          ORDER BY
            COALESCE(u.is_ceo, FALSE) DESC,
            CASE u.ecclesiastical_rank
              WHEN 'pope' THEN 1
              WHEN 'cardinal' THEN 2
              WHEN 'archbishop' THEN 3
              WHEN 'bishop' THEN 4
              WHEN 'monsignor' THEN 5
              WHEN 'priest' THEN 6
              WHEN 'deacon' THEN 7
              WHEN 'church' THEN 8
              WHEN 'parish' THEN 8
              WHEN 'religious' THEN 9
              WHEN 'seminarian' THEN 10
              WHEN 'catechist' THEN 11
              ELSE 12
            END,
            CASE WHEN u.verification_status = 'verified' THEN 0 ELSE 1 END,
            u.full_name ASC
          LIMIT $${params.length}`,
        params
      );

      return { users: rows.map((u) => serializeUserSummary(u, [])) };
    };

    if (!q) {
      const cacheKey = `users:dir:${rank || ''}:${clergy_only || ''}:${country_code || ''}:${verified_only || ''}:${safeLimit}`;
      const payload = await apiCache.getOrLoad(cacheKey, 20000, runDirQuery);
      res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
      return res.json(payload);
    }

    const payload = await runDirQuery();
    return res.json(payload);
  } catch (err) {
    console.error('[users/list]', err);
    return res.status(500).json({ error: 'Failed to search directory' });
  }
});

// High-throughput batch church user importer (creates verified church user accounts from document list using church emails)
router.post('/bulk-churches', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const churches = Array.isArray(req.body?.churches) ? req.body.churches : [];
    if (churches.length === 0 || churches.length > 2000) {
      return res.status(400).json({ error: 'Provide between 1 and 2000 church entries' });
    }

    const defaultHash = await bcrypt.hash(String(req.body?.default_password || 'CredoIglesia2026!'), 10);
    await client.query('BEGIN');

    let imported = 0;
    for (const ch of churches) {
      const email = String(ch?.email || '').trim().toLowerCase();
      const name = String(ch?.name || '').trim().slice(0, 160);
      if (!email || !email.includes('@') || !name) continue;

      const rawUser = String(ch?.username || email.split('@')[0])
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 28);
      const username = rawUser || `iglesia_${imported + 1}`;
      const cc = String(ch?.country_code || 'DO').trim().toUpperCase().slice(0, 4);
      const office = String(ch?.city || ch?.address || '').trim().slice(0, 160);

      await client.query(
        `INSERT INTO users (
           email, password_hash, username, full_name, title_prefix,
           ecclesiastical_rank, current_office_title, bio, country_code,
           languages, preferred_locale, avatar_color, avatar_url,
           verification_status, verification_note
         ) VALUES ($1,$2,$3,$4,'','church',$5,'',$6,ARRAY['es'],'es','#0F1E36',$7,'verified','Iglesia registrada oficialmente')
         ON CONFLICT (email) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           current_office_title = CASE WHEN EXCLUDED.current_office_title <> '' THEN EXCLUDED.current_office_title ELSE users.current_office_title END,
           country_code = EXCLUDED.country_code,
           ecclesiastical_rank = 'church',
           verification_status = 'verified',
           updated_at = NOW()`,
        [
          email,
          defaultHash,
          `${username}_${email.length}`,
          name,
          office,
          cc,
          String(ch?.avatar_url || '').trim().slice(0, 500),
        ]
      );
      imported += 1;
    }

    await client.query('COMMIT');
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');
    return res.status(201).json({ imported });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[users/bulk-churches]', err);
    return res.status(500).json({ error: 'Bulk church import failed' });
  } finally {
    client.release();
  }
});

// Full O(1) user profile (reads precomputed posts_count, followers_count, following_count directly)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const baseUser = await apiCache.getOrLoad(`users:prof:${userId}`, 15000, async () => {
      const { rows } = await pool.query(`SELECT ${USER_PUBLIC_COLS} FROM users WHERE id = $1 LIMIT 1`, [userId]);
      const user = rows[0];
      if (!user) return null;
      return {
        ...serializeUserSummary(user, []),
        followers_count: Number(user.followers_count || 0),
        following_count: Number(user.following_count || 0),
        posts_count: Number(user.posts_count || 0),
      };
    });

    if (!baseUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    let isFollowing = false;
    if (req.user && req.user.id !== userId) {
      const f = await pool.query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND target_user_id = $2 LIMIT 1',
        [req.user.id, userId]
      );
      isFollowing = f.rows.length > 0;
    }

    return res.json({
      user: {
        ...baseUser,
        is_following: isFollowing,
      },
      assignments: [],
    });
  } catch (err) {
    console.error('[users/detail]', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Update authenticated user's own profile
router.put('/me', requireAuth, async (req, res) => {
  try {
    const {
      full_name,
      title_prefix,
      current_office_title,
      primary_unit_id,
      religious_order_id,
      religious_order_initials,
      bio,
      motto,
      ordination_date,
      country_code,
      preferred_locale,
      languages,
      avatar_color,
      avatar_url,
      request_verification,
    } = req.body || {};

    let nextVerification = req.user.verification_status;
    if (
      request_verification === true &&
      isClergyRank(req.user.ecclesiastical_rank) &&
      nextVerification === 'unverified'
    ) {
      nextVerification = 'pending';
    }

    const { rows } = await pool.query(
      `UPDATE users
          SET full_name = COALESCE($1, full_name),
              title_prefix = COALESCE($2, title_prefix),
              current_office_title = COALESCE($3, current_office_title),
              primary_unit_id = CASE WHEN $4::int IS NOT NULL THEN $4::int ELSE primary_unit_id END,
              religious_order_id = CASE WHEN $5::int IS NOT NULL THEN NULLIF($5::int, 0) ELSE religious_order_id END,
              religious_order_initials = COALESCE($6, religious_order_initials),
              bio = COALESCE($7, bio),
              motto = COALESCE($8, motto),
              ordination_date = COALESCE($9::date, ordination_date),
              country_code = COALESCE($10, country_code),
              preferred_locale = COALESCE($11, preferred_locale),
              languages = COALESCE($12::text[], languages),
              avatar_color = COALESCE($13, avatar_color),
              avatar_url = COALESCE($14, avatar_url),
              verification_status = $15,
              updated_at = NOW()
        WHERE id = $16
        RETURNING *`,
      [
        full_name !== undefined ? String(full_name).trim() : null,
        title_prefix !== undefined ? String(title_prefix).trim() : null,
        current_office_title !== undefined ? String(current_office_title).trim() : null,
        primary_unit_id !== undefined ? Number(primary_unit_id) : null,
        religious_order_id !== undefined ? Number(religious_order_id) : null,
        religious_order_initials !== undefined
          ? String(religious_order_initials).trim().toUpperCase().slice(0, 12)
          : null,
        bio !== undefined ? String(bio).trim() : null,
        motto !== undefined ? String(motto).trim() : null,
        ordination_date || null,
        country_code !== undefined ? String(country_code).trim().toUpperCase().slice(0, 4) : null,
        preferred_locale !== undefined ? String(preferred_locale).trim().slice(0, 5) : null,
        Array.isArray(languages) ? languages.map((l) => String(l).slice(0, 5)) : null,
        avatar_color !== undefined ? String(avatar_color).trim().slice(0, 16) : null,
        avatar_url !== undefined ? String(avatar_url).trim().slice(0, 500) : null,
        nextVerification,
        req.user.id,
      ]
    );

    const updated = rows[0];
    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    return res.json({ user: serializeUserSummary(updated, [], null) });
  } catch (err) {
    console.error('[users/update]', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Add an assignment to user's career history
router.post('/me/assignments', requireAuth, async (req, res) => {
  try {
    const { unit_id, role_title, start_year, end_year, is_current = true, is_primary = false, notes = '' } =
      req.body || {};
    if (!unit_id || !role_title) {
      return res.status(400).json({ error: 'unit_id and role_title are required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_assignments (user_id, unit_id, role_title, start_year, end_year, is_current, is_primary, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.user.id,
        Number(unit_id),
        String(role_title).trim(),
        start_year ? Number(start_year) : null,
        end_year ? Number(end_year) : null,
        Boolean(is_current),
        Boolean(is_primary),
        String(notes).trim(),
      ]
    );

    return res.status(201).json({ assignment: rows[0] });
  } catch (err) {
    console.error('[users/assignments/add]', err);
    return res.status(500).json({ error: 'Failed to add assignment' });
  }
});

router.delete('/me/assignments/:assignmentId', requireAuth, async (req, res) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    await pool.query('DELETE FROM user_assignments WHERE id = $1 AND user_id = $2', [
      assignmentId,
      req.user.id,
    ]);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[users/assignments/del]', err);
    return res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// Toggle or activate Credo Plus subscription
router.post('/me/credo-plus', requireAuth, async (req, res) => {
  try {
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : true;
    const plan = active ? (req.body?.plan === 'annual' ? 'annual' : 'monthly') : '';
    const { rows } = await pool.query(
      `UPDATE users SET is_credo_plus = $1, credo_plus_plan = $2, updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [active, plan, req.user.id]
    );
    const updated = rows[0];
    apiCache.invalidate('users:');
    return res.json({ user: serializeUserSummary(updated, []) });
  } catch (err) {
    console.error('[users/credo-plus]', err);
    return res.status(500).json({ error: 'Failed to update Credo Plus status' });
  }
});

// Verify a clergy or church member
router.post('/:id/verify', requireAuth, async (req, res) => {
  try {
    const allowedApprovers = new Set(['pope', 'cardinal', 'archbishop', 'bishop']);
    const canApprove =
      req.user.is_admin ||
      (req.user.verification_status === 'verified' && allowedApprovers.has(req.user.ecclesiastical_rank));

    if (!canApprove) {
      return res.status(403).json({ error: 'Only verified Ordinaries or admins can verify clergy' });
    }

    const targetId = Number(req.params.id);
    const { status = 'verified', note = '' } = req.body || {};
    if (!['verified', 'pending', 'unverified'].includes(status)) {
      return res.status(400).json({ error: 'Invalid verification status' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET verification_status = $1, verification_note = $2, updated_at = NOW()
        WHERE id = $3 RETURNING id, verification_status`,
      [status, String(note).trim(), targetId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    apiCache.invalidate('users:');
    return res.json({ verification: rows[0] });
  } catch (err) {
    console.error('[users/verify]', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/:id/follow', requireAuth, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    await pool.query(
      `INSERT INTO follows (follower_id, target_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, targetId]
    );
    apiCache.invalidate(`users:prof:${targetId}`);
    apiCache.invalidate(`users:prof:${req.user.id}`);
    return res.json({ following: true });
  } catch (err) {
    console.error('[users/follow]', err);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
});

router.delete('/:id/follow', requireAuth, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    await pool.query(
      `DELETE FROM follows WHERE follower_id = $1 AND target_user_id = $2`,
      [req.user.id, targetId]
    );
    apiCache.invalidate(`users:prof:${targetId}`);
    apiCache.invalidate(`users:prof:${req.user.id}`);
    return res.json({ following: false });
  } catch (err) {
    console.error('[users/unfollow]', err);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

module.exports = router;
