const jwt = require('jsonwebtoken');
const { JWT_SECRET, isClergyRank } = require('../config');
const { pool } = require('../db/pool');
const { getClientIp, ipMatchesRule } = require('../services/systemState');

function extractBearerToken(req, { allowQueryToken = false } = {}) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (allowQueryToken && req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return null;
}

async function loadUserFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      `SELECT id, email, username, full_name, title_prefix, ecclesiastical_rank,
              religious_order_initials, primary_unit_id, religious_order_id,
              current_office_title, bio, motto, ordination_date, country_code,
              languages, preferred_locale, avatar_color, avatar_url, avatar_style, cover_url,
              verification_status, verification_note, is_admin, is_credo_plus, credo_plus_plan,
              is_ceo, is_cto, website_links, active_plan_sku, ad_free, studio_eligible, one_badge,
              phone, cedula_verified, cedula_official_name, account_status,
              role, moderation_status, muted_until, suspended_until, moderation_reason,
              token_version, plan_expires_at, created_at
         FROM users
        WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user) return null;

    // Immediate Force Logout via token_version mismatch (skip check for active impersonation tokens)
    if (!payload.impBy && payload.tv && Number(payload.tv) !== Number(user.token_version || 1)) {
      return null;
    }

    // Account active & moderation enforcement (allow impersonator to inspect any user!)
    if (!payload.impBy) {
      if ((user.account_status || 'active') !== 'active') return null;
      if (user.moderation_status === 'banned') return null;
      if (user.moderation_status === 'suspended') {
        if (!user.suspended_until || new Date(user.suspended_until).getTime() > Date.now()) {
          return null;
        }
      }
    }

    // Expire manual plan if plan_expires_at passed
    if (user.plan_expires_at && new Date(user.plan_expires_at).getTime() <= Date.now() && user.active_plan_sku) {
      pool
        .query(
          `UPDATE users SET active_plan_sku = '', ad_free = FALSE, one_badge = '', plan_expires_at = NULL WHERE id = $1`,
          [user.id]
        )
        .catch(() => {});
      user.active_plan_sku = '';
      user.ad_free = false;
      user.one_badge = '';
    }

    if (payload.impBy) {
      user._impersonated_by = payload.impBy;
      user._impersonator_name = payload.impName || 'Super-Admin';
    }

    return user;
  } catch {
    return null;
  }
}

async function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (token) {
    req.user = await loadUserFromToken(token);
  }
  next();
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  const user = await loadUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

function requireNotMuted(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.moderation_status === 'muted') {
    if (!req.user.muted_until || new Date(req.user.muted_until).getTime() > Date.now()) {
      return res.status(403).json({
        error: 'USER_MUTED',
        message: req.user.moderation_reason || 'Tu cuenta está en modo solo lectura temporalmente.',
      });
    }
  }
  return next();
}

function requireClergy(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.moderation_status === 'muted') {
    if (!req.user.muted_until || new Date(req.user.muted_until).getTime() > Date.now()) {
      return res.status(403).json({
        error: 'USER_MUTED',
        message: req.user.moderation_reason || 'Tu cuenta está silenciada temporalmente.',
      });
    }
  }
  const hasVerifiedClergy =
    isClergyRank(req.user.ecclesiastical_rank) && req.user.verification_status === 'verified';
  const hasOnePublish = ['user_one_pro', 'biz_one_plus', 'biz_one_pro', 'biz_one_enterprise'].includes(
    req.user.active_plan_sku || ''
  );
  const isSuper = req.user.role === 'super_admin' || req.user.is_ceo || req.user.is_cto;
  if (!hasVerifiedClergy && !hasOnePublish && !isSuper) {
    return res.status(403).json({
      error: 'CLERGY_ONLY_PUBLISH',
      message: 'Publicar requiere cuenta clerical verificada o una suscripción Credo One Pro / Empresas.',
    });
  }
  next();
}

function isUserSuperAdmin(user) {
  if (!user) return false;
  return (
    user.role === 'super_admin' ||
    Boolean(user.is_cto) ||
    Boolean(user.is_admin) ||
    String(user.username || '').toLowerCase() === 'paulinosstudios'
  );
}

function isIpAllowedForAdmin(req) {
  const allowedRaw = String(process.env.ADMIN_ALLOWED_IPS || '').trim();
  if (!allowedRaw) return true;
  const ip = getClientIp(req);
  const rules = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
  return rules.some((rule) => ipMatchesRule(ip, rule));
}

async function requireSuperAdmin(req, res, next) {
  if (!isIpAllowedForAdmin(req)) {
    return res.status(403).json({ error: 'IP no autorizada para Credo Core OS.' });
  }
  const allowQuery = req.path.includes('/stream') || req.path.endsWith('.csv');
  const token = extractBearerToken(req, { allowQueryToken: allowQuery });
  const user = await loadUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Sesión Super-Admin requerida.' });
  }
  if (!isUserSuperAdmin(user) || user._impersonated_by) {
    return res.status(403).json({ error: 'Acceso exclusivo para Super-Admin (Credo Core OS).' });
  }
  req.user = user;
  req.admin = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !isUserSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      rank: user.ecclesiastical_rank,
      role: isUserSuperAdmin(user) ? 'super_admin' : user.role || 'user',
      isAdmin: isUserSuperAdmin(user),
      tv: Number(user.token_version || 1),
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function signImpersonationToken(targetUser, adminUser) {
  return jwt.sign(
    {
      sub: targetUser.id,
      rank: targetUser.ecclesiastical_rank,
      role: 'user',
      isAdmin: false,
      impBy: adminUser.id,
      impName: adminUser.username || adminUser.full_name || 'Super-Admin',
    },
    JWT_SECRET,
    { expiresIn: '30m' }
  );
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireNotMuted,
  requireClergy,
  requireAdmin,
  requireSuperAdmin,
  isUserSuperAdmin,
  isIpAllowedForAdmin,
  signToken,
  signImpersonationToken,
};
