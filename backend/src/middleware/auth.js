const jwt = require('jsonwebtoken');
const { JWT_SECRET, isClergyRank } = require('../config');
const { pool } = require('../db/pool');

function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
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
              languages, preferred_locale, avatar_color, avatar_url, verification_status,
              verification_note, is_admin, is_credo_plus, credo_plus_plan, is_ceo, is_cto, website_links,
              active_plan_sku, ad_free, studio_eligible, one_badge, created_at
         FROM users
        WHERE id = $1`,
      [payload.sub]
    );
    return rows[0] || null;
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

function requireClergy(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const hasOnePublish = ['user_one_pro', 'biz_one_plus', 'biz_one_pro', 'biz_one_enterprise'].includes(
    req.user.active_plan_sku || ''
  );
  if (!isClergyRank(req.user.ecclesiastical_rank) && !hasOnePublish && !req.user.is_ceo && !req.user.is_cto) {
    return res.status(403).json({
      error: 'CLERGY_ONLY_PUBLISH',
      message:
        'Publicar requiere cuenta clerical o una suscripción Credo One Pro / Empresas.',
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      rank: user.ecclesiastical_rank,
      isAdmin: Boolean(user.is_admin),
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireClergy,
  requireAdmin,
  signToken,
};
