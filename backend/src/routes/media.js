const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB max after client-side compression

// Upload compressed photo (for clergy posts/stories or user profile avatars)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { data_url } = req.body || {};
    if (!data_url || typeof data_url !== 'string') {
      return res.status(400).json({ error: 'data_url is required' });
    }

    const match = data_url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image data_url format' });
    }

    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_MIMES.has(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image format (use JPEG, PNG, or WebP)' });
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Image too large (max 3 MB)' });
    }

    const { rows } = await pool.query(
      `INSERT INTO media_assets (uploader_id, mime_type, data)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.user.id, mimeType, buffer]
    );

    const id = rows[0].id;
    return res.status(201).json({
      id,
      url: `/api/v1/media/${id}`,
    });
  } catch (err) {
    console.error('[media/upload]', err);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
});

const { ALLOWED_PROXY_HOSTS } = require('../utils/officialSync');

// Allowlisted image proxy for official P. Domingo Vásquez portals (prevents hotlink blocks)
router.get('/proxy', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).send('url required');
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !ALLOWED_PROXY_HOSTS.has(parsed.hostname.toLowerCase())) {
      return res.status(403).send('Host not allowed');
    }
    const upstream = await fetch(parsed.toString(), {
      headers: {
        Referer: `${parsed.origin}/`,
        'User-Agent': 'Mozilla/5.0 (compatible; CredoApp/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error');
    const contentType = upstream.headers.get('content-type') || 'image/webp';
    if (!contentType.startsWith('image/')) return res.status(415).send('Not an image');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  } catch (err) {
    console.warn('[media/proxy]', err.message);
    return res.status(502).send('Failed to fetch official image');
  }
});

// Stream image with aggressive immutable browser caching
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).send('Invalid media id');
    }
    const { rows } = await pool.query(
      `SELECT mime_type, data FROM media_assets WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Not found');
    }
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(rows[0].data);
  } catch (err) {
    console.error('[media/get]', err);
    return res.status(500).send('Error loading media');
  }
});

module.exports = router;
