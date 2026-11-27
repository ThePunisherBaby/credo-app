const crypto = require('crypto');
const { pool } = require('../db/pool');
const { MEDIA_STORAGE_URL, MEDIA_STORAGE_SECRET } = require('../config');

const DEFAULT_SETTINGS = {
  maintenance_mode: { enabled: false, message: 'Credo está en mantenimiento programado. Volveremos en unos minutos.' },
  block_registrations: { enabled: false },
  pause_media_uploads: { enabled: false },
  pause_live_streams: { enabled: false },
  pause_global_ads: { enabled: false },
  pause_paypal_checkout: { enabled: false },
  min_mobile_version: { version: '1.0.0', force_update: false },
  banned_words: { words: [] },
  cedula_providers: {
    verifik_token: '',
    custom_api_url: '',
    custom_api_key: '',
    enable_dgii: true,
    enable_photo_ocr: true,
  },
};

let settingsCache = { ...DEFAULT_SETTINGS };
let ipBansCache = [];
let lastLoadedAt = 0;

function normalizeIp(raw) {
  let ip = String(raw || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  const xff = req.headers['x-forwarded-for'];
  return normalizeIp(cf || xff || req.ip || req.socket?.remoteAddress || '');
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return (((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3]) >>> 0;
}

function ipMatchesRule(ip, rule) {
  const cleanIp = normalizeIp(ip);
  const cleanRule = String(rule || '').trim();
  if (!cleanIp || !cleanRule) return false;
  if (cleanIp === cleanRule) return true;
  if (cleanRule.includes('/')) {
    const [base, bitsStr] = cleanRule.split('/');
    const bits = Number(bitsStr);
    const ipInt = ipv4ToInt(cleanIp);
    const baseInt = ipv4ToInt(base);
    if (ipInt !== null && baseInt !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    }
  }
  return false;
}

async function refreshSystemState() {
  try {
    const [setRes, banRes] = await Promise.all([
      pool.query('SELECT key, value_json FROM system_settings'),
      pool.query('SELECT id, ip_or_cidr, reason, expires_at FROM ip_bans WHERE expires_at IS NULL OR expires_at > NOW()'),
    ]);
    const nextSettings = { ...DEFAULT_SETTINGS };
    for (const row of setRes.rows) {
      nextSettings[row.key] = row.value_json;
    }
    settingsCache = nextSettings;
    ipBansCache = banRes.rows;
    lastLoadedAt = Date.now();
  } catch (err) {
    console.warn('[systemState/refresh]', err.message);
  }
}

function ensureBackgroundRefresh() {
  if (Date.now() - lastLoadedAt > 30_000) {
    refreshSystemState().catch(() => {});
  }
}

function getAllSettings() {
  ensureBackgroundRefresh();
  return settingsCache;
}

function getSetting(key) {
  ensureBackgroundRefresh();
  return settingsCache[key] ?? DEFAULT_SETTINGS[key] ?? null;
}

async function setSetting(key, valueObj, adminUser) {
  await pool.query(
    `INSERT INTO system_settings (key, value_json, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value_json = EXCLUDED.value_json,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [key, JSON.stringify(valueObj), adminUser?.id || null]
  );
  settingsCache = { ...settingsCache, [key]: valueObj };
  return valueObj;
}

function findActiveIpBan(ip) {
  ensureBackgroundRefresh();
  const now = Date.now();
  for (const ban of ipBansCache) {
    if (ban.expires_at && new Date(ban.expires_at).getTime() <= now) continue;
    if (ipMatchesRule(ip, ban.ip_or_cidr)) return ban;
  }
  return null;
}

function containsBannedWord(text) {
  const words = getSetting('banned_words')?.words || [];
  if (!Array.isArray(words) || words.length === 0) return null;
  const hay = String(text || '').toLowerCase();
  for (const raw of words) {
    const w = String(raw || '').trim().toLowerCase();
    if (w && hay.includes(w)) return w;
  }
  return null;
}

async function writeAdminAudit({ admin, action, targetType = '', targetId = '', before = null, after = null, ip = '' }) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_id, admin_name, action, target_type, target_id, before_json, after_json, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        admin?.id || null,
        String(admin?.full_name || admin?.username || 'Super-Admin').slice(0, 120),
        String(action || 'unknown').slice(0, 120),
        String(targetType || '').slice(0, 60),
        String(targetId || '').slice(0, 80),
        before !== null ? JSON.stringify(before) : null,
        after !== null ? JSON.stringify(after) : null,
        String(ip || '').slice(0, 64),
      ]
    );
  } catch (err) {
    console.warn('[adminAudit]', err.message);
  }
}

async function deleteEdgeMediaByUrl(publicUrl) {
  if (!publicUrl || !MEDIA_STORAGE_URL || !MEDIA_STORAGE_SECRET) return false;
  try {
    const hit = await pool.query(
      `SELECT id, object_key FROM media_objects WHERE public_url = $1 AND status = 'ready' LIMIT 1`,
      [publicUrl]
    );
    const objKey = hit.rows[0]?.object_key;
    if (!objKey) return false;

    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto
      .createHmac('sha256', MEDIA_STORAGE_SECRET)
      .update(`delete\n${objKey}\n${ts}\n`)
      .digest('hex');

    await fetch(MEDIA_STORAGE_URL, {
      method: 'POST',
      headers: {
        'X-Credo-Action': 'delete',
        'X-Credo-Key': objKey,
        'X-Credo-Ts': ts,
        'X-Credo-Sig': sig,
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});

    await pool.query(`UPDATE media_objects SET status = 'deleted', updated_at = NOW() WHERE id = $1`, [hit.rows[0].id]);
    return true;
  } catch {
    return false;
  }
}

// Express middleware: immediately blocks banned IPs / CIDRs
function ipBanMiddleware(req, res, next) {
  if (req.path === '/health') return next();
  const ip = getClientIp(req);
  const ban = findActiveIpBan(ip);
  if (ban) {
    return res.status(403).json({
      error: 'IP_BANNED',
      message: ban.reason || 'Acceso bloqueado por la administración de Credo.',
    });
  }
  return next();
}

// Express middleware: Maintenance Mode (allows /health, /diosesmiguia, /api/admin/*, /api/v1/auth/login)
function maintenanceMiddleware(req, res, next) {
  const m = getSetting('maintenance_mode');
  if (!m?.enabled) return next();

  const p = req.path || '';
  if (
    p === '/health' ||
    p === '/robots.txt' ||
    p.startsWith('/diosesmiguia') ||
    p.startsWith('/api/admin') ||
    p.startsWith('/api/v1/panel-admin') ||
    p.startsWith('/api/webhooks') ||
    p === '/api/v1/auth/login'
  ) {
    return next();
  }

  if (p.startsWith('/api/')) {
    return res.status(503).json({
      error: 'MAINTENANCE_MODE',
      message: m.message || 'Credo está en mantenimiento programado.',
    });
  }

  // Allow static assets for maintenance screen/logo
  if (/\.(css|js|mjs|png|jpg|svg|webp|ico|woff2?)$/i.test(p)) return next();

  const safeMsg = String(m.message || 'Credo está en mantenimiento programado. Volveremos en unos minutos.')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return res.status(503).send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credo — Mantenimiento</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:24px;text-align:center}.card{max-width:460px;padding:32px;border:1px solid #1F1F26;border-radius:16px;background:#0A0A0D}h1{margin:12px 0 8px;font-size:1.4rem}p{color:#9CA3AF;line-height:1.5;margin:0}</style></head><body><div class="card"><img src="/icons/credo-192.png" alt="Credo" width="56" height="56" style="border-radius:14px"><h1>Mantenimiento en curso</h1><p>${safeMsg}</p></div></body></html>`);
}

module.exports = {
  normalizeIp,
  getClientIp,
  ipMatchesRule,
  refreshSystemState,
  getAllSettings,
  getSetting,
  setSetting,
  findActiveIpBan,
  containsBannedWord,
  writeAdminAudit,
  deleteEdgeMediaByUrl,
  ipBanMiddleware,
  maintenanceMiddleware,
};
