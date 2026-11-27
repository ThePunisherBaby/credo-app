const os = require('os');
const { execSync } = require('child_process');
const { pool } = require('../db/pool');
const { getClientIp } = require('./systemState');

// Lightweight pure in-memory telemetry (never hammers PostgreSQL on pings!)
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // Active within last 5 minutes
const HISTORY_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // Persist unique IP touch at most once every 5 min

const activeSessions = new Map(); // sessionKey (`ip|userId`) -> session record
const lastDbFlush = new Map(); // sessionKey -> timestamp
const hourlyStatusBuckets = []; // { ts, code }
const peakSamples24h = []; // { ts, online, uniqueIps }
const sseClients = new Set();

function parseDeviceInfo(uaRaw) {
  const ua = String(uaRaw || '');
  let device = 'web';
  let osName = 'Desktop';
  if (/CredoAndroid|okhttp|Android/i.test(ua)) {
    device = 'android';
    osName = 'Android';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    device = 'ios';
    osName = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    osName = 'macOS';
  } else if (/Windows/i.test(ua)) {
    osName = 'Windows';
  } else if (/Linux/i.test(ua)) {
    osName = 'Linux';
  }
  return { device, osName, ua: ua.slice(0, 220) };
}

function recordRequestTelemetry(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/api/admin/telemetry/stream')) {
    return next();
  }
  const start = Date.now();
  const ip = getClientIp(req);
  const country = String(req.headers['cf-ipcountry'] || req.headers['x-country-code'] || 'DO').toUpperCase().slice(0, 4);
  const city = String(req.headers['cf-ipcity'] || '').slice(0, 60);
  const { device, osName, ua } = parseDeviceInfo(req.headers['user-agent']);

  res.on('finish', () => {
    const now = Date.now();
    const latencyMs = Math.max(1, now - start);
    const statusCode = res.statusCode || 200;

    hourlyStatusBuckets.push({ ts: now, code: statusCode });
    if (hourlyStatusBuckets.length > 12000) {
      hourlyStatusBuckets.splice(0, hourlyStatusBuckets.length - 8000);
    }

    // Ignore static image/css noise for session route display
    const isAsset = /\.(css|js|mjs|png|jpg|jpeg|webp|svg|ico|woff2?|map)$/i.test(req.path);
    const user = req.user || null;
    const key = `${ip}|${user ? user.id : 0}`;

    let rec = activeSessions.get(key);
    if (!rec) {
      rec = {
        key,
        ip,
        country,
        city,
        user_id: user ? user.id : null,
        username: user ? user.username : '',
        full_name: user ? user.full_name : '',
        plan_sku: user ? user.active_plan_sku || '' : '',
        device,
        os: osName,
        user_agent: ua,
        route: isAsset ? '/' : req.path,
        hits: 0,
        recentTicks: [],
        latencySum: 0,
        first_seen: now,
        last_seen: now,
      };
      activeSessions.set(key, rec);
    }

    rec.last_seen = now;
    rec.hits += 1;
    rec.latencySum += latencyMs;
    rec.recentTicks.push(now);
    const oneMinAgo = now - 60_000;
    while (rec.recentTicks.length && rec.recentTicks[0] < oneMinAgo) {
      rec.recentTicks.shift();
    }
    if (!isAsset) rec.route = req.path;
    if (user && !rec.user_id) {
      rec.user_id = user.id;
      rec.username = user.username;
      rec.full_name = user.full_name;
      rec.plan_sku = user.active_plan_sku || '';
    }

    // Throttled background persist to ip_visit_history (max once every 5 minutes per ip+user)
    const prevFlush = lastDbFlush.get(key) || 0;
    if (ip && now - prevFlush > HISTORY_FLUSH_INTERVAL_MS) {
      lastDbFlush.set(key, now);
      pool
        .query(
          `INSERT INTO ip_visit_history (ip_address, user_id, country_code, city, device_type, user_agent, hits_count, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
           ON CONFLICT (ip_address, COALESCE(user_id, 0)) DO UPDATE SET
             hits_count = ip_visit_history.hits_count + 1,
             country_code = CASE WHEN EXCLUDED.country_code <> '' THEN EXCLUDED.country_code ELSE ip_visit_history.country_code END,
             city = CASE WHEN EXCLUDED.city <> '' THEN EXCLUDED.city ELSE ip_visit_history.city END,
             device_type = EXCLUDED.device_type,
             user_agent = EXCLUDED.user_agent,
             last_seen_at = NOW()`,
          [ip, user ? user.id : null, country, city, device, ua]
        )
        .catch(() => {});

      if (user?.id) {
        pool
          .query(
            `UPDATE users SET last_ip = $2, last_user_agent = $3, last_seen_at = NOW() WHERE id = $1`,
            [user.id, ip, ua]
          )
          .catch(() => {});
      }
    }
  });

  next();
}

function pruneStale() {
  const now = Date.now();
  const cutoff = now - ACTIVE_WINDOW_MS;
  for (const [k, v] of activeSessions.entries()) {
    if (v.last_seen < cutoff) activeSessions.delete(k);
  }
  const hourAgo = now - 3600_000;
  while (hourlyStatusBuckets.length && hourlyStatusBuckets[0].ts < hourAgo) {
    hourlyStatusBuckets.shift();
  }
  const dayAgo = now - 24 * 3600_000;
  while (peakSamples24h.length && peakSamples24h[0].ts < dayAgo) {
    peakSamples24h.shift();
  }
}

function getActiveNetworkSnapshot() {
  pruneStale();
  const now = Date.now();
  const sessions = [];
  const uniqueIps = new Set();
  const registeredIds = new Set();
  let anonymousCount = 0;
  const byDevice = { web: 0, android: 0, ios: 0 };

  for (const rec of activeSessions.values()) {
    uniqueIps.add(rec.ip);
    if (rec.user_id) registeredIds.add(rec.user_id);
    else anonymousCount += 1;
    byDevice[rec.device] = (byDevice[rec.device] || 0) + 1;

    sessions.push({
      key: rec.key,
      ip: rec.ip,
      country: rec.country,
      city: rec.city,
      user_id: rec.user_id,
      username: rec.username,
      full_name: rec.full_name,
      plan_sku: rec.plan_sku,
      device: rec.device,
      os: rec.os,
      user_agent: rec.user_agent,
      route: rec.route,
      rpm: rec.recentTicks.filter((t) => now - t < 60_000).length,
      avg_latency_ms: Math.round(rec.latencySum / Math.max(1, rec.hits)),
      connected_sec: Math.max(1, Math.round((now - rec.first_seen) / 1000)),
      last_seen_sec: Math.max(0, Math.round((now - rec.last_seen) / 1000)),
    });
  }

  sessions.sort((a, b) => a.last_seen_sec - b.last_seen_sec);

  const onlineTotal = registeredIds.size + anonymousCount;
  peakSamples24h.push({ ts: now, online: onlineTotal, uniqueIps: uniqueIps.size });
  if (peakSamples24h.length > 2000) peakSamples24h.shift();

  const peak24hOnline = peakSamples24h.reduce((m, s) => Math.max(m, s.online), onlineTotal);
  const peak24hIps = peakSamples24h.reduce((m, s) => Math.max(m, s.uniqueIps), uniqueIps.size);

  let http4xx = 0;
  let http5xx = 0;
  let httpTotal1h = hourlyStatusBuckets.length;
  for (const b of hourlyStatusBuckets) {
    if (b.code >= 500) http5xx += 1;
    else if (b.code >= 400) http4xx += 1;
  }

  return {
    online: {
      total: onlineTotal,
      registered: registeredIds.size,
      anonymous: anonymousCount,
      by_device: byDevice,
    },
    network: {
      unique_ips_now: uniqueIps.size,
      peak_24h_online: peak24hOnline,
      peak_24h_ips: peak24hIps,
      http_total_1h: httpTotal1h,
      http_4xx_1h: http4xx,
      http_5xx_1h: http5xx,
    },
    sessions: sessions.slice(0, 150),
  };
}

let cachedInventory = { ts: 0, data: null };
async function getGlobalInventoryAndHealth() {
  const now = Date.now();
  const dbStart = Date.now();
  let dbPingMs = 0;
  let dbConnections = 0;

  try {
    const pingRes = await pool.query(
      `SELECT COUNT(*)::int AS active_conns FROM pg_stat_activity WHERE datname = current_database()`
    );
    dbPingMs = Math.max(1, Date.now() - dbStart);
    dbConnections = pingRes.rows[0]?.active_conns || 0;
  } catch {
    dbPingMs = -1;
  }

  if (!cachedInventory.data || now - cachedInventory.ts > 12_000) {
    try {
      const [invRes, mediaRes, liveRes, ipRes] = await Promise.all([
        pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM users) AS total_users,
            (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '24 hours') AS new_users_24h,
            (SELECT COUNT(*)::int FROM posts WHERE media_kind = 'video' OR video_url <> '' OR youtube_id <> '') AS total_videos,
            (SELECT COUNT(*)::int FROM posts WHERE media_kind = 'photo' OR (image_url <> '' AND media_kind <> 'video')) AS total_photos,
            (SELECT COUNT(*)::int FROM posts) AS total_posts,
            (SELECT COUNT(*)::int FROM prayer_intentions) AS total_prayers,
            (SELECT COUNT(*)::int FROM registration_requests WHERE status = 'pending') AS pending_requests,
            (SELECT COUNT(*)::int FROM content_reports WHERE status = 'pending') AS pending_reports
        `),
        pool.query(`
          SELECT COUNT(*)::int AS media_objects,
                 COALESCE(SUM(size_bytes), 0)::bigint AS storage_bytes
            FROM media_objects
           WHERE status = 'ready'
        `).catch(() => ({ rows: [{ media_objects: 0, storage_bytes: 0 }] })),
        pool.query(`
          SELECT COUNT(*) FILTER (WHERE is_live = TRUE)::int AS active_streams,
                 COALESCE(SUM(listeners_count) FILTER (WHERE is_live = TRUE), 0)::int AS total_listeners
            FROM live_channels
        `).catch(() => ({ rows: [{ active_streams: 0, total_listeners: 0 }] })),
        pool.query(`
          SELECT COUNT(DISTINCT ip_address)::int AS total_unique_ips_all_time,
                 COUNT(DISTINCT ip_address) FILTER (WHERE last_seen_at > NOW() - INTERVAL '24 hours')::int AS unique_ips_24h
            FROM ip_visit_history
        `).catch(() => ({ rows: [{ total_unique_ips_all_time: 0, unique_ips_24h: 0 }] })),
      ]);

      const i = invRes.rows[0] || {};
      const m = mediaRes.rows[0] || {};
      const l = liveRes.rows[0] || {};
      const ipr = ipRes.rows[0] || {};

      cachedInventory = {
        ts: now,
        data: {
          total_users: Number(i.total_users || 0),
          new_users_24h: Number(i.new_users_24h || 0),
          total_videos: Number(i.total_videos || 0),
          total_photos: Number(i.total_photos || 0),
          total_posts: Number(i.total_posts || 0),
          total_prayers: Number(i.total_prayers || 0),
          pending_requests: Number(i.pending_requests || 0),
          pending_reports: Number(i.pending_reports || 0),
          media_objects: Number(m.media_objects || 0),
          storage_bytes: Number(m.storage_bytes || 0),
          storage_gb: Number((Number(m.storage_bytes || 0) / (1024 ** 3)).toFixed(3)),
          active_streams: Number(l.active_streams || 0),
          live_listeners: Number(l.total_listeners || 0),
          total_unique_ips_all_time: Number(ipr.total_unique_ips_all_time || 0),
          unique_ips_24h: Number(ipr.unique_ips_24h || 0),
        },
      };
    } catch (err) {
      console.warn('[telemetry/inventory]', err.message);
    }
  }

  let disk = { total_gb: 0, used_gb: 0, pct: 0 };
  try {
    const dfOut = execSync('df -k / | tail -n 1', { encoding: 'utf8', timeout: 1000 }).trim().split(/\s+/);
    const totalKb = Number(dfOut[1] || 0);
    const usedKb = Number(dfOut[2] || 0);
    if (totalKb > 0) {
      disk = {
        total_gb: Number((totalKb / (1024 * 1024)).toFixed(1)),
        used_gb: Number((usedKb / (1024 * 1024)).toFixed(1)),
        pct: Math.round((usedKb / totalKb) * 100),
      };
    }
  } catch {}

  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const procMem = process.memoryUsage();
  const cpus = os.cpus().length || 1;
  const load1 = Number((os.loadavg()[0] || 0).toFixed(2));

  return {
    inventory: cachedInventory.data || {},
    health: {
      cpu_cores: cpus,
      load_1m: load1,
      cpu_pct: Math.min(100, Math.round((load1 / cpus) * 100)),
      ram_total_mb: Math.round(memTotal / (1024 * 1024)),
      ram_used_mb: Math.round(memUsed / (1024 * 1024)),
      ram_pct: Math.round((memUsed / Math.max(1, memTotal)) * 100),
      process_rss_mb: Math.round(procMem.rss / (1024 * 1024)),
      uptime_sec: Math.round(process.uptime()),
      disk,
      db_ping_ms: dbPingMs,
      db_active_connections: dbConnections,
      node_version: process.version,
    },
  };
}

function evictSessionsForUserOrIp({ userId, ip }) {
  for (const [k, v] of activeSessions.entries()) {
    if ((userId && v.user_id === Number(userId)) || (ip && v.ip === ip)) {
      activeSessions.delete(k);
    }
  }
}

async function buildLiveSnapshot() {
  const net = getActiveNetworkSnapshot();
  const sys = await getGlobalInventoryAndHealth();
  return {
    ts: new Date().toISOString(),
    ...net,
    ...sys,
  };
}

let sseTimer = null;
function startSseBroadcastLoop() {
  if (sseTimer) return;
  sseTimer = setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
      const payload = `data: ${JSON.stringify(await buildLiveSnapshot())}\n\n`;
      for (const res of sseClients) {
        if (res.writableEnded || res.destroyed) {
          sseClients.delete(res);
        } else {
          try {
            res.write(payload);
          } catch {
            sseClients.delete(res);
          }
        }
      }
    } catch {}
  }, 3000);
}

function attachSseClient(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sseClients.add(res);
  startSseBroadcastLoop();

  buildLiveSnapshot()
    .then((snap) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify(snap)}\n\n`);
      }
    })
    .catch(() => {});

  req.on('close', () => {
    sseClients.delete(res);
  });
}

module.exports = {
  recordRequestTelemetry,
  getActiveNetworkSnapshot,
  buildLiveSnapshot,
  attachSseClient,
  evictSessionsForUserOrIp,
};
