const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { ALLOWED_PROXY_HOSTS } = require('../utils/officialSync');

const router = express.Router();

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 3 * 1024 * 1024;

// Persistent on-disk + RAM LRU cache for proxied external images (zero repeat WordPress round-trips)
const PROXY_DISK_DIR = '/tmp/credo-img-cache';
try {
  fs.mkdirSync(PROXY_DISK_DIR, { recursive: true });
} catch {}

const proxyLru = new Map(); // hash -> { contentType, data, etag }
let proxyLruBytes = 0;
const MAX_PROXY_LRU_ITEMS = 80;
const MAX_PROXY_LRU_BYTES = 28 * 1024 * 1024;
const proxyInFlight = new Map();

function putProxyLru(hash, entry) {
  if (!entry?.data || entry.data.length > 2.5 * 1024 * 1024) return;
  if (proxyLru.has(hash)) {
    proxyLruBytes -= proxyLru.get(hash).data.length;
    proxyLru.delete(hash);
  }
  while (proxyLru.size >= MAX_PROXY_LRU_ITEMS || proxyLruBytes + entry.data.length > MAX_PROXY_LRU_BYTES) {
    const oldest = proxyLru.keys().next().value;
    if (oldest === undefined) break;
    proxyLruBytes -= proxyLru.get(oldest).data.length;
    proxyLru.delete(oldest);
  }
  proxyLru.set(hash, entry);
  proxyLruBytes += entry.data.length;
}

async function fetchAndCacheProxyImage(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const hash = crypto.createHash('sha1').update(urlStr).digest('hex');
  const etag = `"px-${hash.slice(0, 14)}"`;

  // 1. RAM LRU hit (<0.1ms)
  const mem = proxyLru.get(hash);
  if (mem) {
    proxyLru.delete(hash);
    proxyLru.set(hash, mem);
    return mem;
  }

  // 2. Disk cache hit (~1ms)
  const dataPath = path.join(PROXY_DISK_DIR, `${hash}.bin`);
  const metaPath = path.join(PROXY_DISK_DIR, `${hash}.meta`);
  try {
    if (fs.existsSync(dataPath) && fs.existsSync(metaPath)) {
      const [data, contentType] = await Promise.all([
        fs.promises.readFile(dataPath),
        fs.promises.readFile(metaPath, 'utf8'),
      ]);
      if (data.length > 0) {
        const entry = { contentType: contentType.trim() || 'image/webp', data, etag };
        putProxyLru(hash, entry);
        return entry;
      }
    }
  } catch {}

  // 3. Singleflight deduplication so 50 concurrent viewers only trigger ONE upstream fetch
  if (proxyInFlight.has(hash)) {
    return proxyInFlight.get(hash);
  }

  const p = (async () => {
    const upstream = await fetch(urlStr, {
      headers: {
        Referer: `${parsedUrl.origin}/`,
        'User-Agent': 'Mozilla/5.0 (compatible; CredoApp/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      const err = new Error(`Upstream ${upstream.status}`);
      err.status = upstream.status;
      throw err;
    }
    const contentType = (upstream.headers.get('content-type') || 'image/webp').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      const err = new Error('Not an image');
      err.status = 415;
      throw err;
    }
    const data = Buffer.from(await upstream.arrayBuffer());
    const entry = { contentType, data, etag };
    putProxyLru(hash, entry);
    // Persist asynchronously to disk so restarts/evictions stay instant
    Promise.all([
      fs.promises.writeFile(dataPath, data).catch(() => {}),
      fs.promises.writeFile(metaPath, contentType).catch(() => {}),
    ]).catch(() => {});
    return entry;
  })();

  proxyInFlight.set(hash, p);
  try {
    return await p;
  } finally {
    proxyInFlight.delete(hash);
  }
}

// Pre-warm latest feed images & clergy avatars into VPS RAM/disk on startup
async function warmUpProxyImages() {
  try {
    const [postsRes, usersRes] = await Promise.all([
      pool.query(`SELECT image_url FROM posts WHERE image_url LIKE '/api/v1/media/proxy?url=%' OR image_url LIKE 'https://%' ORDER BY created_at DESC LIMIT 18`),
      pool.query(`SELECT avatar_url FROM users WHERE avatar_url LIKE 'https://%' LIMIT 10`),
    ]);
    const rawUrls = new Set();
    for (const r of [...postsRes.rows, ...usersRes.rows]) {
      const u = r.image_url || r.avatar_url || '';
      if (u.startsWith('/api/v1/media/proxy?url=')) {
        try { rawUrls.add(decodeURIComponent(u.slice('/api/v1/media/proxy?url='.length))); } catch {}
      } else if (u.startsWith('https://')) {
        rawUrls.add(u);
      }
    }
    rawUrls.add('https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png');

    for (const urlStr of rawUrls) {
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol === 'https:' && ALLOWED_PROXY_HOSTS.has(parsed.hostname.toLowerCase())) {
          await fetchAndCacheProxyImage(parsed);
        }
      } catch {}
    }
    console.log(`[media] Warmed ${proxyLru.size} proxied images into RAM/disk cache`);
  } catch (err) {
    console.warn('[media/warmup]', err.message);
  }
}

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

// Allowlisted high-speed cached image proxy for official P. Domingo Vásquez portals
router.get('/proxy', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).send('url required');
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !ALLOWED_PROXY_HOSTS.has(parsed.hostname.toLowerCase())) {
      return res.status(403).send('Host not allowed');
    }

    const hash = crypto.createHash('sha1').update(parsed.toString()).digest('hex');
    const expectedEtag = `"px-${hash.slice(0, 14)}"`;
    if (req.headers['if-none-match'] === expectedEtag) {
      res.setHeader('ETag', expectedEtag);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.status(304).end();
    }

    const entry = await fetchAndCacheProxyImage(parsed);
    res.setHeader('ETag', entry.etag);
    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(entry.data);
  } catch (err) {
    console.warn('[media/proxy]', err.message);
    return res.status(err.status || 502).send('Failed to fetch official image');
  }
});

// Bounded hot-media LRU cache (max 48 items / 24 MB total) so avatars & feed media never thrash PostgreSQL BYTEA
const mediaLru = new Map();
let mediaLruBytes = 0;
const MAX_MEDIA_LRU_ITEMS = 48;
const MAX_MEDIA_LRU_BYTES = 24 * 1024 * 1024;

function putMediaCache(id, entry) {
  if (!entry?.data || entry.data.length > 2 * 1024 * 1024) return;
  if (mediaLru.has(id)) {
    mediaLruBytes -= mediaLru.get(id).data.length;
    mediaLru.delete(id);
  }
  while (mediaLru.size >= MAX_MEDIA_LRU_ITEMS || mediaLruBytes + entry.data.length > MAX_MEDIA_LRU_BYTES) {
    const oldest = mediaLru.keys().next().value;
    if (oldest === undefined) break;
    mediaLruBytes -= mediaLru.get(oldest).data.length;
    mediaLru.delete(oldest);
  }
  mediaLru.set(id, entry);
  mediaLruBytes += entry.data.length;
}

// Stream image with aggressive immutable caching + ETag + zero-DB repeat hits
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).send('Invalid media id');
    }

    const etag = `"m-${id}"`;
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(304).end();
    }

    let item = mediaLru.get(id);
    if (item) {
      mediaLru.delete(id);
      mediaLru.set(id, item);
    } else {
      const { rows } = await pool.query(
        `SELECT mime_type, data FROM media_assets WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).send('Not found');
      }
      item = { mime_type: rows[0].mime_type, data: rows[0].data };
      putMediaCache(id, item);
    }

    res.setHeader('ETag', etag);
    res.setHeader('Content-Type', item.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(item.data);
  } catch (err) {
    console.error('[media/get]', err);
    return res.status(500).send('Error loading media');
  }
});

router.warmUpProxyImages = warmUpProxyImages;
module.exports = router;
