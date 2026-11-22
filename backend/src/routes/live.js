const express = require('express');
const { pool } = require('../db/pool');
const { getLiveCatholicReels } = require('../utils/officialSync');
const { getLiturgicalContext } = require('../services/rosaryRadio');

const router = express.Router();

// GET /api/v1/live — Real Radios, 24/7 Rosary Radio, Catholic TV & Live Masses
router.get('/', async (_req, res) => {
  try {
    const [{ rows }, videos, rosaryCtx] = await Promise.all([
      pool.query(
        `SELECT id, slug, name, kind, tagline, current_program, host_name,
                frequency, country_code, city, accent_color, cover_url,
                stream_url, youtube_live_id, is_hero, is_live, listeners_count, sort_order
           FROM live_channels
          ORDER BY is_hero DESC, sort_order ASC, id ASC`
      ),
      getLiveCatholicReels(),
      Promise.resolve(getLiturgicalContext()),
    ]);

    const rosaryRadio = {
      id: 9001,
      slug: 'credo-rosario',
      name: 'Credo Radio Rosario 24/7',
      kind: 'radio',
      tagline: `${rosaryCtx.liturgical_season} · Horarios: 7am, 2pm, 4pm, 8pm`,
      current_program: rosaryCtx.is_live_rosary
        ? `EN VIVO: ${rosaryCtx.mystery.name}`
        : `Próximo: ${rosaryCtx.next_rosary_label} (${rosaryCtx.mystery.name})`,
      host_name: 'Grupo de Oración Credo',
      frequency: rosaryCtx.is_live_rosary ? 'ROSARIO EN VIVO' : '24/7 AUTOMÁTICO',
      country_code: 'DO',
      city: 'República Dominicana',
      accent_color: '#007AFF',
      cover_url: '/icons/credo-512.png',
      stream_url: '/api/v1/rosary/stream',
      youtube_live_id: '',
      is_hero: false,
      is_live: true,
      listeners_count: 0,
      sort_order: 3,
    };

    const radios = [...rows.filter((c) => c.kind === 'radio'), rosaryRadio];

    const live_masses = (videos || [])
      .filter((v) => /misa|eucarist|homil[ií]a|angelus|ángelus/i.test(v.title))
      .slice(0, 8)
      .map((v, idx) => ({
        id: 9100 + idx,
        slug: `mass-${v.youtube_id}`,
        name: v.title,
        kind: 'mass',
        tagline: `${v.channel_name} · Celebración Oficial`,
        current_program: v.channel_name,
        frequency: 'MISA / LITURGIA',
        accent_color: '#007AFF',
        cover_url: v.thumbnail_url,
        youtube_live_id: v.youtube_id,
        published_at: v.published_at,
        source_url: v.source_url,
      }));

    const tv_channels = (videos || [])
      .filter((v) => !/misa diaria/i.test(v.title))
      .slice(0, 8)
      .map((v, idx) => ({
        id: 9200 + idx,
        slug: `tv-${v.youtube_id}`,
        name: v.title,
        kind: 'tv',
        tagline: v.channel_name,
        current_program: v.channel_name,
        frequency: 'SEÑAL VIDEO',
        accent_color: '#007AFF',
        cover_url: v.thumbnail_url,
        youtube_live_id: v.youtube_id,
        published_at: v.published_at,
        source_url: v.source_url,
      }));

    const hero = rows.find((c) => c.is_hero) || radios[0] || null;
    const allRadios = [...radios];

    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return res.json({
      hero,
      radios: allRadios,
      tv_channels,
      live_masses,
      all: allRadios,
      rosary_status: rosaryCtx,
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
