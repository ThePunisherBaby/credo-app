const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  CACHE_DIR,
  getLiturgicalContext,
  resolveActiveAudioSource,
  synthesizeSpeechToFile,
} = require('../services/rosaryRadio');
const { formatTextForSpeech } = require('../utils/speechText');

const router = express.Router();

// GET /api/v1/rosary/tts — Real Human Neural Voice (es-DO-EmilioNeural / es-DO-RamonaNeural) MP3 generator
router.get('/tts', async (req, res) => {
  try {
    const rawText = String(req.query.text || '').trim().slice(0, 3800);
    const spoken = formatTextForSpeech(rawText);
    if (!spoken) return res.status(400).json({ error: 'text required' });
    const voice = req.query.voice === 'female' ? 'es-DO-RamonaNeural' : 'es-DO-EmilioNeural';
    const hash = crypto.createHash('sha1').update(`${voice}:v2:${spoken}`).digest('hex').slice(0, 20);
    const ttsDir = path.join(CACHE_DIR, 'tts_cache');
    fs.mkdirSync(ttsDir, { recursive: true });
    const outPath = path.join(ttsDir, `tts_v2_${hash}.mp3`);
    await synthesizeSpeechToFile(spoken, outPath, voice);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, no-transform');
    return res.sendFile(outPath);
  } catch (err) {
    console.error('[rosary/tts]', err);
    return res.status(500).json({ error: 'TTS failed' });
  }
});

function findAudioStartOffset(buf) {
  let start = 0;
  // Skip ID3v2 tag if present so looping/seeking never hits non-audio metadata
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const id3Size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    start = Math.min(buf.length - 4, 10 + id3Size);
  }
  return alignToMp3Frame(buf, start);
}

function alignToMp3Frame(buf, fromPos) {
  const maxScan = Math.min(buf.length - 2, fromPos + 2048);
  for (let i = Math.max(0, fromPos); i < maxScan; i += 1) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      return i;
    }
  }
  return Math.max(0, Math.min(fromPos, buf.length - 1));
}

// GET /api/v1/rosary/status — Live schedule, current Mystery, Liturgical season, Repertoire, and tracks
const { apiCache } = require('../utils/fastCache');
router.get('/status', async (_req, res) => {
  try {
    const payload = await apiCache.getOrLoad('rosary:status', 20_000, async () => {
      const ctx = getLiturgicalContext();
      const { rows: tracks } = await pool.query(
        `SELECT id, slot_type, title, created_at FROM rosary_audio_tracks ORDER BY created_at DESC LIMIT 30`
      );
      return { status: ctx, tracks };
    });
    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=90');
    return res.json(payload);
  } catch (err) {
    console.error('[rosary/status]', err);
    return res.status(500).json({ error: 'Failed to load rosary radio status' });
  }
});

// GET /api/v1/rosary/audio/:slot — Direct on-demand full MP3 with HTTP Range support for instant playback & seeking
router.get('/audio/:slot', async (req, res) => {
  try {
    const requestedSlot = String(req.params.slot || '').replace(/\.mp3$/i, '');
    const youtubeId = String(req.query.yt || '');
    const { filePath } = await resolveActiveAudioSource({ requestedSlot, youtubeId });
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: 'Preparando audio del Santo Rosario' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    return res.sendFile(filePath);
  } catch (err) {
    console.error('[rosary/audio]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error cargando audio del Rosario' });
  }
});

// GET /api/v1/rosary/stream — Continuous real-time 24/7 MP3 broadcast (instant 48KB pre-burst + 64kbps frame pump)
router.get('/stream', async (req, res) => {
  try {
    const requestedSlot = String(req.query.slot || '');
    const youtubeId = String(req.query.yt || '');
    const { filePath, isOnDemand } = await resolveActiveAudioSource({ requestedSlot, youtubeId });

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: 'Rosary stream preparing audio' });
    }

    // If requested on-demand with a Range header, serve via sendFile so seeking works natively
    if (isOnDemand && req.headers.range) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      return res.sendFile(filePath);
    }

    const buf = fs.readFileSync(filePath);
    if (buf.length < 1024) {
      return res.status(503).json({ error: 'Audio file initializing' });
    }

    const audioStart = findAudioStartOffset(buf);
    const payloadLen = Math.max(1, buf.length - audioStart);

    // 64 kbps = 8000 bytes/sec
    const BYTES_PER_SEC = 8000;
    let pos = audioStart;
    if (!isOnDemand) {
      const syncOffset = (Math.floor(Date.now() / 1000) * BYTES_PER_SEC) % payloadLen;
      pos = alignToMp3Frame(buf, audioStart + syncOffset);
    }

    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const writeWrap = (byteCount) => {
      let remaining = byteCount;
      while (remaining > 0 && !res.writableEnded && !res.destroyed) {
        const avail = buf.length - pos;
        const take = Math.min(remaining, avail);
        res.write(buf.subarray(pos, pos + take));
        pos += take;
        remaining -= take;
        if (pos >= buf.length) {
          pos = audioStart;
        }
      }
    };

    // Instant 48 KB (6 seconds of audio) initial burst so mobile <audio> starts decoding in < 20ms!
    writeWrap(48000);

    // Pump 2000 bytes every 250ms (= 8000 bytes/sec = 64 kbps CBR)
    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(timer);
        return;
      }
      try {
        writeWrap(2000);
      } catch {
        clearInterval(timer);
      }
    }, 250);

    req.on('close', () => {
      clearInterval(timer);
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

// DELETE /api/v1/rosary/tracks/:id
router.delete('/tracks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM rosary_audio_tracks WHERE id = $1', [Number(req.params.id)]);
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error eliminando pista' });
  }
});

module.exports = router;
