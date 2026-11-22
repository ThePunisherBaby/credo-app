const express = require('express');
const { spawn } = require('child_process');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getLiturgicalContext, resolveActiveAudioSource } = require('../services/rosaryRadio');

const router = express.Router();

// GET /api/v1/rosary/status — Live schedule, current Mystery, Liturgical season, and tracks
router.get('/status', async (_req, res) => {
  try {
    const ctx = getLiturgicalContext();
    const { rows: tracks } = await pool.query(
      `SELECT id, slot_type, title, created_at FROM rosary_audio_tracks ORDER BY created_at DESC LIMIT 30`
    );
    res.setHeader('Cache-Control', 'no-cache');
    return res.json({ status: ctx, tracks });
  } catch (err) {
    console.error('[rosary/status]', err);
    return res.status(500).json({ error: 'Failed to load rosary radio status' });
  }
});

// GET /api/v1/rosary/stream — Continuous real-time MP3 broadcast (synchronized across listeners)
router.get('/stream', async (req, res) => {
  try {
    const { filePath, ctx } = await resolveActiveAudioSource();

    // Sync offset modulo ~360s loop for simultaneous group listening
    const loopModSec = ctx.is_live_rosary ? 420 : 120;
    const offsetSec = Math.floor(Date.now() / 1000) % loopModSec;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ff = spawn('ffmpeg', [
      '-re',
      '-stream_loop', '-1',
      '-i', filePath,
      '-ss', String(offsetSec % 90),
      '-c', 'copy',
      '-f', 'mp3',
      'pipe:1',
    ]);

    ff.stdout.pipe(res);
    req.on('close', () => {
      try { ff.kill('SIGKILL'); } catch {}
    });
    ff.on('error', (err) => {
      console.warn('[rosary/stream] ffmpeg err:', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } catch (err) {
    console.error('[rosary/stream]', err);
    if (!res.headersSent) {
      res.status(503).json({ error: 'Rosary stream preparing audio' });
    }
  }
});

// POST /api/v1/rosary/tracks — CEO/Admin uploads real Rosary audio or radio promo/aviso (MP3)
router.post('/tracks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { slot_type = 'promo', title = '', data_url = '' } = req.body || {};
    const allowedSlots = new Set(['joyful', 'sorrowful', 'glorious', 'luminous', 'promo', 'interlude']);
    if (!allowedSlots.has(slot_type)) {
      return res.status(400).json({ error: 'Invalid slot_type' });
    }
    const cleanTitle = String(title).trim().slice(0, 140);
    if (!cleanTitle) {
      return res.status(400).json({ error: 'El título es requerido' });
    }
    const m = String(data_url).match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) {
      return res.status(400).json({ error: 'Sube un archivo de audio MP3 válido' });
    }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0 || buf.length > 15 * 1024 * 1024) {
      return res.status(413).json({ error: 'Audio demasiado pesado (máx 15 MB)' });
    }
    const { rows } = await pool.query(
      `INSERT INTO rosary_audio_tracks (uploader_id, slot_type, title, mime_type, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slot_type, title, created_at`,
      [req.user.id, slot_type, cleanTitle, m[1].toLowerCase(), buf]
    );
    return res.status(201).json({ track: rows[0] });
  } catch (err) {
    console.error('[rosary/upload]', err);
    return res.status(500).json({ error: 'Error al subir audio de radio' });
  }
});

router.delete('/tracks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    await pool.query('DELETE FROM rosary_audio_tracks WHERE id = $1', [id]);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[rosary/delete]', err);
    return res.status(500).json({ error: 'Error al eliminar pista' });
  }
});

module.exports = router;
