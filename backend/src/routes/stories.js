const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireClergy } = require('../middleware/auth');
const { serializeUserSummary } = require('../utils/hierarchy');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

// List active Credo stories (singleflight cached for massive concurrent reads)
router.get('/', async (_req, res) => {
  try {
    const stories = await apiCache.getOrLoad('stories:active', 15000, async () => {
      const { rows } = await pool.query(
        `SELECT s.id, s.author_id, s.image_url, s.video_url, s.youtube_id, s.caption,
                s.scripture_ref, s.bg_gradient, s.created_at, s.expires_at,
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
                COALESCE(u.is_ceo, FALSE) AS author_is_ceo,
                COALESCE(u.is_cto, FALSE) AS author_is_cto
           FROM stories s
           JOIN users u ON u.id = s.author_id
          WHERE s.expires_at > NOW()
          ORDER BY COALESCE(u.is_ceo, FALSE) DESC, COALESCE(u.is_cto, FALSE) DESC, s.created_at DESC
          LIMIT 25`
      );

      return rows.map((r) => ({
        id: r.id,
        is_video: Boolean(r.video_url || r.youtube_id),
        video_url: r.video_url || '',
        youtube_id: r.youtube_id || '',
        image_url: r.image_url || (r.youtube_id ? `https://i.ytimg.com/vi/${r.youtube_id}/hqdefault.jpg` : ''),
        caption: r.caption || '',
        scripture_ref: r.scripture_ref || '',
        bg_gradient: r.bg_gradient || 'linear-gradient(145deg,#0A1931,#102542)',
        created_at: r.created_at,
        expires_at: r.expires_at,
        scope_unit: null,
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
            is_ceo: Boolean(r.author_is_ceo),
            is_cto: Boolean(r.author_is_cto),
          },
          []
        ),
      }));
    });

    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
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
      video_url = '',
      youtube_id = '',
      caption = '',
      scripture_ref = '',
      scope_unit_id,
      bg_gradient = 'linear-gradient(145deg,#0B1424,#13233E)',
    } = req.body || {};

    if (!image_url && !video_url && !youtube_id && !String(caption).trim()) {
      return res.status(400).json({ error: 'video_url, image_url, or caption is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO stories (author_id, scope_unit_id, image_url, video_url, youtube_id, caption, scripture_ref, bg_gradient, expires_at)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [
        req.user.id,
        String(image_url).trim().slice(0, 1000),
        String(video_url).trim().slice(0, 1000),
        String(youtube_id).trim().slice(0, 40),
        String(caption).trim().slice(0, 600),
        String(scripture_ref).trim().slice(0, 120),
        String(bg_gradient).trim().slice(0, 200),
      ]
    );

    apiCache.invalidate('stories:');
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
    apiCache.invalidate('stories:');
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[stories/delete]', err);
    return res.status(500).json({ error: 'Failed to delete story' });
  }
});

module.exports = router;
