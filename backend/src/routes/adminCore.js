const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const {
  requireSuperAdmin,
  isUserSuperAdmin,
  isIpAllowedForAdmin,
  signToken,
  signImpersonationToken,
} = require('../middleware/auth');
const {
  getClientIp,
  refreshSystemState,
  getAllSettings,
  setSetting,
  writeAdminAudit,
  deleteEdgeMediaByUrl,
} = require('../services/systemState');
const {
  buildLiveSnapshot,
  attachSseClient,
  evictSessionsForUserOrIp,
} = require('../services/liveTelemetry');
const { decryptCedula, formatCedula } = require('../services/cedulaVerifier');
const { ensureOrgForSubscription, reconcileUserEntitlements } = require('../middleware/rbac');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

const CSV_ESCAPE = (v) => {
  const s = String(v ?? '').replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
};

const failedAdminLogins = new Map(); // ip -> { count, firstAt }

function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '').trim()).digest('hex');
}

async function recordFailedAdminLogin(ip, loginId) {
  if (!ip) return;
  const now = Date.now();
  const prev = failedAdminLogins.get(ip);
  const entry = !prev || now - prev.firstAt > 15 * 60_000 ? { count: 1, firstAt: now } : { count: prev.count + 1, firstAt: prev.firstAt };
  failedAdminLogins.set(ip, entry);

  if (entry.count >= 6) {
    failedAdminLogins.delete(ip);
    const expiresAt = new Date(now + 24 * 3600_000).toISOString();
    await pool
      .query(
        `INSERT INTO ip_bans (ip_or_cidr, reason, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (ip_or_cidr) DO UPDATE SET
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           created_at = NOW()`,
        [ip, `[WAF Brute-Force] 6+ intentos fallidos en Credo Core OS (${String(loginId).slice(0, 40)})`, expiresAt]
      )
      .catch(() => {});
    await refreshSystemState();
    evictSessionsForUserOrIp({ ip });
  }
}

// ============================================================================
// SUPER-ADMIN DEDICATED AUTH (/api/admin/auth/*)
// ============================================================================
router.post('/auth/login', async (req, res) => {
  try {
    if (!isIpAllowedForAdmin(req)) {
      return res.status(403).json({ error: 'IP no autorizada para acceder a Credo Core OS.' });
    }
    const ip = getClientIp(req);
    const { identifier, email, password } = req.body || {};
    const loginId = String(identifier || email || '').trim().toLowerCase();
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Ingresa tu usuario/correo y contraseña.' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1 LIMIT 1`,
      [loginId]
    );
    const user = rows[0];
    if (!user || !isUserSuperAdmin(user)) {
      await recordFailedAdminLogin(ip, loginId);
      return res.status(403).json({ error: 'Acceso denegado. Cuenta sin privilegios super_admin.' });
    }
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      await recordFailedAdminLogin(ip, loginId);
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    failedAdminLogins.delete(ip);
    await writeAdminAudit({
      admin: user,
      action: 'admin.login',
      targetType: 'session',
      targetId: String(user.id),
      after: { username: user.username, ip },
      ip,
    });

    const token = signToken(user);
    return res.json({
      token,
      admin: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: 'super_admin',
        avatar_url: user.avatar_url || '',
      },
    });
  } catch (err) {
    console.error('[admin/auth/login]', err);
    return res.status(500).json({ error: 'Error al autenticar en Credo Core OS.' });
  }
});

// Verify single-use Super-Admin invite token (read-only check, does NOT consume token)
router.get('/auth/invite/:token', async (req, res) => {
  try {
    if (!isIpAllowedForAdmin(req)) {
      return res.status(403).json({ valid: false, error: 'IP no autorizada para acceder a Credo Core OS.' });
    }
    const raw = String(req.params.token || '').trim();
    if (!raw || raw.length < 16 || raw.length > 160) {
      return res.status(404).json({ valid: false, error: 'Enlace de invitación inválido.' });
    }
    const tokenHash = hashInviteToken(raw);
    const { rows } = await pool.query(
      `SELECT id, label, expires_at, used_at FROM admin_invite_tokens WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    const inv = rows[0];
    if (!inv) {
      return res.status(404).json({ valid: false, error: 'Este enlace de registro no existe o fue revocado.' });
    }
    if (inv.used_at) {
      return res.status(410).json({ valid: false, error: 'Este enlace de un solo uso ya fue utilizado.' });
    }
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ valid: false, error: 'Este enlace de un solo uso ha expirado.' });
    }
    return res.json({
      valid: true,
      label: inv.label,
      expires_at: inv.expires_at,
    });
  } catch (err) {
    console.error('[admin/auth/invite]', err);
    return res.status(500).json({ valid: false, error: 'No se pudo validar el enlace de invitación.' });
  }
});

// Consume single-use invite token atomically and register/activate Super-Admin account
router.post('/auth/register-invite', async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isIpAllowedForAdmin(req)) {
      return res.status(403).json({ error: 'IP no autorizada para acceder a Credo Core OS.' });
    }
    const { token: rawToken, full_name, username, email, password } = req.body || {};
    const cleanToken = String(rawToken || '').trim();
    const cleanName = String(full_name || '').trim().slice(0, 120);
    const cleanUsername = String(username || '').trim().toLowerCase().replace(/^@+/, '');
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rawPass = String(password || '');

    if (!cleanToken || cleanToken.length < 16) {
      return res.status(400).json({ error: 'Enlace de invitación inválido.' });
    }
    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Ingresa tu nombre completo.' });
    }
    if (!/^[a-z0-9_]{3,28}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 28 caracteres (letras, números o _).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
    }
    if (rawPass.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const tokenHash = hashInviteToken(cleanToken);
    const ip = getClientIp(req);

    await client.query('BEGIN');
    const invRes = await client.query(
      `SELECT * FROM admin_invite_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );
    const inv = invRes.rows[0];
    if (!inv) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Este enlace de registro no existe o fue revocado.' });
    }
    if (inv.used_at) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Este enlace de un solo uso ya fue utilizado.' });
    }
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Este enlace de un solo uso ha expirado.' });
    }

    const passwordHash = await bcrypt.hash(rawPass, 12);

    const existingRes = await client.query(
      `SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2`,
      [cleanEmail, cleanUsername]
    );

    let user;
    if (existingRes.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ese correo y ese usuario pertenecen a cuentas distintas. Usa datos consistentes o nuevos.',
      });
    } else if (existingRes.rows.length === 1) {
      const ex = existingRes.rows[0];
      const updRes = await client.query(
        `UPDATE users
            SET full_name = $2,
                username = $3,
                email = $4,
                password_hash = $5,
                role = 'super_admin',
                is_admin = TRUE,
                verification_status = 'verified',
                cedula_verified = TRUE,
                account_status = 'active',
                moderation_status = 'active',
                token_version = COALESCE(token_version, 1) + 1,
                last_ip = $6,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [ex.id, cleanName, cleanUsername, cleanEmail, passwordHash, ip]
      );
      user = updRes.rows[0];
    } else {
      const insRes = await client.query(
        `INSERT INTO users (
           email, password_hash, username, full_name, title_prefix,
           ecclesiastical_rank, current_office_title, bio, country_code,
           languages, preferred_locale, avatar_color, verification_status,
           verification_note, cedula_verified, role, is_admin, account_status,
           moderation_status, last_ip
         ) VALUES (
           $1,$2,$3,$4,'','lay_faithful','Super-Admin Credo OS','',
           'DO',ARRAY['es'],'es','#0F1E36','verified','Registrado por enlace único Credo OS',
           TRUE,'super_admin',TRUE,'active','active',$5
         ) RETURNING *`,
        [cleanEmail, passwordHash, cleanUsername, cleanName, ip]
      );
      user = insRes.rows[0];
    }

    const burnRes = await client.query(
      `UPDATE admin_invite_tokens
          SET used_at = NOW(),
              used_by_user_id = $2,
              used_ip = $3
        WHERE id = $1 AND used_at IS NULL
        RETURNING id`,
      [inv.id, user.id, ip]
    );
    if (!burnRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Este enlace de un solo uso ya fue utilizado.' });
    }

    await client.query('COMMIT');
    apiCache.invalidate('users:');

    await writeAdminAudit({
      admin: user,
      action: 'admin.invite_registered',
      targetType: 'admin_invite',
      targetId: String(inv.id),
      after: { user_id: user.id, username: user.username, email: user.email, ip },
      ip,
    });

    const jwtToken = signToken(user);
    return res.status(201).json({
      token: jwtToken,
      admin: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: 'super_admin',
        avatar_url: user.avatar_url || '',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin/auth/register-invite]', err);
    return res.status(500).json({ error: 'No se pudo completar el registro en Credo Core OS.' });
  } finally {
    client.release();
  }
});

// Protect EVERY route below with strict Super-Admin + optional IP allowlist
router.use(requireSuperAdmin);

router.get('/auth/me', (req, res) => {
  const u = req.admin;
  return res.json({
    admin: {
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      email: u.email,
      role: 'super_admin',
      avatar_url: u.avatar_url || '',
    },
  });
});

// Generate a new single-use Super-Admin registration link from inside Core OS
router.post('/auth/invites', async (req, res) => {
  try {
    const ttlMinutes = Math.max(5, Math.min(1440, Number(req.body?.ttl_minutes) || 60));
    const label = String(req.body?.label || 'Registro Super-Admin Credo OS').trim().slice(0, 120);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    const { rows } = await pool.query(
      `INSERT INTO admin_invite_tokens (token_hash, label, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, label, expires_at, created_at`,
      [tokenHash, label, req.admin.id, expiresAt]
    );
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'credoapp.tech').split(',')[0].trim();
    const origin = host.includes('localhost') ? `http://${host}` : `https://${host}`;
    const inviteUrl = `${origin}/diosesmiguia?invite=${rawToken}`;

    await writeAdminAudit({
      admin: req.admin,
      action: 'admin.invite_created',
      targetType: 'admin_invite',
      targetId: String(rows[0].id),
      after: { label, expires_at: expiresAt },
      ip: getClientIp(req),
    });

    return res.status(201).json({
      invite: rows[0],
      invite_url: inviteUrl,
    });
  } catch (err) {
    console.error('[admin/auth/invites/create]', err);
    return res.status(500).json({ error: 'No se pudo generar el enlace de invitación.' });
  }
});

router.get('/auth/invites', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.label, i.expires_at, i.used_at, i.used_ip, i.created_at,
              cb.username AS created_by_username,
              ub.username AS used_by_username
         FROM admin_invite_tokens i
         LEFT JOIN users cb ON cb.id = i.created_by
         LEFT JOIN users ub ON ub.id = i.used_by_user_id
        ORDER BY i.created_at DESC
        LIMIT 30`
    );
    return res.json({ invites: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// COMMAND PALETTE GLOBAL SEARCH (Ctrl+K / Cmd+K)
// ============================================================================
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ users: [], posts: [], campaigns: [], ads: [], sessions: [] });
    const like = `%${q}%`;

    const [usersRes, postsRes, campsRes, adsRes] = await Promise.all([
      pool.query(
        `SELECT id, username, full_name, email, active_plan_sku, moderation_status, last_ip
           FROM users
          WHERE full_name ILIKE $1 OR username ILIKE $1 OR email ILIKE $1 OR last_ip ILIKE $1 OR CAST(id AS TEXT) = $2
          ORDER BY id DESC LIMIT 8`,
        [like, q]
      ),
      pool.query(
        `SELECT id, title, media_kind, created_at FROM posts
          WHERE title ILIKE $1 OR content ILIKE $1 OR CAST(id AS TEXT) = $2
          ORDER BY created_at DESC LIMIT 6`,
        [like, q]
      ),
      pool.query(
        `SELECT id, title, status, total_budget_cents FROM campaigns
          WHERE title ILIKE $1 OR CAST(id AS TEXT) = $2
          ORDER BY created_at DESC LIMIT 6`,
        [like, q]
      ),
      pool.query(
        `SELECT id, title, format, is_active FROM platform_ads
          WHERE title ILIKE $1 OR CAST(id AS TEXT) = $2
          ORDER BY created_at DESC LIMIT 6`,
        [like, q]
      ),
    ]);

    const snap = await buildLiveSnapshot();
    const ql = q.toLowerCase();
    const sessions = (snap.sessions || [])
      .filter((s) => s.ip.includes(ql) || (s.username || '').toLowerCase().includes(ql) || (s.route || '').toLowerCase().includes(ql))
      .slice(0, 6);

    return res.json({
      users: usersRes.rows,
      posts: postsRes.rows,
      campaigns: campsRes.rows,
      ads: adsRes.rows,
      sessions,
    });
  } catch (err) {
    console.error('[admin/search]', err);
    return res.status(500).json({ error: 'Error en búsqueda global' });
  }
});

// ============================================================================
// MODULE 1: LIVE TELEMETRY (SSE), NETWORK, IPS, IP BANS & SYSTEM HEALTH
// ============================================================================
router.get('/telemetry/snapshot', async (_req, res) => {
  try {
    return res.json(await buildLiveSnapshot());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/telemetry/stream', (req, res) => {
  attachSseClient(req, res);
});

router.get('/network/sessions', async (_req, res) => {
  try {
    const snap = await buildLiveSnapshot();
    const [bansRes, recentIpsRes, wafRes] = await Promise.all([
      pool.query(
        `SELECT b.*, u.username AS banned_by_name
           FROM ip_bans b
           LEFT JOIN users u ON u.id = b.banned_by
          ORDER BY b.created_at DESC LIMIT 200`
      ),
      pool.query(
        `SELECT h.ip_address, h.country_code, h.city, h.device_type,
                SUM(h.hits_count)::int AS total_hits,
                COUNT(DISTINCT h.user_id) FILTER (WHERE h.user_id IS NOT NULL)::int AS linked_accounts,
                MAX(h.last_seen_at) AS last_seen_at,
                MIN(h.first_seen_at) AS first_seen_at
           FROM ip_visit_history h
          GROUP BY h.ip_address, h.country_code, h.city, h.device_type
          ORDER BY MAX(h.last_seen_at) DESC
          LIMIT 150`
      ),
      pool.query(
        `SELECT id, ip_address, country_code, method, request_path, user_agent, rule_code, action_taken, created_at, last_seen_at
           FROM waf_events
          ORDER BY last_seen_at DESC
          LIMIT 120`
      ).catch(() => ({ rows: [] })),
    ]);

    return res.json({
      online: snap.online,
      network: snap.network,
      inventory: snap.inventory,
      sessions: snap.sessions,
      ip_bans: bansRes.rows,
      ip_history: recentIpsRes.rows,
      waf_events: wafRes.rows,
    });
  } catch (err) {
    console.error('[admin/network/sessions]', err);
    return res.status(500).json({ error: 'No se pudo cargar telemetría de red' });
  }
});

router.get('/network/ip/:ip/history', async (req, res) => {
  try {
    const ip = decodeURIComponent(req.params.ip || '').trim().toLowerCase();
    const [histRes, usersRes] = await Promise.all([
      pool.query(
        `SELECT h.*, u.username, u.full_name, u.email, u.moderation_status, u.active_plan_sku
           FROM ip_visit_history h
           LEFT JOIN users u ON u.id = h.user_id
          WHERE LOWER(h.ip_address) = $1
          ORDER BY h.last_seen_at DESC
          LIMIT 100`,
        [ip]
      ),
      pool.query(
        `SELECT id, username, full_name, email, moderation_status, active_plan_sku, last_seen_at, created_at
           FROM users
          WHERE LOWER(last_ip) = $1
          ORDER BY last_seen_at DESC NULLS LAST`,
        [ip]
      ),
    ]);
    return res.json({ ip, history: histRes.rows, accounts: usersRes.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/network/force-logout', async (req, res) => {
  try {
    const { user_id, ip } = req.body || {};
    if (user_id) {
      await pool.query(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = $1`, [Number(user_id)]);
    }
    evictSessionsForUserOrIp({ userId: user_id, ip });
    await writeAdminAudit({
      admin: req.admin,
      action: 'network.force_logout',
      targetType: user_id ? 'user' : 'ip',
      targetId: String(user_id || ip || ''),
      after: { user_id, ip },
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/network/ip-bans', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*, u.username AS banned_by_name
       FROM ip_bans b LEFT JOIN users u ON u.id = b.banned_by
      ORDER BY b.created_at DESC LIMIT 200`
  );
  return res.json({ ip_bans: rows });
});

router.post('/network/ip-bans', async (req, res) => {
  try {
    const { normalizeIp, ipMatchesRule } = require('../services/systemState');
    const { ip_or_cidr, reason = 'Bloqueo administrativo', hours = 0 } = req.body || {};
    const target = normalizeIp(ip_or_cidr);
    if (!target || target.length < 3 || target.length > 64) {
      return res.status(400).json({ error: 'IP o rango CIDR inválido.' });
    }
    const callerIp = getClientIp(req);
    if (ipMatchesRule(callerIp, target)) {
      return res.status(400).json({ error: 'No puedes bloquear tu propia IP o subred actual.' });
    }
    const expiresAt = Number(hours) > 0 ? new Date(Date.now() + Number(hours) * 3600_000).toISOString() : null;
    const { rows } = await pool.query(
      `INSERT INTO ip_bans (ip_or_cidr, reason, banned_by, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ip_or_cidr) DO UPDATE SET
         reason = EXCLUDED.reason,
         banned_by = EXCLUDED.banned_by,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()
       RETURNING *`,
      [target, String(reason).slice(0, 240), req.admin.id, expiresAt]
    );
    await refreshSystemState();
    evictSessionsForUserOrIp({ ip: target });
    await writeAdminAudit({
      admin: req.admin,
      action: 'network.ip_ban',
      targetType: 'ip_ban',
      targetId: target,
      after: rows[0],
      ip: callerIp,
    });
    return res.status(201).json({ ban: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/network/ip-bans/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`DELETE FROM ip_bans WHERE id = $1 RETURNING *`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Regla no encontrada.' });
    await refreshSystemState();
    await writeAdminAudit({
      admin: req.admin,
      action: 'network.ip_unban',
      targetType: 'ip_ban',
      targetId: rows[0].ip_or_cidr,
      before: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/system-health', async (_req, res) => {
  try {
    const snap = await buildLiveSnapshot();
    const storageRes = await pool.query(`SELECT * FROM storage_nodes ORDER BY is_primary DESC LIMIT 5`).catch(() => ({ rows: [] }));
    return res.json({
      health: snap.health,
      network: snap.network,
      inventory: snap.inventory,
      storage_nodes: storageRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 2: PLATFORM-IMPOSED AD SERVER (/api/admin/ads)
// ============================================================================
router.get('/ads', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *,
              CASE WHEN impressions_count > 0
                   THEN ROUND((clicks_count::numeric / impressions_count::numeric) * 100, 2)
                   ELSE 0 END AS ctr
         FROM platform_ads
        ORDER BY is_active DESC, priority DESC, created_at DESC`
    );
    return res.json({ ads: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ads', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'El título del anuncio es obligatorio.' });

    const { rows } = await pool.query(
      `INSERT INTO platform_ads (
         title, body, format, media_url, cta_text, cta_url, cta_type,
         enforcement_level, frequency_every_n, target_country, target_city,
         target_platform, priority, max_impressions, starts_at, ends_at, is_active, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        title.slice(0, 140),
        String(b.body || '').trim().slice(0, 1000),
        b.format || 'feed_injection',
        String(b.media_url || '').trim().slice(0, 600),
        String(b.cta_text || 'Más información').trim().slice(0, 60),
        String(b.cta_url || '').trim().slice(0, 600),
        b.cta_type || 'web',
        b.enforcement_level || 'free_only',
        Math.max(1, Math.min(50, Number(b.frequency_every_n) || 5)),
        String(b.target_country || 'ALL').trim().toUpperCase().slice(0, 8),
        String(b.target_city || '').trim().slice(0, 80),
        b.target_platform || 'all',
        Math.max(1, Math.min(10, Number(b.priority) || 5)),
        Math.max(0, Number(b.max_impressions) || 0),
        b.starts_at ? new Date(b.starts_at).toISOString() : null,
        b.ends_at ? new Date(b.ends_at).toISOString() : null,
        b.is_active !== false,
        req.admin.id,
      ]
    );
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'ads.created',
      targetType: 'platform_ad',
      targetId: String(rows[0].id),
      after: rows[0],
      ip: getClientIp(req),
    });
    return res.status(201).json({ ad: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/ads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const prev = await pool.query('SELECT * FROM platform_ads WHERE id = $1', [id]);
    if (!prev.rows[0]) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE platform_ads SET
         title = COALESCE(NULLIF($2, ''), title),
         body = COALESCE($3, body),
         format = COALESCE($4, format),
         media_url = COALESCE($5, media_url),
         cta_text = COALESCE($6, cta_text),
         cta_url = COALESCE($7, cta_url),
         cta_type = COALESCE($8, cta_type),
         enforcement_level = COALESCE($9, enforcement_level),
         frequency_every_n = COALESCE($10, frequency_every_n),
         target_country = COALESCE($11, target_country),
         target_city = COALESCE($12, target_city),
         target_platform = COALESCE($13, target_platform),
         priority = COALESCE($14, priority),
         max_impressions = COALESCE($15, max_impressions),
         starts_at = $16,
         ends_at = $17,
         is_active = COALESCE($18, is_active),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        b.title !== undefined ? String(b.title).trim().slice(0, 140) : '',
        b.body !== undefined ? String(b.body).trim().slice(0, 1000) : null,
        b.format || null,
        b.media_url !== undefined ? String(b.media_url).trim().slice(0, 600) : null,
        b.cta_text !== undefined ? String(b.cta_text).trim().slice(0, 60) : null,
        b.cta_url !== undefined ? String(b.cta_url).trim().slice(0, 600) : null,
        b.cta_type || null,
        b.enforcement_level || null,
        b.frequency_every_n !== undefined ? Math.max(1, Math.min(50, Number(b.frequency_every_n) || 5)) : null,
        b.target_country !== undefined ? String(b.target_country).trim().toUpperCase().slice(0, 8) : null,
        b.target_city !== undefined ? String(b.target_city).trim().slice(0, 80) : null,
        b.target_platform || null,
        b.priority !== undefined ? Math.max(1, Math.min(10, Number(b.priority) || 5)) : null,
        b.max_impressions !== undefined ? Math.max(0, Number(b.max_impressions) || 0) : null,
        b.starts_at ? new Date(b.starts_at).toISOString() : prev.rows[0].starts_at,
        b.ends_at ? new Date(b.ends_at).toISOString() : prev.rows[0].ends_at,
        typeof b.is_active === 'boolean' ? b.is_active : null,
      ]
    );
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'ads.updated',
      targetType: 'platform_ad',
      targetId: String(id),
      before: prev.rows[0],
      after: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ad: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/ads/:id/toggle', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE platform_ads SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: rows[0].is_active ? 'ads.enabled' : 'ads.paused',
      targetType: 'platform_ad',
      targetId: String(id),
      after: { is_active: rows[0].is_active },
      ip: getClientIp(req),
    });
    return res.json({ ad: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/ads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('DELETE FROM platform_ads WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'ads.deleted',
      targetType: 'platform_ad',
      targetId: String(id),
      before: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/ads/:id/analytics', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [adRes, dailyRes] = await Promise.all([
      pool.query('SELECT * FROM platform_ads WHERE id = $1', [id]),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day')::date AS d
         )
         SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
                COUNT(e.id) FILTER (WHERE e.event_type = 'impression')::int AS impressions,
                COUNT(e.id) FILTER (WHERE e.event_type = 'click')::int AS clicks,
                COUNT(DISTINCT COALESCE(CAST(e.user_id AS TEXT), e.ip)) FILTER (WHERE e.event_type = 'impression')::int AS unique_reach
           FROM days
           LEFT JOIN platform_ad_events e ON e.ad_id = $1 AND e.created_at::date = days.d
          GROUP BY days.d
          ORDER BY days.d ASC`,
        [id]
      ),
    ]);
    if (!adRes.rows[0]) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    return res.json({ ad: adRes.rows[0], daily: dailyRes.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 3: GOD MODE USERS CRM + PLAN BYPASS + IMPERSONATION + CÉDULA QUEUE
// ============================================================================
router.get('/users', async (req, res) => {
  try {
    const { q = '', plan = 'all', status = 'all', ip = '', limit = 120 } = req.query;
    const clauses = [];
    const params = [];

    if (String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      const idx = params.length;
      clauses.push(
        `(full_name ILIKE $${idx} OR username ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx} OR cedula_official_name ILIKE $${idx} OR last_ip ILIKE $${idx} OR CAST(id AS TEXT) = $${params.push(String(q).trim())})`
      );
    }
    if (plan && plan !== 'all') {
      if (plan === 'free') clauses.push(`COALESCE(active_plan_sku, '') = ''`);
      else {
        params.push(String(plan));
        clauses.push(`active_plan_sku = $${params.length}`);
      }
    }
    if (status && status !== 'all') {
      params.push(String(status));
      clauses.push(`COALESCE(moderation_status, 'active') = $${params.length}`);
    }
    if (String(ip).trim()) {
      params.push(String(ip).trim());
      clauses.push(`last_ip = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(250, Math.max(10, Number(limit) || 120)));

    const { rows } = await pool.query(
      `SELECT id, username, full_name, title_prefix, email, phone, ecclesiastical_rank,
              current_office_title, country_code, avatar_url, avatar_color, avatar_style,
              verification_status, is_ceo, is_cto, is_admin, role,
              active_plan_sku, ad_free, studio_eligible, one_badge, plan_expires_at,
              cedula_encrypted, cedula_masked, cedula_official_name, cedula_verified,
              account_status, moderation_status, muted_until, suspended_until, moderation_reason,
              last_ip, last_seen_at, posts_count, followers_count, created_at
         FROM users
         ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );

    const users = rows.map((u) => {
      const rawCed = decryptCedula(u.cedula_encrypted);
      return {
        ...u,
        cedula_encrypted: undefined,
        cedula: rawCed ? formatCedula(rawCed) : u.cedula_masked || '',
      };
    });

    return res.json({ users });
  } catch (err) {
    console.error('[admin/users/list]', err);
    return res.status(500).json({ error: 'No se pudo cargar el padrón de usuarios' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

    const [uRes, postsRes, ipsRes, subsRes, txRes, repRes, orgsRes] = await Promise.all([
      pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]),
      pool.query(
        `SELECT id, title, content, media_kind, image_url, video_url, is_pinned, is_hidden, comments_disabled, amen_count, comments_count, created_at
           FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 60`,
        [id]
      ),
      pool.query(
        `SELECT ip_address, country_code, city, device_type, user_agent, hits_count, first_seen_at, last_seen_at
           FROM ip_visit_history WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 40`,
        [id]
      ),
      pool.query(
        `SELECT s.*, p.display_name FROM subscriptions s LEFT JOIN subscription_plans p ON p.sku = s.plan_sku
          WHERE s.user_id = $1 ORDER BY s.updated_at DESC LIMIT 20`,
        [id]
      ),
      pool.query(
        `SELECT * FROM billing_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [id]
      ),
      pool.query(
        `SELECT * FROM content_reports WHERE (target_type = 'user' AND target_id = $1) OR reporter_id = $1 ORDER BY created_at DESC LIMIT 25`,
        [id]
      ),
      pool.query(`SELECT id, name, slug, org_type, badge_type, avatar_style FROM organizations WHERE owner_user_id = $1`, [id]),
    ]);

    const u = uRes.rows[0];
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

    const rawCed = decryptCedula(u.cedula_encrypted);
    return res.json({
      user: {
        ...u,
        password_hash: undefined,
        cedula_encrypted: undefined,
        cedula: rawCed ? formatCedula(rawCed) : u.cedula_masked || '',
      },
      posts: postsRes.rows,
      videos: postsRes.rows.filter((p) => p.media_kind === 'video' || p.video_url),
      ip_history: ipsRes.rows,
      subscriptions: subsRes.rows,
      transactions: txRes.rows,
      reports: repRes.rows,
      organizations: orgsRes.rows,
    });
  } catch (err) {
    console.error('[admin/users/detail]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Full Profile Editor + Optional Password Reset
router.put('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const prevRes = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    const prev = prevRes.rows[0];
    if (!prev) return res.status(404).json({ error: 'Usuario no encontrado' });

    const b = req.body || {};
    let nextPasswordHash = prev.password_hash;
    if (b.new_password && String(b.new_password).length >= 6) {
      nextPasswordHash = await bcrypt.hash(String(b.new_password), 10);
    }

    const nextLinks = b.website_url !== undefined
      ? (String(b.website_url).trim() ? JSON.stringify([{ label: 'Sitio web', url: String(b.website_url).trim() }]) : '[]')
      : null;

    const { rows } = await pool.query(
      `UPDATE users SET
         full_name = COALESCE(NULLIF($2, ''), full_name),
         username = COALESCE(NULLIF($3, ''), username),
         email = COALESCE(NULLIF($4, ''), email),
         phone = COALESCE($5, phone),
         bio = COALESCE($6, bio),
         motto = COALESCE($7, motto),
         avatar_url = COALESCE($8, avatar_url),
         cover_url = COALESCE($9, cover_url),
         country_code = COALESCE(NULLIF($10, ''), country_code),
         ecclesiastical_rank = COALESCE(NULLIF($11, ''), ecclesiastical_rank),
         current_office_title = COALESCE($12, current_office_title),
         role = COALESCE(NULLIF($13, ''), role),
         is_admin = CASE WHEN $13 = 'super_admin' THEN TRUE WHEN $13 = 'user' THEN FALSE ELSE is_admin END,
         password_hash = $14,
         website_links = COALESCE($15::jsonb, website_links),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, username, full_name, email, phone, bio, motto, avatar_url, cover_url, country_code, ecclesiastical_rank, current_office_title, role, is_admin`,
      [
        id,
        b.full_name !== undefined ? String(b.full_name).trim().slice(0, 120) : '',
        b.username !== undefined ? String(b.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32) : '',
        b.email !== undefined ? String(b.email).trim().toLowerCase().slice(0, 160) : '',
        b.phone !== undefined ? String(b.phone).trim().slice(0, 40) : null,
        b.bio !== undefined ? String(b.bio).trim().slice(0, 600) : null,
        b.motto !== undefined ? String(b.motto).trim().slice(0, 180) : null,
        b.avatar_url !== undefined ? String(b.avatar_url).trim().slice(0, 500) : null,
        b.cover_url !== undefined ? String(b.cover_url).trim().slice(0, 500) : null,
        b.country_code !== undefined ? String(b.country_code).trim().toUpperCase().slice(0, 4) : '',
        b.ecclesiastical_rank || '',
        b.current_office_title !== undefined ? String(b.current_office_title).trim().slice(0, 160) : null,
        ['user', 'super_admin'].includes(b.role) ? b.role : '',
        nextPasswordHash,
        nextLinks,
      ]
    );

    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'user.profile_edited',
      targetType: 'user',
      targetId: String(id),
      before: { full_name: prev.full_name, username: prev.username, email: prev.email, role: prev.role, ecclesiastical_rank: prev.ecclesiastical_rank },
      after: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ user: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// MANUAL CREDO ONE PLAN & BADGES BYPASS ("PONERLES CREDO SI SE ME PEGA LA GANA")
router.post('/users/:id/plan', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const uRes = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    const user = uRes.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const {
      plan_sku = '',
      expires_at = null,
      verified_badge,
      one_badge,
      avatar_style,
      is_cto,
      is_ceo,
      impressions_delta = 0,
      note = 'Otorgado manualmente por Super-Admin (Bypass PayPal)',
    } = req.body || {};

    const cleanSku = String(plan_sku || '').trim();
    const validSkus = ['', 'user_one_plus', 'user_one_pro', 'biz_one_plus', 'biz_one_pro', 'biz_one_enterprise'];
    if (!validSkus.includes(cleanSku)) {
      return res.status(400).json({ error: 'Plan Credo One no válido.' });
    }

    const beforeSnap = {
      active_plan_sku: user.active_plan_sku,
      verification_status: user.verification_status,
      one_badge: user.one_badge,
      avatar_style: user.avatar_style,
      plan_expires_at: user.plan_expires_at,
    };

    const expDate = expires_at ? new Date(expires_at) : new Date(Date.now() + 365 * 86400 * 1000);
    const resolveOneBadge = (rawVal, fallbackBadge) => {
      if (rawVal === undefined) return fallbackBadge;
      if (rawVal === true) return fallbackBadge || 'one_plus';
      if (rawVal === false) return '';
      return String(rawVal);
    };

    if (!cleanSku) {
      // Revoke Credo One subscription cleanly
      await pool.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1 AND status = 'active'`,
        [id]
      );
      const revBadge = resolveOneBadge(one_badge, '');
      await pool.query(
        `UPDATE users
            SET active_plan_sku = '',
                ad_free = FALSE,
                studio_eligible = FALSE,
                is_credo_plus = FALSE,
                credo_plus_plan = '',
                one_badge = $2,
                plan_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [id, revBadge]
      );
    } else {
      const planRes = await pool.query('SELECT * FROM subscription_plans WHERE sku = $1 LIMIT 1', [cleanSku]);
      const plan = planRes.rows[0];
      let org = null;
      if (plan && (plan.studio_access || plan.audience === 'business')) {
        org = await ensureOrgForSubscription(user, plan);
        if (avatar_style && ['circle', 'square', 'squircle_blue', 'squircle_gold'].includes(avatar_style)) {
          await pool.query('UPDATE organizations SET avatar_style = $2 WHERE id = $1', [org.id, avatar_style]);
        }
      }

      const subKey = `MANUAL-${id}-${cleanSku}`;
      const baseQuota = Number(plan?.monthly_impressions || 0) + Number(impressions_delta || 0);
      await pool.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1 AND status = 'active' AND plan_sku <> $2`,
        [id, cleanSku]
      );
      await pool.query(
        `INSERT INTO subscriptions (
           user_id, organization_id, plan_sku, billing_cycle, paypal_subscription_id,
           status, impressions_quota, impressions_used, current_period_start, current_period_end, updated_at
         ) VALUES ($1,$2,$3,'custom',$4,'active',$5,0,NOW(),$6,NOW())
         ON CONFLICT (paypal_subscription_id) DO UPDATE SET
           status = 'active',
           impressions_quota = GREATEST(0, subscriptions.impressions_quota + $7),
           current_period_end = EXCLUDED.current_period_end,
           updated_at = NOW()`,
        [id, org ? org.id : null, cleanSku, subKey, Math.max(0, baseQuota), expDate.toISOString(), Number(impressions_delta || 0)]
      );

      await reconcileUserEntitlements(id);
      const nextBadge = resolveOneBadge(one_badge, plan?.badge_type || cleanSku);
      await pool.query(
        `UPDATE users SET
           active_plan_sku = $2,
           ad_free = $3,
           studio_eligible = $4,
           is_credo_plus = TRUE,
           credo_plus_plan = $2,
           one_badge = $5,
           plan_expires_at = $6,
           updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          cleanSku,
          Boolean(plan?.ad_free),
          Boolean(plan?.studio_access || plan?.audience === 'business'),
          nextBadge,
          expDate.toISOString(),
        ]
      );
    }

    // Apply optional badge / avatar style / executive flags independently
    const updates = [];
    const uParams = [id];
    if (typeof verified_badge === 'boolean') {
      uParams.push(verified_badge ? 'verified' : 'unverified');
      updates.push(`verification_status = $${uParams.length}`);
    }
    if (one_badge !== undefined && typeof one_badge !== 'boolean') {
      uParams.push(String(one_badge));
      updates.push(`one_badge = $${uParams.length}`);
    }
    if (avatar_style && ['circle', 'square', 'squircle_blue', 'squircle_gold'].includes(avatar_style)) {
      uParams.push(avatar_style);
      updates.push(`avatar_style = $${uParams.length}`);
    }
    if (typeof is_cto === 'boolean') {
      uParams.push(is_cto);
      updates.push(`is_cto = $${uParams.length}`);
    }
    if (typeof is_ceo === 'boolean') {
      uParams.push(is_ceo);
      updates.push(`is_ceo = $${uParams.length}`);
    }
    if (updates.length > 0) {
      await pool.query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`, uParams);
    }

    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');

    const afterRes = await pool.query(
      `SELECT id, username, active_plan_sku, ad_free, studio_eligible, one_badge, verification_status, avatar_style, is_cto, is_ceo, plan_expires_at FROM users WHERE id = $1`,
      [id]
    );
    await writeAdminAudit({
      admin: req.admin,
      action: 'user.plan_manual_override',
      targetType: 'user',
      targetId: String(id),
      before: beforeSnap,
      after: { ...afterRes.rows[0], impressions_delta, note },
      ip: getClientIp(req),
    });

    return res.json({ ok: true, user: afterRes.rows[0] });
  } catch (err) {
    console.error('[admin/users/plan]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Disciplinary Moderation (Warn / Mute / Shadowban / Suspend / Ban + optional Ban IP & Hide Content)
router.post('/users/:id/moderate', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const uRes = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    const user = uRes.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { action, reason = '', hours = 0, ban_ip = false, hide_content = false } = req.body || {};
    if (['suspend', 'ban'].includes(action) && (user.is_cto || user.is_ceo || user.id === req.admin.id)) {
      return res.status(400).json({ error: 'No puedes suspender o banear cuentas ejecutivas ni tu propia cuenta.' });
    }

    const before = {
      moderation_status: user.moderation_status,
      account_status: user.account_status,
      muted_until: user.muted_until,
      suspended_until: user.suspended_until,
    };

    if (action === 'warn') {
      await pool.query(
        `INSERT INTO user_notifications (user_id, kind, title, body, deep_link)
         VALUES ($1, 'warning', 'Advertencia Oficial de Credo', $2, '#/profile')`,
        [id, String(reason || 'Tu cuenta ha recibido una advertencia oficial de moderación.').slice(0, 500)]
      );
    } else if (action === 'mute') {
      const until = Number(hours) > 0 ? new Date(Date.now() + Number(hours) * 3600_000).toISOString() : null;
      await pool.query(
        `UPDATE users SET moderation_status = 'muted', muted_until = $2, moderation_reason = $3, updated_at = NOW() WHERE id = $1`,
        [id, until, String(reason).slice(0, 240)]
      );
    } else if (action === 'shadowban') {
      await pool.query(
        `UPDATE users SET moderation_status = 'shadowbanned', moderation_reason = $2, updated_at = NOW() WHERE id = $1`,
        [id, String(reason).slice(0, 240)]
      );
    } else if (action === 'suspend') {
      const until = Number(hours) > 0 ? new Date(Date.now() + Number(hours) * 3600_000).toISOString() : null;
      await pool.query(
        `UPDATE users SET moderation_status = 'suspended', account_status = 'suspended', suspended_until = $2, moderation_reason = $3, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE id = $1`,
        [id, until, String(reason).slice(0, 240)]
      );
      evictSessionsForUserOrIp({ userId: id });
    } else if (action === 'ban') {
      await pool.query(
        `UPDATE users SET moderation_status = 'banned', account_status = 'suspended', moderation_reason = $2, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE id = $1`,
        [id, String(reason || 'Cuenta baneada permanentemente').slice(0, 240)]
      );
      evictSessionsForUserOrIp({ userId: id });
      if (ban_ip && user.last_ip && user.last_ip !== getClientIp(req)) {
        await pool.query(
          `INSERT INTO ip_bans (ip_or_cidr, reason, banned_by) VALUES ($1, $2, $3) ON CONFLICT (ip_or_cidr) DO NOTHING`,
          [user.last_ip, `Baneo asociado a @${user.username}: ${reason}`.slice(0, 240), req.admin.id]
        );
        await refreshSystemState();
      }
      if (hide_content) {
        await pool.query(`UPDATE posts SET is_hidden = TRUE WHERE author_id = $1`, [id]);
      }
    } else if (action === 'restore') {
      await pool.query(
        `UPDATE users SET moderation_status = 'active', account_status = 'active', muted_until = NULL, suspended_until = NULL, moderation_reason = '', updated_at = NOW() WHERE id = $1`,
        [id]
      );
      if (hide_content) {
        await pool.query(`UPDATE posts SET is_hidden = FALSE WHERE author_id = $1`, [id]);
      }
    } else {
      return res.status(400).json({ error: 'Acción disciplinaria no reconocida.' });
    }

    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: `user.moderate_${action}`,
      targetType: 'user',
      targetId: String(id),
      before,
      after: { action, reason, hours, ban_ip, hide_content },
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/force-logout', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = $1`, [id]);
    evictSessionsForUserOrIp({ userId: id });
    await writeAdminAudit({
      admin: req.admin,
      action: 'user.force_logout',
      targetType: 'user',
      targetId: String(id),
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/impersonate', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });

    const token = signImpersonationToken(rows[0], req.admin);
    await writeAdminAudit({
      admin: req.admin,
      action: 'user.impersonate_started',
      targetType: 'user',
      targetId: String(id),
      after: { target_username: rows[0].username },
      ip: getClientIp(req),
    });

    return res.json({
      token,
      url: `/?impersonate=${encodeURIComponent(token)}#/feed`,
      username: rows[0].username,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const uRes = await pool.query('SELECT id, username, email, is_cto, is_ceo FROM users WHERE id = $1 LIMIT 1', [id]);
    if (!uRes.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (uRes.rows[0].is_cto || uRes.rows[0].is_ceo || id === req.admin.id) {
      return res.status(400).json({ error: 'No puedes eliminar cuentas ejecutivas ni tu propia cuenta.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    evictSessionsForUserOrIp({ userId: id });
    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'user.deleted_permanently',
      targetType: 'user',
      targetId: String(id),
      before: uRes.rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Private Super-Admin-only Cédula Photo Vault viewer (never publicly accessible)
router.get('/cedula-photo/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
    const { rows } = await pool.query(`SELECT mime_type, data FROM cedula_photos WHERE id = $1 LIMIT 1`, [id]);
    if (!rows[0]) return res.status(404).end();
    res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.send(rows[0].data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Pending Cédula & Clergy Registration Requests inside Credo Core OS
router.get('/registration-requests', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, request_kind, full_name, username, email, phone, ecclesiastical_rank,
              title_prefix, current_office_title, bio, country_code,
              cedula_encrypted, cedula_masked, cedula_official_name, cedula_name_matched,
              cedula_photo_id, cedula_ocr_text, cedula_verified_source,
              status, review_note, approved_user_id, ip_address, reviewed_at, created_at
         FROM registration_requests
        ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 200`
    );
    return res.json({
      requests: rows.map((r) => {
        const rawCed = decryptCedula(r.cedula_encrypted);
        return {
          ...r,
          cedula_encrypted: undefined,
          cedula: rawCed ? formatCedula(rawCed) : r.cedula_masked || '',
        };
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/registration-requests/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const reqId = Number(req.params.id);
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM registration_requests WHERE id = $1 FOR UPDATE`, [reqId]);
    const r = rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    if (r.status === 'approved' && r.approved_user_id) {
      await client.query('COMMIT');
      return res.json({ ok: true, user_id: r.approved_user_id });
    }

    let candidateUsername = (r.username || r.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || `fiel_${reqId}`;
    const uCheck = await client.query(`SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1`, [candidateUsername]);
    if (uCheck.rows.length > 0) candidateUsername = `${candidateUsername}_${reqId}`;

    const ins = await client.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, current_office_title, bio, country_code,
         languages, preferred_locale, avatar_color, verification_status,
         verification_note, phone, cedula_hash, cedula_encrypted,
         cedula_masked, cedula_official_name, cedula_verified,
         cedula_photo_id, cedula_ocr_text, cedula_verified_source,
         account_status, last_ip
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,ARRAY[$10],$10,'#0F1E36','verified','Confirmado en Credo Core OS',$11,$12,$13,$14,$15,TRUE,$16,$17,$18,'active',$19)
       ON CONFLICT (email) DO UPDATE SET
         ecclesiastical_rank = EXCLUDED.ecclesiastical_rank,
         verification_status = 'verified',
         cedula_verified = TRUE,
         cedula_photo_id = COALESCE(EXCLUDED.cedula_photo_id, users.cedula_photo_id),
         account_status = 'active',
         updated_at = NOW()
       RETURNING id`,
      [
        r.email.toLowerCase(), r.password_hash, candidateUsername, r.full_name, r.title_prefix || '',
        r.ecclesiastical_rank, r.current_office_title || '', r.bio || '', r.country_code || 'DO',
        r.preferred_locale || 'es', r.phone || '', r.cedula_hash, r.cedula_encrypted,
        r.cedula_masked, r.cedula_official_name || '',
        r.cedula_photo_id || null, r.cedula_ocr_text || '', r.cedula_verified_source || 'manual_admin',
        r.ip_address || '',
      ]
    );
    await client.query(
      `UPDATE registration_requests SET status = 'approved', approved_user_id = $2, review_note = $3, reviewed_at = NOW() WHERE id = $1`,
      [reqId, ins.rows[0].id, String(req.body?.note || 'Aprobado en Credo Core OS').slice(0, 240)]
    );
    await client.query('COMMIT');
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'registration.approved',
      targetType: 'registration_request',
      targetId: String(reqId),
      after: { email: r.email, rank: r.ecclesiastical_rank, user_id: ins.rows[0].id },
      ip: getClientIp(req),
    });
    return res.json({ ok: true, user_id: ins.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/registration-requests/:id/reject', async (req, res) => {
  try {
    const reqId = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE registration_requests SET status = 'rejected', review_note = $2, reviewed_at = NOW() WHERE id = $1 RETURNING id, email, full_name`,
      [reqId, String(req.body?.note || 'Rechazado en Credo Core OS').slice(0, 240)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    await writeAdminAudit({
      admin: req.admin,
      action: 'registration.rejected',
      targetType: 'registration_request',
      targetId: String(reqId),
      after: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 4: CONTENT, MEDIA, LIVE STREAMS, MODERATION & DAILY EDITORIAL
// ============================================================================
router.get('/content', async (req, res) => {
  try {
    const { kind = 'all', q = '' } = req.query;
    const clauses = [];
    const params = [];
    if (kind === 'video') clauses.push(`(p.media_kind = 'video' OR p.video_url <> '' OR p.youtube_id <> '')`);
    else if (kind === 'photo') clauses.push(`(p.media_kind = 'photo' OR (p.image_url <> '' AND p.media_kind <> 'video'))`);
    else if (kind === 'article') clauses.push(`p.media_kind = 'article' AND p.image_url = '' AND p.video_url = ''`);
    else if (kind === 'hidden') clauses.push(`p.is_hidden = TRUE`);

    if (String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      clauses.push(`(p.title ILIKE $${params.length} OR p.content ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [postsRes, prayersRes] = await Promise.all([
      pool.query(
        `SELECT p.id, p.post_type, p.title, p.content, p.image_url, p.video_url, p.youtube_id, p.video_duration,
                p.media_kind, p.scripture_ref, p.is_pinned, p.comments_disabled, p.is_hidden,
                p.amen_count, p.comments_count, p.created_at,
                u.id AS author_id, u.full_name AS author_name, u.username AS author_username,
                COALESCE(m.size_bytes, 0)::bigint AS media_bytes
           FROM posts p
           JOIN users u ON u.id = p.author_id
           LEFT JOIN media_objects m ON (m.public_url = p.video_url OR m.public_url = p.image_url) AND m.status = 'ready'
          ${where}
          ORDER BY p.is_pinned DESC, p.created_at DESC
          LIMIT 120`,
        params
      ),
      pool.query(
        `SELECT id, author_display, category, is_urgent, content, prayers_count, created_at
           FROM prayer_intentions ORDER BY created_at DESC LIMIT 40`
      ),
    ]);
    return res.json({ posts: postsRes.rows, prayers: prayersRes.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/content/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_pinned, comments_disabled, is_hidden } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE posts SET
         is_pinned = COALESCE($2, is_pinned),
         comments_disabled = COALESCE($3, comments_disabled),
         is_hidden = COALESCE($4, is_hidden)
       WHERE id = $1
       RETURNING id, title, is_pinned, comments_disabled, is_hidden`,
      [
        id,
        typeof is_pinned === 'boolean' ? is_pinned : null,
        typeof comments_disabled === 'boolean' ? comments_disabled : null,
        typeof is_hidden === 'boolean' ? is_hidden : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Publicación no encontrada' });
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'content.updated',
      targetType: 'post',
      targetId: String(id),
      after: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ post: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/content/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`DELETE FROM posts WHERE id = $1 RETURNING id, title, image_url, video_url`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (rows[0].image_url) await deleteEdgeMediaByUrl(rows[0].image_url);
    if (rows[0].video_url) await deleteEdgeMediaByUrl(rows[0].video_url);
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');
    apiCache.invalidate('stats:');
    await writeAdminAudit({
      admin: req.admin,
      action: 'content.deleted_with_storage',
      targetType: 'post',
      targetId: String(id),
      before: rows[0],
      ip: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/prayers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM prayer_intentions WHERE id = $1', [id]);
    await writeAdminAudit({ admin: req.admin, action: 'prayer.deleted', targetType: 'prayer', targetId: String(id), ip: getClientIp(req) });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Live Streams Console
router.get('/live', async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM live_channels ORDER BY is_hero DESC, sort_order ASC, id ASC`);
  return res.json({ channels: rows });
});

router.post('/live/:id/pin', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`UPDATE live_channels SET is_hero = (id = $1), sort_order = CASE WHEN id = $1 THEN 0 ELSE GREATEST(sort_order, 1) END`, [id]);
    apiCache.invalidate('live:');
    await writeAdminAudit({ admin: req.admin, action: 'live.pinned_first', targetType: 'live_channel', targetId: String(id), ip: getClientIp(req) });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/live/:id/highlight', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const chRes = await pool.query('SELECT * FROM live_channels WHERE id = $1 LIMIT 1', [id]);
    const ch = chRes.rows[0];
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });

    const title = `🔴 En Vivo Ahora: ${ch.name}`;
    const body = ch.current_program || ch.tagline || 'Únete a la transmisión en vivo en Credo.';
    const uRes = await pool.query(`SELECT id FROM users WHERE COALESCE(account_status, 'active') = 'active'`);
    const brRes = await pool.query(
      `INSERT INTO push_broadcasts (title, body, deep_link, segment_filter, sent_count, created_by)
       VALUES ($1,$2,'#/explore?filter=live','{"audience":"all"}'::jsonb,$3,$4) RETURNING id`,
      [title, body, uRes.rows.length, req.admin.id]
    );
    for (const u of uRes.rows) {
      await pool.query(
        `INSERT INTO user_notifications (user_id, broadcast_id, kind, title, body, deep_link) VALUES ($1,$2,'live',$3,$4,'#/explore?filter=live')`,
        [u.id, brRes.rows[0].id, title, body]
      );
    }
    await writeAdminAudit({ admin: req.admin, action: 'live.highlighted_push', targetType: 'live_channel', targetId: String(id), after: { sent: uRes.rows.length }, ip: getClientIp(req) });
    return res.json({ ok: true, sent: uRes.rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/live/:id/cut', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_live } = req.body || {};
    const nextLive = typeof is_live === 'boolean' ? is_live : false;
    const { rows } = await pool.query(`UPDATE live_channels SET is_live = $2 WHERE id = $1 RETURNING *`, [id, nextLive]);
    if (!rows[0]) return res.status(404).json({ error: 'Canal no encontrado' });
    apiCache.invalidate('live:');
    await writeAdminAudit({
      admin: req.admin,
      action: nextLive ? 'live.restored' : 'live.cut_emergency',
      targetType: 'live_channel',
      targetId: String(id),
      after: { is_live: nextLive },
      ip: getClientIp(req),
    });
    return res.json({ channel: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Moderation Queue & Banned Words
router.get('/moderation/reports', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              rep.username AS reporter_username, rep.full_name AS reporter_name,
              p.title AS post_title, p.content AS post_content, p.author_id AS post_author_id,
              u.username AS target_username, u.full_name AS target_full_name
         FROM content_reports r
         LEFT JOIN users rep ON rep.id = r.reporter_id
         LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN users u ON (r.target_type = 'user' AND u.id = r.target_id) OR (r.target_type = 'post' AND u.id = p.author_id)
        ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT 120`
    );
    const bannedWords = getAllSettings().banned_words?.words || [];
    return res.json({ reports: rows, banned_words: bannedWords });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/moderation/reports/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { resolution = 'dismiss', note = '' } = req.body || {};
    const repRes = await pool.query('SELECT * FROM content_reports WHERE id = $1 LIMIT 1', [id]);
    const r = repRes.rows[0];
    if (!r) return res.status(404).json({ error: 'Reporte no encontrado' });

    let authorId = r.target_type === 'user' ? r.target_id : null;
    if (r.target_type === 'post') {
      const pRes = await pool.query('SELECT author_id FROM posts WHERE id = $1', [r.target_id]);
      authorId = pRes.rows[0]?.author_id || null;
    }

    if (resolution === 'delete_warn' && r.target_type === 'post') {
      await pool.query('DELETE FROM posts WHERE id = $1', [r.target_id]);
      apiCache.invalidate('posts:');
      if (authorId) {
        await pool.query(
          `INSERT INTO user_notifications (user_id, kind, title, body) VALUES ($1,'warning','Contenido eliminado por moderación',$2)`,
          [authorId, note || 'Tu publicación fue eliminada por incumplir las normas de la comunidad.']
        );
      }
    } else if (resolution === 'shadowban' && authorId) {
      await pool.query(`UPDATE users SET moderation_status = 'shadowbanned', moderation_reason = $2 WHERE id = $1`, [authorId, note || r.reason]);
      apiCache.invalidate('posts:');
    } else if (resolution === 'ban' && authorId) {
      await pool.query(`UPDATE users SET moderation_status = 'banned', account_status = 'suspended', moderation_reason = $2, token_version = COALESCE(token_version,1)+1 WHERE id = $1`, [authorId, note || r.reason]);
      evictSessionsForUserOrIp({ userId: authorId });
      apiCache.invalidate('users:');
      apiCache.invalidate('posts:');
    }

    await pool.query(
      `UPDATE content_reports SET status = $2, resolved_by = $3, resolution_note = $4, resolved_at = NOW() WHERE id = $1`,
      [id, resolution === 'dismiss' ? 'dismissed' : 'actioned', req.admin.id, String(note || resolution).slice(0, 240)]
    );
    await writeAdminAudit({ admin: req.admin, action: `moderation.${resolution}`, targetType: 'content_report', targetId: String(id), after: { resolution, note, authorId }, ip: getClientIp(req) });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/moderation/banned-words', async (req, res) => {
  try {
    const words = Array.isArray(req.body?.words)
      ? req.body.words.map((w) => String(w || '').trim().toLowerCase()).filter(Boolean).slice(0, 300)
      : String(req.body?.words || '').split(/[,\n]+/).map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 300);
    await setSetting('banned_words', { words }, req.admin);
    await writeAdminAudit({ admin: req.admin, action: 'moderation.banned_words_updated', targetType: 'system_settings', targetId: 'banned_words', after: { count: words.length }, ip: getClientIp(req) });
    return res.json({ ok: true, words });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Editorial Manager (Daily Gospel / Official Platform Announcements)
router.get('/editorial', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, post_type, title, content, scripture_ref, image_url, is_pinned, created_at
       FROM posts
      WHERE post_type IN ('reflection', 'announcement', 'homily')
      ORDER BY is_pinned DESC, created_at DESC LIMIT 30`
  );
  return res.json({ posts: rows });
});

router.post('/editorial', async (req, res) => {
  try {
    const { title, content, scripture_ref = '', image_url = '', post_type = 'reflection', is_pinned = true } = req.body || {};
    if (!String(title || '').trim() || !String(content || '').trim()) {
      return res.status(400).json({ error: 'Título y contenido son obligatorios.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO posts (author_id, post_type, title, content, scripture_ref, image_url, media_kind, is_pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.admin.id,
        ['reflection', 'announcement', 'homily'].includes(post_type) ? post_type : 'reflection',
        String(title).trim().slice(0, 180),
        String(content).trim().slice(0, 4000),
        String(scripture_ref).trim().slice(0, 120),
        String(image_url).trim().slice(0, 500),
        image_url ? 'photo' : 'article',
        Boolean(is_pinned),
      ]
    );
    apiCache.invalidate('posts:');
    await writeAdminAudit({ admin: req.admin, action: 'editorial.published', targetType: 'post', targetId: String(rows[0].id), after: { title }, ip: getClientIp(req) });
    return res.status(201).json({ post: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 5: FINANCE, ACCOUNTING, CLIENT CAMPAIGNS, PAYPAL WEBHOOKS & CRM
// ============================================================================
router.get('/finance/overview', async (_req, res) => {
  try {
    const [mrrRes, revRes, churnRes, byPlanRes, monthlyRes, txRes] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(
          CASE WHEN s.billing_cycle = 'annual' THEN ROUND(p.price_annual_cents / 12.0)
               ELSE p.price_monthly_cents END
        ), 0)::bigint AS mrr_cents,
        COUNT(*)::int AS active_subs
        FROM subscriptions s
        JOIN subscription_plans p ON p.sku = s.plan_sku
        WHERE s.status = 'active'
          AND s.paypal_subscription_id NOT LIKE 'MANUAL-%'
          AND (s.current_period_end IS NULL OR s.current_period_end > NOW() - INTERVAL '2 days')
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= CURRENT_DATE), 0)::bigint AS today_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', NOW())), 0)::bigint AS month_cents,
          COALESCE(SUM(amount_cents), 0)::bigint AS all_time_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE plan_sku = 'campaign_reach'), 0)::bigint AS campaigns_cents
        FROM billing_transactions
        WHERE status IN ('completed', 'succeeded')
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active' AND created_at > NOW() - INTERVAL '30 days')::int AS new_30d,
          COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired', 'suspended') AND updated_at > NOW() - INTERVAL '30 days')::int AS churn_30d
        FROM subscriptions
      `),
      pool.query(`
        SELECT COALESCE(NULLIF(plan_sku, ''), 'other') AS plan_sku,
               COUNT(*)::int AS tx_count,
               COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
          FROM billing_transactions
         WHERE status IN ('completed', 'succeeded')
         GROUP BY plan_sku
         ORDER BY total_cents DESC
      `),
      pool.query(`
        WITH months AS (
          SELECT generate_series(date_trunc('month', NOW()) - INTERVAL '5 months', date_trunc('month', NOW()), '1 month') AS m
        )
        SELECT to_char(months.m, 'YYYY-MM') AS month,
               COALESCE(SUM(bt.amount_cents), 0)::bigint AS cents
          FROM months
          LEFT JOIN billing_transactions bt
            ON date_trunc('month', bt.created_at) = months.m AND bt.status IN ('completed', 'succeeded')
         GROUP BY months.m
         ORDER BY months.m ASC
      `),
      pool.query(`
        SELECT bt.*, u.username, u.full_name, u.email
          FROM billing_transactions bt
          LEFT JOIN users u ON u.id = bt.user_id
         ORDER BY bt.created_at DESC
         LIMIT 100
      `),
    ]);

    const mrrCents = Number(mrrRes.rows[0]?.mrr_cents || 0);
    const rev = revRes.rows[0] || {};
    const ch = churnRes.rows[0] || {};

    return res.json({
      kpis: {
        mrr_usd: Number((mrrCents / 100).toFixed(2)),
        arr_usd: Number(((mrrCents * 12) / 100).toFixed(2)),
        today_usd: Number((Number(rev.today_cents || 0) / 100).toFixed(2)),
        month_usd: Number((Number(rev.month_cents || 0) / 100).toFixed(2)),
        all_time_usd: Number((Number(rev.all_time_cents || 0) / 100).toFixed(2)),
        campaigns_usd: Number((Number(rev.campaigns_cents || 0) / 100).toFixed(2)),
        active_subs: Number(mrrRes.rows[0]?.active_subs || 0),
        new_subs_30d: Number(ch.new_30d || 0),
        churn_30d: Number(ch.churn_30d || 0),
      },
      by_plan: byPlanRes.rows.map((r) => ({ ...r, total_usd: Number((Number(r.total_cents) / 100).toFixed(2)) })),
      monthly_series: monthlyRes.rows.map((r) => ({ month: r.month, usd: Number((Number(r.cents) / 100).toFixed(2)) })),
      transactions: txRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/finance/export.csv', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bt.id, bt.created_at, u.email, u.full_name, bt.plan_sku, bt.amount_cents, bt.currency, bt.status, bt.paypal_sale_id, bt.description
         FROM billing_transactions bt LEFT JOIN users u ON u.id = bt.user_id
        ORDER BY bt.created_at DESC LIMIT 2000`
    );
    const header = 'id,fecha,email,cliente,plan,monto_usd,moneda,estado,paypal_sale_id,descripcion';
    const lines = rows.map((r) =>
      [r.id, r.created_at?.toISOString?.() || r.created_at, r.email, r.full_name, r.plan_sku, (Number(r.amount_cents || 0) / 100).toFixed(2), r.currency, r.status, r.paypal_sale_id, r.description].map(CSV_ESCAPE).join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="credo-contabilidad.csv"');
    return res.send([header, ...lines].join('\n'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Client Campaigns Monitor (Credo One Studio Paid Campaigns)
router.get('/campaigns', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, o.name AS org_name, u.username AS creator_username, u.email AS creator_email,
            CASE WHEN c.impressions_served > 0 THEN ROUND((c.clicks_count::numeric / c.impressions_served::numeric) * 100, 2) ELSE 0 END AS ctr
       FROM campaigns c
       LEFT JOIN organizations o ON o.id = c.organization_id
       LEFT JOIN users u ON u.id = c.creator_user_id
      ORDER BY c.created_at DESC LIMIT 150`
  );
  return res.json({ campaigns: rows });
});

router.patch('/campaigns/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const prev = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!prev.rows[0]) return res.status(404).json({ error: 'Campaña no encontrada' });
    const { status, impressions_allocated, payment_status } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE campaigns SET
         status = COALESCE($2, status),
         impressions_allocated = COALESCE($3, impressions_allocated),
         payment_status = COALESCE($4, payment_status),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, status || null, impressions_allocated ? Number(impressions_allocated) : null, payment_status || null]
    );
    apiCache.invalidate('posts:');
    await writeAdminAudit({ admin: req.admin, action: 'campaign.admin_updated', targetType: 'campaign', targetId: String(id), before: prev.rows[0], after: rows[0], ip: getClientIp(req) });
    return res.json({ campaign: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PayPal Webhook Inspector
router.get('/webhooks/paypal', async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM paypal_webhook_events ORDER BY created_at DESC LIMIT 100`);
  return res.json({ events: rows });
});

router.post('/webhooks/paypal/:id/reprocess', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM paypal_webhook_events WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Evento webhook no encontrado' });

    const credoOne = require('./credoOne');
    let resultStatus = 200;
    let resultBody = {};
    const fakeRes = {
      status(code) { resultStatus = code; return this; },
      json(body) { resultBody = body; return this; },
    };
    await credoOne.handlePayPalWebhook(
      { body: rows[0].payload_json, headers: rows[0].headers_json || {}, _skipSignatureForAdminReplay: true },
      fakeRes
    );
    await pool.query(
      `UPDATE paypal_webhook_events SET status = $2, error_message = $3, processed_at = NOW() WHERE id = $1`,
      [id, resultStatus < 400 ? 'processed' : 'error', resultStatus < 400 ? '' : String(resultBody.error || '')]
    );
    await writeAdminAudit({ admin: req.admin, action: 'webhook.reprocessed', targetType: 'paypal_webhook', targetId: String(id), after: { resultStatus }, ip: getClientIp(req) });
    return res.json({ ok: resultStatus < 400, status: resultStatus, result: resultBody });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Enterprise CRM Pipeline
router.get('/enterprise-leads', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, u.username, u.active_plan_sku
       FROM enterprise_leads l LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC LIMIT 150`
  );
  return res.json({ leads: rows });
});

router.patch('/enterprise-leads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, internal_notes } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE enterprise_leads SET
         status = COALESCE($2, status),
         internal_notes = COALESCE($3, internal_notes),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, status || null, internal_notes !== undefined ? String(internal_notes).slice(0, 1000) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lead no encontrado' });
    await writeAdminAudit({ admin: req.admin, action: 'crm.lead_updated', targetType: 'enterprise_lead', targetId: String(id), after: rows[0], ip: getClientIp(req) });
    return res.json({ lead: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/enterprise-leads/:id/activate', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lRes = await pool.query('SELECT * FROM enterprise_leads WHERE id = $1 LIMIT 1', [id]);
    const lead = lRes.rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead Enterprise no encontrado' });

    let user = null;
    if (lead.user_id) {
      const u1 = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [lead.user_id]);
      user = u1.rows[0] || null;
    }
    if (!user && lead.corporate_email) {
      const u2 = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [lead.corporate_email.toLowerCase()]);
      user = u2.rows[0] || null;
    }
    if (!user) {
      return res.status(400).json({ error: 'El contacto aún no tiene cuenta en Credo con ese correo corporativo.' });
    }

    const planRes = await pool.query(`SELECT * FROM subscription_plans WHERE sku = 'biz_one_enterprise' LIMIT 1`);
    const plan = planRes.rows[0];
    const org = await ensureOrgForSubscription(user, plan);
    await pool.query(
      `UPDATE organizations SET name = $2, org_type = 'enterprise', badge_type = 'enterprise_gold', avatar_style = 'square', updated_at = NOW() WHERE id = $1`,
      [org.id, lead.company_name.slice(0, 80)]
    );
    const exp = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
    await pool.query(
      `INSERT INTO subscriptions (user_id, organization_id, plan_sku, billing_cycle, paypal_subscription_id, status, impressions_quota, current_period_end)
       VALUES ($1,$2,'biz_one_enterprise','annual',$3,'active',$4,$5)
       ON CONFLICT (paypal_subscription_id) DO UPDATE SET status = 'active', current_period_end = EXCLUDED.current_period_end, updated_at = NOW()`,
      [user.id, org.id, `ENT-LEAD-${id}`, Number(plan?.monthly_impressions || 350000), exp]
    );
    await reconcileUserEntitlements(user.id);
    await pool.query(`UPDATE users SET avatar_style = 'square', one_badge = 'enterprise_gold', plan_expires_at = $2 WHERE id = $1`, [user.id, exp]);
    await pool.query(`UPDATE enterprise_leads SET status = 'active', user_id = $2, updated_at = NOW() WHERE id = $1`, [id, user.id]);

    apiCache.invalidate('users:');
    await writeAdminAudit({ admin: req.admin, action: 'crm.enterprise_activated', targetType: 'enterprise_lead', targetId: String(id), after: { user_id: user.id, org_id: org.id }, ip: getClientIp(req) });
    return res.json({ ok: true, user_id: user.id, organization_id: org.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 6: BROADCASTS, KILL SWITCHES & IMMUTABLE AUDIT LOGS
// ============================================================================
router.get('/broadcasts', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*, u.username AS created_by_name
       FROM push_broadcasts b LEFT JOIN users u ON u.id = b.created_by
      ORDER BY b.created_at DESC LIMIT 80`
  );
  return res.json({ broadcasts: rows });
});

router.post('/broadcasts', async (req, res) => {
  try {
    const { title, body, image_url = '', deep_link = '#/feed', audience = 'all', country = '', user_id = null } = req.body || {};
    if (!String(title || '').trim() || !String(body || '').trim()) {
      return res.status(400).json({ error: 'Título y mensaje son obligatorios.' });
    }

    const clauses = [`COALESCE(account_status, 'active') = 'active'`];
    const params = [];
    if (audience === 'free') clauses.push(`COALESCE(active_plan_sku, '') = ''`);
    else if (audience === 'credo_one') clauses.push(`COALESCE(active_plan_sku, '') <> ''`);
    else if (audience === 'country' && country) {
      params.push(String(country).toUpperCase());
      clauses.push(`country_code = $${params.length}`);
    } else if (audience === 'user' && user_id) {
      params.push(Number(user_id));
      clauses.push(`id = $${params.length}`);
    }

    const usersRes = await pool.query(`SELECT id FROM users WHERE ${clauses.join(' AND ')}`, params);
    const seg = { audience, country, user_id };

    const { rows } = await pool.query(
      `INSERT INTO push_broadcasts (title, body, image_url, deep_link, segment_filter, sent_count, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
      [
        String(title).trim().slice(0, 140),
        String(body).trim().slice(0, 600),
        String(image_url).trim().slice(0, 500),
        String(deep_link || '#/feed').trim().slice(0, 200),
        JSON.stringify(seg),
        usersRes.rows.length,
        req.admin.id,
      ]
    );

    const bId = rows[0].id;
    if (usersRes.rows.length > 0) {
      const uids = usersRes.rows.map((u) => u.id);
      await pool.query(
        `INSERT INTO user_notifications (user_id, broadcast_id, kind, title, body, deep_link)
         SELECT unnest($1::int[]), $2, 'broadcast', $3, $4, $5`,
        [uids, bId, rows[0].title, rows[0].body, rows[0].deep_link]
      );
    }

    await writeAdminAudit({ admin: req.admin, action: 'broadcast.sent', targetType: 'push_broadcast', targetId: String(bId), after: { sent_count: usersRes.rows.length, segment: seg }, ip: getClientIp(req) });
    return res.status(201).json({ broadcast: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function sanitizeSettingsForClient(raw) {
  const s = { ...(raw || {}) };
  const cp = { ...(s.cedula_providers || {}) };
  s.cedula_providers = {
    has_verifik_token: Boolean(process.env.VERIFIK_API_TOKEN || cp.verifik_token),
    verifik_via_env: Boolean(process.env.VERIFIK_API_TOKEN),
    custom_api_url: cp.custom_api_url || process.env.CEDULA_API_URL || '',
    has_custom_api_key: Boolean(process.env.CEDULA_API_KEY || cp.custom_api_key),
    enable_dgii: cp.enable_dgii !== false,
    enable_photo_ocr: cp.enable_photo_ocr !== false,
  };
  return s;
}

router.get('/settings', (_req, res) => {
  return res.json({ settings: sanitizeSettingsForClient(getAllSettings()) });
});

router.put('/settings', async (req, res) => {
  try {
    const incoming = req.body?.settings || req.body || {};
    const beforeSafe = sanitizeSettingsForClient(getAllSettings());
    const allowedKeys = [
      'maintenance_mode',
      'block_registrations',
      'pause_media_uploads',
      'pause_live_streams',
      'pause_global_ads',
      'pause_paypal_checkout',
      'min_mobile_version',
      'banned_words',
    ];
    for (const k of allowedKeys) {
      if (incoming[k] !== undefined && typeof incoming[k] === 'object') {
        await setSetting(k, incoming[k], req.admin);
      }
    }
    if (incoming.cedula_providers && typeof incoming.cedula_providers === 'object') {
      const cur = getAllSettings().cedula_providers || {};
      const next = {
        verifik_token:
          incoming.cedula_providers.clear_verifik_token
            ? ''
            : String(incoming.cedula_providers.verifik_token || '').trim() || cur.verifik_token || '',
        custom_api_url:
          incoming.cedula_providers.custom_api_url !== undefined
            ? String(incoming.cedula_providers.custom_api_url || '').trim()
            : cur.custom_api_url || '',
        custom_api_key:
          incoming.cedula_providers.clear_custom_api_key
            ? ''
            : String(incoming.cedula_providers.custom_api_key || '').trim() || cur.custom_api_key || '',
        enable_dgii:
          incoming.cedula_providers.enable_dgii !== undefined
            ? Boolean(incoming.cedula_providers.enable_dgii)
            : cur.enable_dgii !== false,
        enable_photo_ocr:
          incoming.cedula_providers.enable_photo_ocr !== undefined
            ? Boolean(incoming.cedula_providers.enable_photo_ocr)
            : cur.enable_photo_ocr !== false,
      };
      await setSetting('cedula_providers', next, req.admin);
    }
    apiCache.invalidate('posts:');
    const afterSafe = sanitizeSettingsForClient(getAllSettings());
    await writeAdminAudit({
      admin: req.admin,
      action: 'system.kill_switches_updated',
      targetType: 'system_settings',
      targetId: 'global',
      before: beforeSafe,
      after: afterSafe,
      ip: getClientIp(req),
    });
    return res.json({ ok: true, settings: afterSafe });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/audit', async (req, res) => {
  try {
    const { q = '', limit = 150 } = req.query;
    const params = [];
    let where = '';
    if (String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      where = `WHERE action ILIKE $1 OR admin_name ILIKE $1 OR target_type ILIKE $1 OR target_id ILIKE $1 OR ip_address ILIKE $1`;
    }
    params.push(Math.min(500, Math.max(20, Number(limit) || 150)));
    const { rows } = await pool.query(
      `SELECT * FROM admin_audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return res.json({ logs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/audit/export.csv', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 2000`);
    const header = 'id,fecha,admin,accion,entidad,entidad_id,ip,antes_json,despues_json';
    const lines = rows.map((r) =>
      [r.id, r.created_at?.toISOString?.() || r.created_at, r.admin_name, r.action, r.target_type, r.target_id, r.ip_address, JSON.stringify(r.before_json || {}), JSON.stringify(r.after_json || {})].map(CSV_ESCAPE).join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="credo-audit-logs.csv"');
    return res.send([header, ...lines].join('\n'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MODULE 7: 360° DEFENSE-IN-DEPTH SECURITY POSTURE & GOVERNANCE
// ============================================================================
router.get('/security/posture', async (_req, res) => {
  try {
    const { getWafStats } = require('../middleware/securityShield');
    const { getPayPalStatusSnapshot } = require('../services/paypal');
    const fsharpKernel = require('../services/fsharpKernel');
    const { ADMIN_ALLOWED_IPS } = require('../config');

    const [bansCnt, wafCnt, adminsRes, invitesRes, vaultCnt, wafRecentRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS cnt FROM ip_bans WHERE expires_at IS NULL OR expires_at > NOW()`),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM waf_events`).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(
        `SELECT id, username, full_name, email, role, is_cto, is_ceo, last_ip, last_seen_at
           FROM users
          WHERE role = 'super_admin' OR is_cto = TRUE OR is_ceo = TRUE
          ORDER BY id ASC`
      ),
      pool.query(
        `SELECT i.id, i.label, i.expires_at, i.used_at, i.used_ip, i.created_at,
                cb.username AS created_by_username, ub.username AS used_by_username
           FROM admin_invite_tokens i
           LEFT JOIN users cb ON cb.id = i.created_by
           LEFT JOIN users ub ON ub.id = i.used_by_user_id
          ORDER BY i.created_at DESC LIMIT 15`
      ).catch(() => ({ rows: [] })),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM cedula_photos`).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(
        `SELECT id, ip_address, country_code, method, request_path, rule_code, action_taken, last_seen_at
           FROM waf_events ORDER BY last_seen_at DESC LIMIT 20`
      ).catch(() => ({ rows: [] })),
    ]);

    const pp = getPayPalStatusSnapshot();
    const kernel = fsharpKernel.getKernelCatalog();
    const wafMem = getWafStats();

    const layers = [
      {
        id: 'L1',
        name: 'Capa 1 · Servidor Hostinger VPS, Kernel & Red',
        status: 'active',
        controls: [
          'SSH endurecido: PasswordAuthentication=no (solo llave pública Ed25519/RSA) + MaxAuthTries=3',
          'Fail2Ban activo en sshd con baneo exponencial incremental (24h → 7 días)',
          'Firewall DOCKER-USER + VPS-BLOCK bloqueando puertos internos (8000, 8080, 6001, 6002) en eth0',
          'Kernel sysctl anti-DDoS: tcp_syncookies=1, accept_redirects=0, send_redirects=0, protected_symlinks=1',
        ],
      },
      {
        id: 'L2',
        name: 'Capa 2 · Perímetro Cloudflare & Origin Cloaking',
        status: 'active',
        controls: [
          'Verificación criptográfica/CIDR de las 22 subredes oficiales IPv4/IPv6 de Cloudflare antes de confiar en CF-Connecting-IP',
          'Origin Cloaking activo: cualquier conexión directa al IP del VPS hacia credoapp.tech sin pasar por Cloudflare recibe 403 + Auto-Ban',
          'TLS estricto + HSTS Preload (max-age=63072000, includeSubDomains, preload) + X-Frame-Options: DENY en Core OS',
          'Bloqueo permanente de proxies serverless abusivos (CF-Worker / 2a06:98c0:3600::103)',
        ],
      },
      {
        id: 'L3',
        name: 'Capa 3 · Escudo WAF L7, Honeypot & Anti-DoS API',
        status: 'active',
        controls: [
          'Honeypot 0ms + Auto-Ban automático IPv4/IPv6 ante sondeos /wp-admin, .php, /.env, /.git, Path Traversal, SQLi y JNDI',
          'Límite global anti-RAM-DoS de 512 KB en JSON (22 MB aislado únicamente en OCR de cédula y subida multimedia)',
          'Sanitizador recursivo contra Prototype Pollution (__proto__, constructor, prototype) y bytes nulos (\\0)',
          'CORS con lista blanca estricta + Rate Limiting multicapa (360 rpm API global · 80/15m Auth · 15/15m + Auto-Ban 6 fallos Core OS)',
        ],
      },
      {
        id: 'L4',
        name: 'Capa 4 · Identidad, Sesiones Revocables & Bóveda Cédula (Ley 172-13)',
        status: 'active',
        controls: [
          'Contraseñas con Bcrypt (cost 12) + JWT HS256 con revocación instantánea en caliente vía token_version',
          'Enlaces de registro Core OS de 1 solo uso (256 bits de entropía, guardados solo en SHA-256 con SELECT ... FOR UPDATE)',
          'Cédula cifrada en reposo con AES-256-GCM + índice ciego HMAC-SHA256 + validación híbrida JCE/DGII + Tesseract OCR',
          `Bóveda privada BYTEA de fotos de cédula (${vaultCnt.rows[0]?.cnt || 0} resguardadas, 0% acceso público, Cache-Control: no-store)`,
        ],
      },
      {
        id: 'L5',
        name: 'Capa 5 · Integridad Financiera (Núcleo F# 8 + PayPal Live)',
        status: pp.v6_ready ? 'active' : 'warning',
        controls: [
          `Núcleo compilado inmutable .NET 8 / F# activo (sello ${String(kernel?.integrity_seal || '').slice(0, 12)}…) — cero precios confiados al cliente`,
          `Verificación criptográfica de firmas Webhook PayPal (${pp.webhook_id || 'activo'}, 14 eventos incluyendo reembolsos y contracargos)`,
          'Protección anti-replay y vinculación estricta custom_id por usuario/organización en órdenes y campañas Studio',
          'Barrendero automático cada 15 min para expirar suscripciones vencidas y reconciliar privilegios RBAC',
        ],
      },
      {
        id: 'L6',
        name: 'Capa 6 · Aislamiento Docker, PostgreSQL & Auditoría Inmutable',
        status: 'active',
        controls: [
          `Contenedor ejecutándose sin privilegios root (UID=${process.getuid ? process.getuid() : 'node'}) sobre Alpine Linux`,
          'PostgreSQL 100% aislado en red interna Docker (puerto 5432 cerrado a Internet) + statement_timeout=12s anti-bloqueos',
          'Consultas SQL 100% parametrizadas ($1, $2) + bitácoras inmutables admin_audit_logs y audit_logs con exportación CSV',
          ADMIN_ALLOWED_IPS.length > 0
            ? `Lista blanca IP adicional activa en Core OS (${ADMIN_ALLOWED_IPS.length} reglas)`
            : 'Control de acceso Nivel 0 activo (opcional: ADMIN_ALLOWED_IPS disponible por variable de entorno)',
        ],
      },
    ];

    return res.json({
      score: 100,
      waf: {
        active_ip_bans: bansCnt.rows[0]?.cnt || 0,
        total_waf_events_db: wafCnt.rows[0]?.cnt || 0,
        blocked_since_boot: wafMem.blockedTotalSinceBoot,
        auto_banned_since_boot: wafMem.autoBannedSinceBoot,
        origin_bypass_blocked_since_boot: wafMem.originBypassBlockedSinceBoot,
      },
      layers,
      super_admins: adminsRes.rows,
      invites: invitesRes.rows,
      recent_waf_events: wafRecentRes.rows,
    });
  } catch (err) {
    console.error('[admin/security/posture]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
