const https = require('https');
const http = require('http');
const express = require('express');
const { pool } = require('../db/pool');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

const DEFAULT_UPSTREAM = 'https://paginas.moisespaulino.com/proxy/moises2020/stream';

// Warm shared upstream Icecast/Shoutcast relay with a 48KB rolling ring buffer
// so mobile <audio> elements receive 8 seconds of frame-aligned MP3 audio in < 10ms!
class WarmRadioRelay {
  constructor(upstreamUrl) {
    this.upstreamUrl = upstreamUrl;
    this.clients = new Set();
    this.ringChunks = [];
    this.ringBytes = 0;
    this.maxRingBytes = 48 * 1024;
    this.req = null;
    this.idleTimer = null;
    this.connecting = false;
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.clients.size === 0) this.stopUpstream();
    }, 180000);
    if (!this.req && !this.connecting) {
      this.startUpstream();
    }
  }

  startUpstream() {
    if (this.req || this.connecting) return;
    this.connecting = true;
    const mod = this.upstreamUrl.startsWith('https') ? https : http;
    let syncedToFrame = false;

    const req = mod.get(
      this.upstreamUrl,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CredoLiveRelay/2.0)',
          Accept: '*/*',
          'Icy-MetaData': '0',
        },
        timeout: 15000,
      },
      (upRes) => {
        this.connecting = false;
        if (upRes.statusCode && upRes.statusCode >= 300 && upRes.statusCode < 400 && upRes.headers.location) {
          this.upstreamUrl = upRes.headers.location;
          this.req = null;
          this.startUpstream();
          return;
        }
        upRes.on('data', (chunk) => {
          let data = chunk;
          if (!syncedToFrame) {
            for (let i = 0; i < data.length - 1; i += 1) {
              if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) {
                data = data.subarray(i);
                syncedToFrame = true;
                break;
              }
            }
            if (!syncedToFrame) return;
          }

          this.ringChunks.push(data);
          this.ringBytes += data.length;
          while (this.ringBytes > this.maxRingBytes && this.ringChunks.length > 1) {
            const old = this.ringChunks.shift();
            this.ringBytes -= old.length;
          }

          for (const clientRes of this.clients) {
            if (clientRes.writableEnded || clientRes.destroyed) {
              this.clients.delete(clientRes);
            } else {
              try {
                clientRes.write(data);
              } catch {
                this.clients.delete(clientRes);
              }
            }
          }
        });

        upRes.on('end', () => {
          this.req = null;
          if (this.clients.size > 0) {
            setTimeout(() => this.startUpstream(), 1000);
          }
        });
      }
    );

    this.req = req;
    req.on('error', (err) => {
      console.warn('[live/relay] upstream error:', err.message);
      this.connecting = false;
      this.req = null;
      if (this.clients.size > 0) {
        setTimeout(() => this.startUpstream(), 1500);
      }
    });
  }

  stopUpstream() {
    if (this.req) {
      try { this.req.destroy(); } catch {}
      this.req = null;
    }
    this.connecting = false;
  }

  addClient(req, res) {
    this.touch();
    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    // Flush warm ring buffer immediately so playback starts in < 10ms
    if (this.ringChunks.length > 0) {
      const burst = Buffer.concat(this.ringChunks);
      // Align burst start to MP3 frame header
      let start = 0;
      for (let i = 0; i < Math.min(burst.length - 1, 2048); i += 1) {
        if (burst[i] === 0xff && (burst[i + 1] & 0xe0) === 0xe0) {
          start = i;
          break;
        }
      }
      try {
        res.write(burst.subarray(start));
      } catch {}
    }

    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
      this.touch();
    });
  }
}

const relays = new Map();
function getRelay(url) {
  const target = url || DEFAULT_UPSTREAM;
  if (!relays.has(target)) {
    relays.set(target, new WarmRadioRelay(target));
  }
  const r = relays.get(target);
  r.touch();
  return r;
}

// Pre-warm primary Aire 96 FM / Reflexionando stream on startup
setTimeout(() => {
  try { getRelay(DEFAULT_UPSTREAM); } catch {}
}, 1500);

// GET /api/v1/live/stream/:slug — Instant pre-buffered same-origin MP3 radio stream
router.get('/stream/:slug', async (req, res) => {
  try {
    const { getSetting } = require('../services/systemState');
    if (getSetting('pause_live_streams')?.enabled) {
      return res.status(503).json({ error: 'Las transmisiones en vivo están pausadas temporalmente.' });
    }
    const slug = String(req.params.slug || '').toLowerCase();
    let upstream = DEFAULT_UPSTREAM;
    const { rows } = await pool.query(
      'SELECT stream_url, is_live FROM live_channels WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (rows[0] && rows[0].is_live === false) {
      return res.status(503).json({ error: 'Esta transmisión fue detenida por la administración.' });
    }
    if (rows[0]?.stream_url && /^https?:\/\//i.test(rows[0].stream_url)) {
      upstream = rows[0].stream_url;
    }
    const relay = getRelay(upstream);
    return relay.addClient(req, res);
  } catch (err) {
    console.error('[live/stream]', err);
    if (!res.headersSent) res.status(502).json({ error: 'Stream relay unavailable' });
  }
});

// GET /api/v1/live — ONLY real official radio channels (no EWTN, no mock TV, no 24/7 Rosary radio)
router.get('/', async (_req, res) => {
  try {
    const { getSetting } = require('../services/systemState');
    if (getSetting('pause_live_streams')?.enabled) {
      return res.json({ hero: null, radios: [], tv_channels: [], live_masses: [], all: [], paused: true });
    }
    getRelay(DEFAULT_UPSTREAM);

    const payload = await apiCache.getOrLoad('live:channels', 20000, async () => {
      const { rows } = await pool.query(
        `SELECT id, slug, name, kind, tagline, current_program, host_name,
                frequency, country_code, city, accent_color, cover_url,
                stream_url, youtube_live_id, is_hero, is_live, listeners_count, sort_order
           FROM live_channels
          WHERE kind = 'radio' AND is_live = TRUE AND slug IN ('aire-96', 'reflexionando-la-palabra')
          ORDER BY is_hero DESC, sort_order ASC, id ASC`
      );

      const radios = rows.map((c) => ({
        ...c,
        accent_color: '#007AFF',
        direct_stream_url: c.stream_url || DEFAULT_UPSTREAM,
        stream_url: `/api/v1/live/stream/${encodeURIComponent(c.slug)}`,
      }));

      const hero = radios.find((c) => c.is_hero) || radios[0] || null;
      return {
        hero,
        radios,
        tv_channels: [],
        live_masses: [],
        all: radios,
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return res.json(payload);
  } catch (err) {
    console.error('[live/list]', err);
    return res.status(500).json({ error: 'Failed to load live channels' });
  }
});

// GET /api/v1/live/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isNum = /^\d+$/.test(id);
    const { rows } = await pool.query(
      `SELECT * FROM live_channels WHERE ${isNum ? 'id = $1' : 'slug = $1'} LIMIT 1`,
      [isNum ? Number(id) : id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    return res.json({ channel: rows[0] });
  } catch (err) {
    console.error('[live/detail]', err);
    return res.status(500).json({ error: 'Failed to load channel' });
  }
});

module.exports = router;
