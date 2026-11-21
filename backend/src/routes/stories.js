const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireClergy } = require('../middleware/auth');
const { getUnitLineagesMap, serializeUserSummary } = require('../utils/hierarchy');

const router = express.Router();

// List active clergy stories
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              u.username AS author_username,
              u.full_name AS author_full_name,
              u.title_prefix AS author_title_prefix,
              u.ecclesiastical_rank AS author_rank,
              u.religious_order_initials AS author_order_initials,
              u.primary_unit_id AS author_primary_unit_id,
              u.current_office_title AS author_office_title,
              u.avatar_color AS author_avatar_color,
              u.avatar_url AS author_avatar_url,
              u.verification_status AS author_verification_status,
              u.country_code AS author_country_code,
              eu.name AS scope_unit_name,
              eu.country_code AS scope_unit_country_code
         FROM stories s
         JOIN users u ON u.id = s.author_id
         LEFT JOIN ecclesiastical_units eu ON eu.id = s.scope_unit_id
        WHERE s.expires_at > NOW()
        ORDER BY s.created_at DESC
        LIMIT 40`
    );

    const lineages = await getUnitLineagesMap(rows.map((r) => r.author_primary_unit_id));
    const stories = rows.map((r) => ({
      id: r.id,
      image_url: r.image_url || '',
      caption: r.caption || '',
      scripture_ref: r.scripture_ref || '',
      bg_gradient: r.bg_gradient || 'linear-gradient(145deg,#7A1C2E,#3E0D17)',
      created_at: r.created_at,
      expires_at: r.expires_at,
      scope_unit: r.scope_unit_id
        ? {
            id: r.scope_unit_id,
            name: r.scope_unit_name,
            country_code: r.scope_unit_country_code || '',
          }
        : null,
      author: serializeUserSummary(
        {
          id: r.author_id,
          username: r.author_username,
          full_name: r.author_full_name,
          title_prefix: r.author_title_prefix,
          ecclesiastical_rank: r.author_rank,
          religious_order_initials: r.author_order_initials,
          primary_unit_id: r.author_primary_unit_id,
          current_office_title: r.author_office_title,
          avatar_color: r.author_avatar_color,
          avatar_url: r.author_avatar_url,
          verification_status: r.author_verification_status,
          country_code: r.author_country_code,
        },
        lineages.get(r.author_primary_unit_id) || []
      ),
    }));

    return res.json({ stories });
  } catch (err) {
    console.error('[stories/list]', err);
    return res.status(500).json({ error: 'Failed to load stories' });
  }
});

// Publish a new Story — STRICTLY CLERGY ONLY
router.post('/', requireAuth, requireClergy, async (req, res) => {
  try {
    const {
      image_url = '',
      caption = '',
      scripture_ref = '',
      scope_unit_id,
      bg_gradient = 'linear-gradient(145deg,#7A1C2E,#3E0D17)',
    } = req.body || {};

    if (!image_url && !String(caption).trim()) {
      return res.status(400).json({ error: 'image_url or caption is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO stories (author_id, scope_unit_id, image_url, caption, scripture_ref, bg_gradient, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [
        req.user.id,
        scope_unit_id ? Number(scope_unit_id) : req.user.primary_unit_id,
        String(image_url).trim().slice(0, 1000),
        String(caption).trim().slice(0, 600),
        String(scripture_ref).trim().slice(0, 120),
        String(bg_gradient).trim().slice(0, 200),
      ]
    );

    return res.status(201).json({ story: rows[0] });
  } catch (err) {
    console.error('[stories/create]', err);
    return res.status(500).json({ error: 'Failed to publish story' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM stories WHERE id = $1 AND (author_id = $2 OR $3 = TRUE)', [
      id,
      req.user.id,
      Boolean(req.user.is_admin),
    ]);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[stories/delete]', err);
    return res.status(500).json({ error: 'Failed to delete story' });
  }
});

module.exports = router;
