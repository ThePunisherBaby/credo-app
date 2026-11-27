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

const {
  MEDIA_STORAGE_URL,
  MEDIA_STORAGE_SECRET,
  MEDIA_PUBLIC_BASE_URL,
  MEDIA_EDGE_UPLOAD_URL,
} = require('../config');

const ALLOWED_MEDIA = {
  'image/webp': { ext: 'webp', kind: 'image', maxBytes: 20 * 1024 * 1024 },
  'image/jpeg': { ext: 'jpg', kind: 'image', maxBytes: 20 * 1024 * 1024 },
  'image/jpg': { ext: 'jpg', kind: 'image', maxBytes: 20 * 1024 * 1024 },
  'image/png': { ext: 'png', kind: 'image', maxBytes: 20 * 1024 * 1024 },
  'image/gif': { ext: 'gif', kind: 'image', maxBytes: 20 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', kind: 'video', maxBytes: 500 * 1024 * 1024 },
  'video/webm': { ext: 'webm', kind: 'video', maxBytes: 500 * 1024 * 1024 },
  'video/quicktime': { ext: 'mov', kind: 'video', maxBytes: 500 * 1024 * 1024 },
  'audio/mpeg': { ext: 'mp3', kind: 'audio', maxBytes: 120 * 1024 * 1024 },
  'audio/mp3': { ext: 'mp3', kind: 'audio', maxBytes: 120 * 1024 * 1024 },
  'audio/mp4': { ext: 'm4a', kind: 'audio', maxBytes: 120 * 1024 * 1024 },
  'audio/x-m4a': { ext: 'm4a', kind: 'audio', maxBytes: 120 * 1024 * 1024 },
};

function isEdgeStorageReady() {
  return Boolean(MEDIA_STORAGE_URL && MEDIA_STORAGE_SECRET);
}

function verifyMagicBytes(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  const spec = ALLOWED_MEDIA[mime];
  if (!spec) return false;
  if (spec.kind === 'image') {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return true; // WebP
    if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return true; // GIF
    return false;
  }
  if (spec.kind === 'video' || spec.kind === 'audio') {
    const box = buf.subarray(4, 8).toString('ascii');
    if (['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(box)) return true; // MP4 / MOV / M4A
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true; // WebM / Matroska
    if (buf.subarray(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return true; // MP3
    return false;
  }
  return false;
}

function buildDatePrefix() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}/${m}`;
}

async function recordMediaObject({
  sha256Hash = null,
  objectKey,
  publicUrl,
  uploaderId = null,
  mediaKind,
  mimeType,
  sizeBytes,
  width = null,
  height = null,
  durationSec = null,
  posterUrl = '',
}) {
  try {
    await pool.query(
      `INSERT INTO media_objects (
         sha256_hash, storage_node_key, object_key, public_url, uploader_id,
         media_kind, mime_type, size_bytes, width, height, duration_sec, poster_url, status
       ) VALUES ($1, 'interserver-4tb-edge', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ready')
       ON CONFLICT (object_key) DO UPDATE SET
         status = 'ready',
         ref_count = media_objects.ref_count + 1,
         updated_at = NOW()`,
      [
        sha256Hash && /^[a-f0-9]{64}$/.test(sha256Hash) ? sha256Hash : null,
        objectKey,
        publicUrl,
        uploaderId,
        mediaKind,
        mimeType,
        sizeBytes,
        width,
        height,
        durationSec,
        posterUrl || '',
      ]
    );
  } catch (e) {
    console.warn('[media_objects record]', e.message);
  }
}

async function pushBufferToEdgeStorage(buffer, ext, { uploaderId = null, mediaKind = 'image', mimeType = 'image/webp' } = {}) {
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex');

  // O(1) PostgreSQL SHA-256 lookup before network hop
  try {
    const existing = await pool.query(
      `UPDATE media_objects
          SET ref_count = ref_count + 1, updated_at = NOW()
        WHERE sha256_hash = $1 AND status = 'ready'
        RETURNING public_url, object_key, size_bytes`,
      [bodyHash]
    );
    if (existing.rows[0]) {
      return {
        url: existing.rows[0].public_url,
        key: existing.rows[0].object_key,
        bytes: Number(existing.rows[0].size_bytes),
        deduplicated: true,
        storage: 'cloudflare-edge-4tb',
      };
    }
  } catch {}

  const key = `${buildDatePrefix()}/${bodyHash.slice(0, 32)}.${ext}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const payload = `put\n${key}\n${ts}\n${bodyHash}`;
  const sig = crypto.createHmac('sha256', MEDIA_STORAGE_SECRET).update(payload).digest('hex');

  const res = await fetch(MEDIA_STORAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Credo-Action': 'put',
      'X-Credo-Key': key,
      'X-Credo-Ts': ts,
      'X-Credo-Sig': sig,
    },
    body: buffer,
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Edge storage error (${res.status}): ${txt.slice(0, 140)}`);
  }
  const data = await res.json();
  const publicUrl = data.url || `${MEDIA_PUBLIC_BASE_URL}/${key}`;

  await recordMediaObject({
    sha256Hash: bodyHash,
    objectKey: key,
    publicUrl,
    uploaderId,
    mediaKind,
    mimeType,
    sizeBytes: buffer.length,
  });

  return {
    url: publicUrl,
    key,
    bytes: buffer.length,
    deduplicated: Boolean(data.deduplicated),
    storage: 'cloudflare-edge-4tb',
  };
}

// POST /api/v1/media/presign — Mints a short-lived HMAC-SHA256 upload ticket + O(1) PostgreSQL SHA-256 instant deduplication
router.post('/presign', requireAuth, async (req, res) => {
  try {
    const { getSetting } = require('../services/systemState');
    const { isUserSuperAdmin } = require('../middleware/auth');
    if (getSetting('pause_media_uploads')?.enabled && !isUserSuperAdmin(req.user)) {
      return res.status(503).json({ error: 'La subida de fotos y videos está pausada temporalmente por la administración.' });
    }
    const mime = String(req.body?.mime_type || '').trim().toLowerCase();
    const sizeBytes = Number(req.body?.size_bytes || 0);
    const sha256 = String(req.body?.sha256 || '').trim().toLowerCase();
    const spec = ALLOWED_MEDIA[mime];

    if (!spec) {
      return res.status(415).json({ error: 'Formato de archivo no permitido.' });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > spec.maxBytes) {
      const mbLimit = Math.round(spec.maxBytes / (1024 * 1024));
      return res.status(413).json({ error: `El archivo supera el límite permitido (${mbLimit} MB).` });
    }

    // Lightning 0-byte deduplication: if SHA-256 already exists in PostgreSQL media_objects, return CDN URL immediately!
    if (/^[a-f0-9]{64}$/.test(sha256)) {
      const hit = await pool.query(
        `UPDATE media_objects
            SET ref_count = ref_count + 1, updated_at = NOW()
          WHERE sha256_hash = $1 AND status = 'ready'
          RETURNING public_url, object_key, media_kind`,
        [sha256]
      );
      if (hit.rows[0]) {
        return res.status(200).json({
          instant_dedup: true,
          direct_supported: true,
          public_url: hit.rows[0].public_url,
          kind: hit.rows[0].media_kind,
        });
      }
    }

    if (!isEdgeStorageReady()) {
      return res.status(200).json({ direct_supported: false });
    }

    const sessionId = crypto.randomUUID();
    const randId = crypto.randomBytes(12).toString('hex');
    const key = `${buildDatePrefix()}/u${req.user.id}-${randId}.${spec.ext}`;
    const publicUrl = `${MEDIA_PUBLIC_BASE_URL}/${key}`;
    const chunkBytes = 8 * 1024 * 1024;
    const chunksTotal = Math.max(1, Math.ceil(sizeBytes / chunkBytes));
    const maxBytes = Math.min(spec.maxBytes, Math.ceil(sizeBytes * 1.05) + 65536);
    const exp = Math.floor(Date.now() / 1000) + 900; // 15 minutes
    const payload = `upload\n${key}\n${mime}\n${maxBytes}\n${exp}`;
    const sig = crypto.createHmac('sha256', MEDIA_STORAGE_SECRET).update(payload).digest('hex');

    await pool.query(
      `INSERT INTO media_upload_sessions (
         session_id, user_id, object_key, mime_type, media_kind,
         declared_bytes, sha256_hash, chunks_total, public_url, status, ip_address, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'issued',$10,TO_TIMESTAMP($11))`,
      [
        sessionId,
        req.user.id,
        key,
        mime,
        spec.kind,
        Math.round(sizeBytes),
        /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null,
        chunksTotal,
        publicUrl,
        String(req.ip || '').slice(0, 64),
        exp,
      ]
    );

    return res.status(200).json({
      session_id: sessionId,
      instant_dedup: false,
      direct_supported: true,
      upload_url: MEDIA_EDGE_UPLOAD_URL,
      public_url: publicUrl,
      chunk_bytes: chunkBytes,
      kind: spec.kind,
      ticket: {
        key,
        mime,
        max_bytes: String(maxBytes),
        exp: String(exp),
        sig,
      },
    });
  } catch (err) {
    console.error('[media/presign]', err);
    return res.status(500).json({ error: 'No se pudo autorizar la transferencia.' });
  }
});

// POST /api/v1/media/complete — Commits direct Edge upload into PostgreSQL media_objects catalog
router.post('/complete', requireAuth, async (req, res) => {
  try {
    const { session_id, width = null, height = null, duration_sec = null, poster_url = '' } = req.body || {};
    if (!session_id) {
      return res.status(400).json({ error: 'session_id requerido' });
    }
    const { rows } = await pool.query(
      `UPDATE media_upload_sessions
          SET status = 'completed', completed_at = NOW()
        WHERE session_id = $1 AND user_id = $2 AND status IN ('issued', 'completed')
        RETURNING *`,
      [String(session_id), req.user.id]
    );
    const sess = rows[0];
    if (!sess) {
      return res.status(404).json({ error: 'Sesión de subida no encontrada.' });
    }

    await recordMediaObject({
      sha256Hash: sess.sha256_hash,
      objectKey: sess.object_key,
      publicUrl: sess.public_url,
      uploaderId: req.user.id,
      mediaKind: sess.media_kind,
      mimeType: sess.mime_type,
      sizeBytes: Number(sess.declared_bytes),
      width: width ? Number(width) : null,
      height: height ? Number(height) : null,
      durationSec: duration_sec ? Number(duration_sec) : null,
      posterUrl: String(poster_url || '').slice(0, 1000),
    });

    return res.status(200).json({ ok: true, url: sess.public_url, kind: sess.media_kind });
  } catch (err) {
    console.error('[media/complete]', err);
    return res.status(500).json({ error: 'No se pudo registrar el objeto multimedia.' });
  }
});

// GET /api/v1/media/storage-status — Live PostgreSQL catalog + InterServer 4TB ZFS telemetry
router.get('/storage-status', requireAuth, async (req, res) => {
  try {
    const [nodeRes, aggRes] = await Promise.all([
      pool.query(`SELECT * FROM storage_nodes WHERE is_primary = TRUE LIMIT 1`),
      pool.query(
        `SELECT COUNT(*)::int AS total_objects,
                COALESCE(SUM(size_bytes), 0)::bigint AS catalog_bytes
           FROM media_objects
          WHERE status = 'ready'`
      ),
    ]);
    return res.json({
      node: nodeRes.rows[0] || null,
      catalog: aggRes.rows[0] || { total_objects: 0, catalog_bytes: 0 },
      edge_ready: isEdgeStorageReady(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/media/binary — Zero-Base64 raw binary upload relay (358 Mbps VPS -> 4TB Edge Storage)
router.post(
  '/binary',
  requireAuth,
  express.raw({ type: '*/*', limit: '48mb' }),
  async (req, res) => {
    try {
      const mime = String(req.headers['x-media-mime'] || req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const spec = ALLOWED_MEDIA[mime];
      if (!spec) {
        return res.status(415).json({ error: 'Formato de archivo no soportado.' });
      }

      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > spec.maxBytes) {
        return res.status(413).json({ error: 'Tamaño de archivo inválido o excesivo.' });
      }
      if (!verifyMagicBytes(buffer, mime)) {
        return res.status(415).json({ error: 'Cabecera binaria del archivo no válida.' });
      }

      if (isEdgeStorageReady()) {
        const stored = await pushBufferToEdgeStorage(buffer, spec.ext, {
          uploaderId: req.user.id,
          mediaKind: spec.kind,
          mimeType: mime,
        });
        return res.status(201).json({
          url: stored.url,
          kind: spec.kind,
          bytes: stored.bytes,
          deduplicated: stored.deduplicated,
          storage: stored.storage,
        });
      }

      if (spec.kind !== 'image' || buffer.length > MAX_BYTES) {
        return res.status(503).json({ error: 'Almacenamiento multimedia de alta capacidad no disponible.' });
      }

      const { rows } = await pool.query(
        `INSERT INTO media_assets (uploader_id, mime_type, data) VALUES ($1, $2, $3) RETURNING id`,
        [req.user.id, mime, buffer]
      );
      return res.status(201).json({ id: rows[0].id, url: `/api/v1/media/${rows[0].id}`, kind: 'image' });
    } catch (err) {
      console.error('[media/binary]', err);
      return res.status(500).json({ error: 'Error transfiriendo archivo.' });
    }
  }
);

// Upload compressed photo (legacy data_url caller compatibility — automatically offloads to 4TB Edge CDN!)
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
    const spec = ALLOWED_MEDIA[mimeType];
    if (!spec || spec.kind !== 'image') {
      return res.status(400).json({ error: 'Unsupported image format (use WebP, JPEG, or PNG)' });
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > spec.maxBytes) {
      return res.status(413).json({ error: 'Image too large' });
    }
    if (!verifyMagicBytes(buffer, mimeType)) {
      return res.status(415).json({ error: 'Invalid image binary signature' });
    }

    if (isEdgeStorageReady()) {
      try {
        const stored = await pushBufferToEdgeStorage(buffer, spec.ext, {
          uploaderId: req.user.id,
          mediaKind: 'image',
          mimeType,
        });
        return res.status(201).json({
          url: stored.url,
          storage: stored.storage,
        });
      } catch (edgeErr) {
        console.warn('[media/upload edge fallback]', edgeErr.message);
      }
    }

    if (buffer.length > MAX_BYTES) {
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
