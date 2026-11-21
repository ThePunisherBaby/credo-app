const express = require('express');
const { pool } = require('../db/pool');
const { ALL_RANKS, CLERGY_RANKS, isClergyRank } = require('../config');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const {
  getUnitLineage,
  getUnitLineagesMap,
  getDescendantUnitIds,
  serializeUserSummary,
} = require('../utils/hierarchy');

const router = express.Router();

// International directory & search of clergy and community members
router.get('/', async (req, res) => {
  try {
    const { q, rank, clergy_only, country_code, unit_id, verified_only, limit = 60 } = req.query;
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

    if (unit_id) {
      const descendants = await getDescendantUnitIds(Number(unit_id));
      if (descendants.length > 0) {
        params.push(descendants);
        clauses.push(
          `(u.primary_unit_id = ANY($${params.length}::int[]) OR u.religious_order_id = ANY($${params.length}::int[]))`
        );
      }
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      const idx = params.length;
      clauses.push(
        `(u.full_name ILIKE $${idx} OR u.username ILIKE $${idx} OR u.current_office_title ILIKE $${idx} OR u.bio ILIKE $${idx} OR u.religious_order_initials ILIKE $${idx})`
      );
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 60, 150));

    const { rows } = await pool.query(
      `SELECT u.*
         FROM users u
        ${whereSql}
        ORDER BY
          CASE u.ecclesiastical_rank
            WHEN 'pope' THEN 1
            WHEN 'cardinal' THEN 2
            WHEN 'archbishop' THEN 3
            WHEN 'bishop' THEN 4
            WHEN 'monsignor' THEN 5
            WHEN 'priest' THEN 6
            WHEN 'deacon' THEN 7
            WHEN 'religious' THEN 8
            WHEN 'seminarian' THEN 9
            WHEN 'catechist' THEN 10
            ELSE 11
          END,
          CASE WHEN u.verification_status = 'verified' THEN 0 ELSE 1 END,
          u.full_name ASC
        LIMIT $${params.length}`,
      params
    );

    const lineages = await getUnitLineagesMap(rows.map((u) => u.primary_unit_id));
    const users = rows.map((u) => serializeUserSummary(u, lineages.get(u.primary_unit_id) || []));
    return res.json({ users });
  } catch (err) {
    console.error('[users/list]', err);
    return res.status(500).json({ error: 'Failed to search directory' });
  }
});

// Full profile with institutional lineage, assignment history, counts, and recent posts
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [lineage, orderRes, assignmentsRes, followersRes, followingRes, postsCountRes] =
      await Promise.all([
        getUnitLineage(user.primary_unit_id),
        user.religious_order_id
          ? pool.query(
              'SELECT id, slug, name, unit_type, accent_color FROM ecclesiastical_units WHERE id = $1',
              [user.religious_order_id]
            )
          : Promise.resolve({ rows: [] }),
        pool.query(
          `SELECT ua.*, eu.name AS unit_name, eu.unit_type, eu.city, eu.country_code, eu.country_name, eu.accent_color
             FROM user_assignments ua
             JOIN ecclesiastical_units eu ON eu.id = ua.unit_id
            WHERE ua.user_id = $1
            ORDER BY ua.is_current DESC, ua.is_primary DESC, ua.start_year DESC NULLS LAST`,
          [userId]
        ),
        pool.query('SELECT COUNT(*)::int AS cnt FROM follows WHERE target_user_id = $1', [userId]),
        pool.query('SELECT COUNT(*)::int AS cnt FROM follows WHERE follower_id = $1', [userId]),
        pool.query('SELECT COUNT(*)::int AS cnt FROM posts WHERE author_id = $1', [userId]),
      ]);

    let isFollowing = false;
    if (req.user && req.user.id !== userId) {
      const f = await pool.query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND target_user_id = $2',
        [req.user.id, userId]
      );
      isFollowing = f.rows.length > 0;
    }

    const summary = serializeUserSummary(user, lineage, orderRes.rows[0] || null);
    return res.json({
      user: {
        ...summary,
        followers_count: followersRes.rows[0].cnt,
        following_count: followingRes.rows[0].cnt,
        posts_count: postsCountRes.rows[0].cnt,
        is_following: isFollowing,
      },
      assignments: assignmentsRes.rows,
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
    const lineage = await getUnitLineage(updated.primary_unit_id);
    let orderUnit = null;
    if (updated.religious_order_id) {
      const orderRes = await pool.query(
        'SELECT id, slug, name, unit_type, country_code, accent_color FROM ecclesiastical_units WHERE id = $1',
        [updated.religious_order_id]
      );
      orderUnit = orderRes.rows[0] || null;
    }
    return res.json({ user: serializeUserSummary(updated, lineage, orderUnit) });
  } catch (err) {
    console.error('[users/update]', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Add an assignment to user's ecclesiastical career history
router.post('/me/assignments', requireAuth, async (req, res) => {
  try {
    const { unit_id, role_title, start_year, end_year, is_current = true, is_primary = false, notes = '' } =
      req.body || {};
    if (!unit_id || !role_title) {
      return res.status(400).json({ error: 'unit_id and role_title are required' });
    }

    if (is_primary) {
      await pool.query('UPDATE user_assignments SET is_primary = FALSE WHERE user_id = $1', [
        req.user.id,
      ]);
      await pool.query('UPDATE users SET primary_unit_id = $1, current_office_title = $2 WHERE id = $3', [
        Number(unit_id),
        String(role_title).trim(),
        req.user.id,
      ]);
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

// Toggle or activate Credo Plus subscription (demo checkout)
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
    const lineage = await getUnitLineage(updated.primary_unit_id);
    return res.json({ user: serializeUserSummary(updated, lineage) });
  } catch (err) {
    console.error('[users/credo-plus]', err);
    return res.status(500).json({ error: 'Failed to update Credo Plus status' });
  }
});

// Verify a clergy member (Admins or verified Bishops/Archbishops/Cardinals)
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
    return res.json({ following: false });
  } catch (err) {
    console.error('[users/unfollow]', err);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

module.exports = router;
