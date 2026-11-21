const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/v1/live — Real active Radio/TV channels (zero mock sponsors)
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, name, kind, tagline, current_program, host_name,
              frequency, country_code, city, accent_color, cover_url,
              stream_url, youtube_live_id, is_hero, is_live, listeners_count, sort_order
         FROM live_channels
        ORDER BY is_hero DESC, sort_order ASC, id ASC`
    );

    const hero = rows.find((c) => c.is_hero) || rows[0] || null;
    const radios = rows.filter((c) => c.kind === 'radio');
    const tv_channels = rows.filter((c) => c.kind === 'tv');

    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return res.json({
      hero,
      radios,
      tv_channels,
      all: rows,
      sponsor_preroll: null,
    });
  } catch (err) {
    console.error('[live/list]', err);
    return res.status(500).json({ error: 'Failed to load live channels' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid channel id' });
    }
    const { rows } = await pool.query('SELECT * FROM live_channels WHERE id = $1', [id]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Live channel not found' });
    }
    return res.json({ channel: rows[0] });
  } catch (err) {
    console.error('[live/detail]', err);
    return res.status(500).json({ error: 'Failed to load channel' });
  }
});

module.exports = router;
