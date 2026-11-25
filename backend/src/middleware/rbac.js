const { pool } = require('../db/pool');

const ROLE_HIERARCHY = {
  owner: 5,
  admin: 4,
  editor: 3,
  moderator: 2,
  analyst: 1,
};

const ROLE_PERMISSIONS = {
  owner: new Set([
    'billing:manage',
    'org:delete',
    'org:settings',
    'team:manage_admins',
    'team:manage_members',
    'campaign:approve',
    'campaign:publish',
    'campaign:draft',
    'campaign:toggle',
    'community:moderate',
    'analytics:read',
    'analytics:export',
    'audit:read',
  ]),
  admin: new Set([
    'org:settings',
    'team:manage_members',
    'campaign:approve',
    'campaign:publish',
    'campaign:draft',
    'campaign:toggle',
    'community:moderate',
    'analytics:read',
    'analytics:export',
    'audit:read',
  ]),
  editor: new Set([
    'campaign:draft',
    'campaign:publish', // Overridden to pending_approval in Enterprise / approval-required orgs
    'analytics:read',
  ]),
  moderator: new Set([
    'community:moderate',
    'analytics:read',
  ]),
  analyst: new Set([
    'analytics:read',
    'analytics:export',
  ]),
};

function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.has(permission));
}

function getClientIp(req) {
  if (!req) return '';
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

async function writeAuditLog({
  organizationId,
  user,
  role = '',
  action,
  resourceType,
  resourceId = '',
  details = {},
  req = null,
}) {
  if (!organizationId || !action) return;
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         organization_id, actor_user_id, actor_name, actor_role,
         action, resource_type, resource_id, details, ip_address
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        Number(organizationId),
        user?.id || null,
        user?.full_name || user?.username || 'Sistema',
        role || (user?.is_ceo ? 'owner' : 'system'),
        String(action),
        String(resourceType || 'studio'),
        String(resourceId || ''),
        JSON.stringify(details || {}),
        getClientIp(req),
      ]
    );
  } catch (err) {
    console.warn('[audit_log] write failed:', err.message);
  }
}

/**
 * Resolves the active subscription + plan for a given organization (or falls back to owner's subscription).
 */
async function getOrganizationPlan(orgId) {
  const { rows } = await pool.query(
    `SELECT s.id AS subscription_id, s.plan_sku, s.billing_cycle, s.status,
            s.impressions_quota, s.impressions_used, s.current_period_start, s.current_period_end,
            s.paypal_subscription_id,
            p.audience, p.display_name, p.price_monthly_cents, p.price_annual_cents,
            p.max_seats, p.monthly_impressions, p.max_active_campaigns,
            p.ad_free, p.can_publish_open, p.studio_access, p.approval_workflow,
            p.audit_logs_enabled, p.badge_type, p.is_enterprise
       FROM subscriptions s
       JOIN subscription_plans p ON p.sku = s.plan_sku
      WHERE s.organization_id = $1 AND s.status = 'active'
      ORDER BY p.sort_order DESC, s.updated_at DESC
      LIMIT 1`,
    [orgId]
  );
  if (rows[0]) return rows[0];

  // Platform CEO fallback (Enterprise Command Center for Credo official org)
  const { rows: orgRows } = await pool.query(
    `SELECT o.owner_user_id, u.is_ceo, u.is_admin
       FROM organizations o
       JOIN users u ON u.id = o.owner_user_id
      WHERE o.id = $1`,
    [orgId]
  );
  if (orgRows[0]?.is_ceo || orgRows[0]?.is_admin) {
    const { rows: entRows } = await pool.query(
      `SELECT NULL::int AS subscription_id, p.sku AS plan_sku, 'custom' AS billing_cycle, 'active' AS status,
              p.monthly_impressions AS impressions_quota, 0 AS impressions_used,
              NOW() AS current_period_start, NOW() + INTERVAL '30 days' AS current_period_end,
              '' AS paypal_subscription_id,
              p.audience, p.display_name, p.price_monthly_cents, p.price_annual_cents,
              p.max_seats, p.monthly_impressions, p.max_active_campaigns,
              p.ad_free, p.can_publish_open, p.studio_access, p.approval_workflow,
              p.audit_logs_enabled, p.badge_type, p.is_enterprise
         FROM subscription_plans p
        WHERE p.sku = 'biz_one_enterprise'`
    );
    return entRows[0] || null;
  }
  return null;
}

/**
 * Ensures an organization exists for a user activating a Studio-capable plan (or CEO).
 */
async function ensureOrgForSubscription(user, plan) {
  const isEnterprise = Boolean(plan?.is_enterprise);
  const isBusiness = plan?.audience === 'business';
  const orgType = isEnterprise ? 'enterprise' : isBusiness ? 'business' : 'personal';
  const avatarStyle = isEnterprise ? 'square' : 'circle';
  const badgeType = plan?.badge_type || (isBusiness ? 'verified_business' : 'verified_personal');

  const existing = await pool.query(
    `SELECT o.*
       FROM organizations o
      WHERE o.owner_user_id = $1
        AND (($2 = 'personal' AND o.org_type = 'personal') OR ($2 <> 'personal' AND o.org_type <> 'personal'))
      ORDER BY o.id ASC
      LIMIT 1`,
    [user.id, orgType]
  );

  if (existing.rows[0]) {
    const org = existing.rows[0];
    const { rows: updated } = await pool.query(
      `UPDATE organizations
          SET org_type = $2,
              badge_type = $3,
              avatar_style = $4,
              approval_required = CASE WHEN $5 THEN TRUE ELSE approval_required END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [org.id, orgType, badgeType, avatarStyle, isEnterprise]
    );
    return updated[0];
  }

  const baseSlug = `${(user.username || 'credo').toLowerCase().replace(/[^a-z0-9]/g, '')}-${orgType}-${user.id}`;
  const displayName = isBusiness
    ? `${user.full_name} · Institucional`
    : user.full_name || 'Mi Espacio Credo';

  const { rows } = await pool.query(
    `INSERT INTO organizations (
       slug, name, org_type, badge_type, avatar_style,
       avatar_url, avatar_color, country_code, owner_user_id, approval_required
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      baseSlug,
      displayName,
      orgType,
      badgeType,
      avatarStyle,
      user.avatar_url || '',
      user.avatar_color || '#0A84FF',
      user.country_code || 'DO',
      user.id,
      isEnterprise,
    ]
  );
  const org = rows[0];

  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, invited_email, role, status, invited_by)
     VALUES ($1,$2,$3,'owner','active',$2)
     ON CONFLICT DO NOTHING`,
    [org.id, user.id, user.email || '']
  );

  return org;
}

/**
 * Reconciles a user's denormalized entitlement columns on `users` from all active subscriptions
 * and active team memberships.
 */
async function reconcileUserEntitlements(userId) {
  const { rows: userRows } = await pool.query(
    `SELECT id, is_ceo, is_admin, email FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRows[0]) return null;
  const user = userRows[0];

  // Link any pending email invitations to this user account automatically
  if (user.email) {
    await pool
      .query(
        `UPDATE organization_members
            SET user_id = $1, status = 'active', updated_at = NOW()
          WHERE user_id IS NULL AND LOWER(invited_email) = LOWER($2) AND status = 'invited'`,
        [user.id, user.email]
      )
      .catch(() => {});
  }

  const { rows: subs } = await pool.query(
    `SELECT s.plan_sku, p.ad_free, p.studio_access, p.badge_type, p.sort_order
       FROM subscriptions s
       JOIN subscription_plans p ON p.sku = s.plan_sku
      WHERE s.user_id = $1 AND s.status = 'active'
      ORDER BY p.sort_order DESC`,
    [userId]
  );

  // Also check if user is an active member of an org with a Studio-capable subscription
  const { rows: orgAccess } = await pool.query(
    `SELECT 1
       FROM organization_members m
       JOIN subscriptions s ON s.organization_id = m.organization_id AND s.status = 'active'
       JOIN subscription_plans p ON p.sku = s.plan_sku AND p.studio_access = TRUE
      WHERE m.user_id = $1 AND m.status = 'active'
      LIMIT 1`,
    [userId]
  );

  const highest = subs[0] || null;
  const adFree = subs.some((s) => Boolean(s.ad_free));
  const studioEligible = Boolean(
    user.is_ceo || user.is_admin || subs.some((s) => Boolean(s.studio_access)) || orgAccess.length > 0
  );
  const activePlanSku = highest ? highest.plan_sku : (user.is_ceo ? 'biz_one_enterprise' : '');
  const oneBadge = highest ? highest.badge_type : (user.is_ceo ? 'enterprise_gold' : '');
  const isCredoPlus = Boolean(activePlanSku);

  await pool.query(
    `UPDATE users
        SET active_plan_sku = $2,
            ad_free = $3,
            studio_eligible = $4,
            one_badge = $5,
            is_credo_plus = $6,
            credo_plus_plan = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [userId, activePlanSku, adFree, studioEligible, oneBadge, isCredoPlus]
  );

  return { active_plan_sku: activePlanSku, ad_free: adFree, studio_eligible: studioEligible, one_badge: oneBadge };
}

/**
 * Pauses active campaigns for an organization when its subscription is suspended/expired/cancelled
 * without deleting any historical data or metrics.
 */
async function pauseOrganizationCampaigns(organizationId, reason = 'subscription_inactive') {
  if (!organizationId) return;
  await pool.query(
    `UPDATE campaigns
        SET status = 'paused', updated_at = NOW()
      WHERE organization_id = $1 AND status IN ('active', 'scheduled')`,
    [organizationId]
  );
  await writeAuditLog({
    organizationId,
    user: null,
    role: 'system',
    action: 'campaigns.auto_paused',
    resourceType: 'organization',
    resourceId: String(organizationId),
    details: { reason },
  });
}

/**
 * Express middleware: verifies the authenticated user holds one of `allowedRoles`
 * in the target organization (`req.query.org_id || req.body.org_id || req.params.orgId`).
 * Attaches `req.org`, `req.orgRole`, and `req.orgPlan`.
 */
function requireOrgRole(allowedRoles = ['owner', 'admin', 'editor', 'moderator', 'analyst'], requiredPermission = null) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const orgId = Number(req.query.org_id || req.body?.org_id || req.params?.orgId);
      if (!Number.isInteger(orgId) || orgId <= 0) {
        return res.status(400).json({ error: 'Valid org_id is required' });
      }

      const { rows: orgRows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
      if (!orgRows[0]) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      const org = orgRows[0];

      let role = null;
      if (org.owner_user_id === req.user.id || req.user.is_ceo || req.user.is_admin) {
        role = 'owner';
      } else {
        const { rows: memRows } = await pool.query(
          `SELECT role FROM organization_members
            WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
            LIMIT 1`,
          [orgId, req.user.id]
        );
        role = memRows[0]?.role || null;
      }

      if (!role) {
        return res.status(403).json({
          error: 'ORG_ACCESS_DENIED',
          message: 'No perteneces a esta organización en Credo One Studio.',
        });
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
        return res.status(403).json({
          error: 'RBAC_FORBIDDEN',
          message: `Tu rol (${role}) no tiene permiso para ejecutar esta acción.`,
          role,
        });
      }

      if (requiredPermission && !hasPermission(role, requiredPermission)) {
        return res.status(403).json({
          error: 'RBAC_PERMISSION_DENIED',
          message: `Tu rol (${role}) no cuenta con el permiso ${requiredPermission}.`,
          role,
        });
      }

      const plan = await getOrganizationPlan(orgId);
      req.org = org;
      req.orgRole = role;
      req.orgPlan = plan;
      return next();
    } catch (err) {
      console.error('[rbac]', err);
      return res.status(500).json({ error: 'RBAC validation error' });
    }
  };
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  hasPermission,
  writeAuditLog,
  getOrganizationPlan,
  ensureOrgForSubscription,
  reconcileUserEntitlements,
  pauseOrganizationCampaigns,
  requireOrgRole,
};
