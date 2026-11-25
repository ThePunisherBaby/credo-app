const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  requireOrgRole,
  getOrganizationPlan,
  ensureOrgForSubscription,
  writeAuditLog,
  hasPermission,
} = require('../middleware/rbac');
const { apiCache } = require('../utils/fastCache');
const fsharpKernel = require('../services/fsharpKernel');

const router = express.Router();

const VALID_ROLES = ['owner', 'admin', 'editor', 'moderator', 'analyst'];
const VALID_CTAS = ['whatsapp', 'web', 'offering', 'event_register', 'lead_form'];

// GET /api/v1/studio/context — User's organizations, roles, active plan, impression pool & feature flags
router.get('/context', requireAuth, async (req, res) => {
  try {
    // Auto-provision official workspace for CEO/Admin if they don't own one yet
    if (req.user.is_ceo || req.user.is_admin) {
      const ownCheck = await pool.query(
        'SELECT id FROM organizations WHERE owner_user_id = $1 LIMIT 1',
        [req.user.id]
      );
      if (ownCheck.rows.length === 0) {
        const { rows: entPlan } = await pool.query(
          "SELECT * FROM subscription_plans WHERE sku = 'biz_one_enterprise'"
        );
        if (entPlan[0]) {
          await ensureOrgForSubscription(req.user, entPlan[0]);
        }
      }
    }

    const { rows: orgRows } = await pool.query(
      `SELECT DISTINCT ON (o.id)
              o.id, o.slug, o.name, o.org_type, o.badge_type, o.avatar_style,
              o.avatar_url, o.avatar_color, o.country_code, o.city,
              o.website_url, o.whatsapp_number, o.parent_org_id, o.approval_required,
              COALESCE(
                CASE WHEN o.owner_user_id = $1 THEN 'owner' ELSE m.role END,
                CASE WHEN $2 THEN 'owner' ELSE 'analyst' END
              ) AS my_role
         FROM organizations o
         LEFT JOIN organization_members m
           ON m.organization_id = o.id AND m.user_id = $1 AND m.status = 'active'
        WHERE o.owner_user_id = $1 OR m.id IS NOT NULL
        ORDER BY o.id ASC`,
      [req.user.id, Boolean(req.user.is_ceo || req.user.is_admin)]
    );

    const enrichedOrgs = [];
    for (const org of orgRows) {
      const plan = await getOrganizationPlan(org.id);
      if (!plan && !req.user.is_ceo && !req.user.is_admin) continue;

      const [seatRes, campRes, subAccountsRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM organization_members
            WHERE organization_id = $1 AND status IN ('active', 'invited')`,
          [org.id]
        ),
        pool.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_campaigns,
                  COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approvals,
                  COALESCE(SUM(impressions_served), 0)::int AS total_served,
                  COALESCE(SUM(impressions_allocated) FILTER (WHERE status IN ('active', 'scheduled', 'pending_approval')), 0)::int AS total_allocated
             FROM campaigns
            WHERE organization_id = $1`,
          [org.id]
        ),
        pool.query(
          `SELECT id, name, slug, avatar_url, avatar_color, city FROM organizations WHERE parent_org_id = $1 ORDER BY name ASC`,
          [org.id]
        ),
      ]);

      const quota = Number(plan?.impressions_quota || plan?.monthly_impressions || 0);
      const used = Math.min(
        quota,
        Math.max(Number(plan?.impressions_used || 0), Number(campRes.rows[0]?.total_served || 0))
      );

      enrichedOrgs.push({
        ...org,
        plan: plan || null,
        impressions_quota: quota,
        impressions_used: used,
        impressions_available: Math.max(0, quota - used),
        seats_used: seatRes.rows[0]?.cnt || 1,
        max_seats: plan?.max_seats ?? 1,
        active_campaigns: campRes.rows[0]?.active_campaigns || 0,
        pending_approvals: campRes.rows[0]?.pending_approvals || 0,
        sub_accounts: subAccountsRes.rows,
      });
    }

    return res.json({
      eligible: enrichedOrgs.length > 0,
      organizations: enrichedOrgs,
    });
  } catch (err) {
    console.error('[studio/context]', err);
    return res.status(500).json({ error: 'No se pudo cargar Credo One Studio' });
  }
});

// POST /api/v1/studio/organizations — Create Enterprise sub-account or update org settings
router.post('/organizations', requireAuth, requireOrgRole(['owner', 'admin'], 'org:settings'), async (req, res) => {
  try {
    const { mode = 'update', name, city = '', country_code = 'DO', website_url = '', whatsapp_number = '', approval_required } = req.body || {};

    if (mode === 'subaccount') {
      if (!req.orgPlan?.is_enterprise) {
        return res.status(403).json({
          error: 'ENTERPRISE_REQUIRED',
          message: 'La Red de Subcuentas Afiliadas es exclusiva de Credo One Enterprise.',
        });
      }
      const cleanName = String(name || '').trim();
      if (!cleanName) return res.status(400).json({ error: 'El nombre de la subcuenta es obligatorio.' });
      const slug = `${req.org.slug}-sub-${Date.now().toString(36)}`;
      const { rows } = await pool.query(
        `INSERT INTO organizations (
           slug, name, org_type, badge_type, avatar_style, avatar_url, avatar_color,
           country_code, city, parent_org_id, owner_user_id, approval_required
         ) VALUES ($1,$2,'enterprise','enterprise_gold','square',$3,$4,$5,$6,$7,$8,TRUE)
         RETURNING *`,
        [
          slug,
          cleanName.slice(0, 80),
          req.org.avatar_url || '',
          req.org.avatar_color || '#D4AF37',
          String(country_code).toUpperCase().slice(0, 4),
          String(city).trim().slice(0, 60),
          req.org.id,
          req.org.owner_user_id,
        ]
      );
      await writeAuditLog({
        organizationId: req.org.id,
        user: req.user,
        role: req.orgRole,
        action: 'subaccount.created',
        resourceType: 'organization',
        resourceId: String(rows[0].id),
        details: { name: cleanName, city },
        req,
      });
      return res.status(201).json({ organization: rows[0] });
    }

    const { rows } = await pool.query(
      `UPDATE organizations
          SET name = COALESCE(NULLIF($2, ''), name),
              city = $3,
              country_code = $4,
              website_url = $5,
              whatsapp_number = $6,
              approval_required = CASE WHEN $7::boolean IS NULL THEN approval_required ELSE $7::boolean END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        req.org.id,
        String(name || '').trim().slice(0, 80),
        String(city || '').trim().slice(0, 60),
        String(country_code || 'DO').trim().toUpperCase().slice(0, 4),
        String(website_url || '').trim().slice(0, 240),
        String(whatsapp_number || '').trim().slice(0, 40),
        typeof approval_required === 'boolean' ? (req.orgPlan?.is_enterprise ? true : approval_required) : null,
      ]
    );
    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: String(req.org.id),
      details: { name: rows[0].name, city: rows[0].city },
      req,
    });
    return res.json({ organization: rows[0] });
  } catch (err) {
    console.error('[studio/organizations]', err);
    return res.status(500).json({ error: 'Error al guardar organización' });
  }
});

// ============================================================================
// MODULE 1: PERFORMANCE OVERVIEW (/api/v1/studio/overview)
// ============================================================================
router.get('/overview', requireAuth, requireOrgRole(['owner', 'admin', 'editor', 'moderator', 'analyst'], 'analytics:read'), async (req, res) => {
  try {
    const rangeDays = [7, 30, 90].includes(Number(req.query.range)) ? Number(req.query.range) : 30;
    const orgId = req.org.id;

    const [currRes, prevRes, seriesRes, topRes, liveRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(organic_impressions + boosted_impressions), 0)::int AS total_impressions,
                COALESCE(SUM(boosted_impressions), 0)::int AS boosted_impressions,
                COALESCE(SUM(organic_impressions), 0)::int AS organic_impressions,
                COALESCE(SUM(clicks), 0)::int AS total_clicks,
                COALESCE(SUM(unique_viewers), 0)::int AS unique_reach,
                COALESCE(MAX(live_peak_viewers), 0)::int AS live_peak
           FROM campaign_metrics_daily
          WHERE organization_id = $1 AND metric_date >= CURRENT_DATE - ($2::int - 1)`,
        [orgId, rangeDays]
      ),
      pool.query(
        `SELECT COALESCE(SUM(organic_impressions + boosted_impressions), 0)::int AS total_impressions,
                COALESCE(SUM(clicks), 0)::int AS total_clicks,
                COALESCE(SUM(unique_viewers), 0)::int AS unique_reach
           FROM campaign_metrics_daily
          WHERE organization_id = $1
            AND metric_date >= CURRENT_DATE - (($2::int * 2) - 1)
            AND metric_date < CURRENT_DATE - ($2::int - 1)`,
        [orgId, rangeDays]
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, '1 day')::date AS d
         )
         SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
                COALESCE(SUM(m.organic_impressions), 0)::int AS organic,
                COALESCE(SUM(m.boosted_impressions), 0)::int AS boosted,
                COALESCE(SUM(m.clicks), 0)::int AS clicks
           FROM days
           LEFT JOIN campaign_metrics_daily m
             ON m.metric_date = days.d AND m.organization_id = $1
          GROUP BY days.d
          ORDER BY days.d ASC`,
        [orgId, rangeDays]
      ),
      pool.query(
        `SELECT id, title, objective, cta_type, cta_label, media_url, status,
                impressions_allocated, impressions_served, clicks_count, unique_reach,
                CASE WHEN impressions_served > 0
                     THEN ROUND((clicks_count::numeric / impressions_served::numeric) * 100, 2)
                     ELSE 0 END AS ctr
           FROM campaigns
          WHERE organization_id = $1
          ORDER BY clicks_count DESC, impressions_served DESC, id DESC
          LIMIT 5`,
        [orgId]
      ),
      pool.query(
        `SELECT COALESCE(MAX(listeners_count), 0)::int AS live_listeners FROM live_channels WHERE is_live = TRUE`
      ),
    ]);

    const c = currRes.rows[0] || {};
    const p = prevRes.rows[0] || {};
    const pctDelta = (cur, prev) => {
      if (!prev && !cur) return 0;
      if (!prev) return 100;
      return Number((((cur - prev) / prev) * 100).toFixed(1));
    };

    const currCtr = c.total_impressions > 0 ? Number(((c.total_clicks / c.total_impressions) * 100).toFixed(2)) : 0;
    const prevCtr = p.total_impressions > 0 ? Number(((p.total_clicks / p.total_impressions) * 100).toFixed(2)) : 0;

    return res.json({
      range: rangeDays,
      kpis: {
        impressions: {
          value: Number(c.total_impressions || 0),
          delta_pct: pctDelta(c.total_impressions || 0, p.total_impressions || 0),
        },
        clicks: {
          value: Number(c.total_clicks || 0),
          delta_pct: pctDelta(c.total_clicks || 0, p.total_clicks || 0),
        },
        ctr: {
          value: currCtr,
          delta_pct: Number((currCtr - prevCtr).toFixed(2)),
        },
        reach: {
          value: Number(c.unique_reach || 0),
          live_peak: Math.max(Number(c.live_peak || 0), Number(liveRes.rows[0]?.live_listeners || 0)),
          delta_pct: pctDelta(c.unique_reach || 0, p.unique_reach || 0),
        },
      },
      series: seriesRes.rows,
      top_campaigns: topRes.rows,
    });
  } catch (err) {
    console.error('[studio/overview]', err);
    return res.status(500).json({ error: 'No se pudieron cargar las métricas' });
  }
});

// ============================================================================
// MODULE 2: CAMPAIGNS & CREATOR (/api/v1/studio/campaigns)
// ============================================================================
router.get('/campaigns', requireAuth, requireOrgRole(['owner', 'admin', 'editor', 'moderator', 'analyst'], 'analytics:read'), async (req, res) => {
  try {
    const { status = 'all', q = '' } = req.query;
    const clauses = ['c.organization_id = $1'];
    const params = [req.org.id];

    if (status && status !== 'all') {
      params.push(String(status));
      clauses.push(`c.status = $${params.length}`);
    }
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      clauses.push(`(c.title ILIKE $${params.length} OR c.body ILIKE $${params.length})`);
    }

    const [campRes, postsRes] = await Promise.all([
      pool.query(
        `SELECT c.*, u.full_name AS creator_name,
                CASE WHEN c.impressions_served > 0
                     THEN ROUND((c.clicks_count::numeric / c.impressions_served::numeric) * 100, 2)
                     ELSE 0 END AS ctr
           FROM campaigns c
           LEFT JOIN users u ON u.id = c.creator_user_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY c.created_at DESC
          LIMIT 100`,
        params
      ),
      pool.query(
        `SELECT id, title, content, image_url, media_kind, created_at
           FROM posts
          WHERE author_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [req.org.owner_user_id]
      ),
    ]);

    return res.json({
      campaigns: campRes.rows,
      available_posts: postsRes.rows,
    });
  } catch (err) {
    console.error('[studio/campaigns/list]', err);
    return res.status(500).json({ error: 'No se pudieron cargar las campañas' });
  }
});

router.post('/campaigns', requireAuth, requireOrgRole(['owner', 'admin', 'editor'], 'campaign:draft'), async (req, res) => {
  try {
    const plan = req.orgPlan;
    if (!plan) {
      return res.status(402).json({ error: 'PLAN_REQUIRED', message: 'Necesitas un plan Credo One activo.' });
    }

    const {
      post_id = null,
      title,
      body = '',
      media_url = '',
      media_kind = 'photo',
      objective = 'whatsapp',
      cta_type = 'whatsapp',
      cta_label = 'Ir a WhatsApp',
      cta_url = '',
      target_country = 'ALL',
      target_city = '',
      target_category = 'general',
      impressions_allocated = 5000,
      starts_at = null,
      ends_at = null,
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      return res.status(400).json({ error: 'El título de la campaña es obligatorio.' });
    }
    if (!VALID_CTAS.includes(cta_type)) {
      return res.status(400).json({ error: 'Tipo de botón CTA no válido.' });
    }
    const activeCntRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM campaigns
        WHERE organization_id = $1 AND status IN ('active', 'scheduled', 'pending_approval')`,
      [req.org.id]
    );
    const remainingPool = Math.max(
      0,
      Number(plan.impressions_quota || plan.monthly_impressions || 0) - Number(plan.impressions_used || 0)
    );

    const guard = fsharpKernel.validateCampaignCreation({
      sku: plan.plan_sku,
      actorRole: req.orgRole,
      ctaType: cta_type,
      activeCampaignsCount: activeCntRes.rows[0]?.cnt || 0,
      requestedImpressions: Number(impressions_allocated) || 5000,
      remainingPool,
      orgApprovalRequired: Boolean(req.org.approval_required),
    });

    if (!guard.allowed) {
      return res.status(guard.http_status || 403).json({
        error: guard.code,
        message: guard.message,
      });
    }

    const alloc = guard.safe_allocated_impressions;
    const needsApproval = Boolean(guard.requires_approval);

    const startDate = starts_at ? new Date(starts_at) : new Date();
    const isFuture = startDate.getTime() > Date.now() + 60_000;
    const initialStatus = needsApproval ? 'pending_approval' : isFuture ? 'scheduled' : 'active';

    const { rows } = await pool.query(
      `INSERT INTO campaigns (
         organization_id, creator_user_id, post_id, title, body, media_url, media_kind,
         objective, cta_type, cta_label, cta_url, target_country, target_city, target_category,
         impressions_allocated, status, starts_at, ends_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        req.org.id,
        req.user.id,
        post_id ? Number(post_id) : null,
        cleanTitle.slice(0, 140),
        String(body || '').trim().slice(0, 1200),
        String(media_url || '').trim().slice(0, 500),
        ['photo', 'video', 'article'].includes(media_kind) ? media_kind : 'photo',
        String(objective || cta_type).slice(0, 40),
        cta_type,
        String(cta_label || 'Más información').trim().slice(0, 50),
        String(cta_url || '').trim().slice(0, 500),
        String(target_country || 'ALL').trim().toUpperCase().slice(0, 8),
        String(target_city || '').trim().slice(0, 80),
        String(target_category || 'general').trim().slice(0, 50),
        alloc,
        initialStatus,
        startDate.toISOString(),
        ends_at ? new Date(ends_at).toISOString() : null,
      ]
    );

    const campaign = rows[0];

    if (needsApproval) {
      await pool.query(
        `INSERT INTO approval_requests (organization_id, campaign_id, submitted_by, status)
         VALUES ($1,$2,$3,'pending')`,
        [req.org.id, campaign.id, req.user.id]
      );
    }

    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: needsApproval ? 'campaign.submitted_for_approval' : 'campaign.created',
      resourceType: 'campaign',
      resourceId: String(campaign.id),
      details: { title: campaign.title, cta_type, impressions_allocated: alloc, status: initialStatus },
      req,
    });

    apiCache.invalidate('posts:');
    return res.status(201).json({ campaign, requires_approval: needsApproval });
  } catch (err) {
    console.error('[studio/campaigns/create]', err);
    return res.status(500).json({ error: 'No se pudo crear la campaña' });
  }
});

router.patch('/campaigns/:id/toggle', requireAuth, requireOrgRole(['owner', 'admin'], 'campaign:toggle'), async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const { rows } = await pool.query(
      'SELECT * FROM campaigns WHERE id = $1 AND organization_id = $2',
      [campaignId, req.org.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Campaña no encontrada' });

    const camp = rows[0];
    if (camp.status === 'pending_approval') {
      return res.status(409).json({ error: 'Aprueba primero esta campaña en la Cola de Aprobación.' });
    }
    if (camp.impressions_served >= camp.impressions_allocated && camp.status !== 'active') {
      return res.status(409).json({ error: 'Esta campaña ya consumió el 100% de sus impresiones asignadas.' });
    }

    const nextStatus = camp.status === 'active' ? 'paused' : 'active';
    const upd = await pool.query(
      'UPDATE campaigns SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [campaignId, nextStatus]
    );

    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: nextStatus === 'active' ? 'campaign.resumed' : 'campaign.paused',
      resourceType: 'campaign',
      resourceId: String(campaignId),
      details: { title: camp.title, status: nextStatus },
      req,
    });

    apiCache.invalidate('posts:');
    return res.json({ campaign: upd.rows[0] });
  } catch (err) {
    console.error('[studio/campaigns/toggle]', err);
    return res.status(500).json({ error: 'No se pudo cambiar el estado de la campaña' });
  }
});

// ============================================================================
// MODULE 3: TEAM, RBAC, APPROVAL QUEUE & ENTERPRISE AUDIT LOGS
// ============================================================================
router.get('/team', requireAuth, requireOrgRole(['owner', 'admin', 'editor', 'moderator', 'analyst'], 'analytics:read'), async (req, res) => {
  try {
    const { rows: members } = await pool.query(
      `SELECT m.id, m.user_id, m.invited_email, m.role, m.status, m.created_at,
              u.full_name, u.username, u.email, u.avatar_url, u.avatar_color
         FROM organization_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.status <> 'revoked'
        ORDER BY CASE m.role
                   WHEN 'owner' THEN 1
                   WHEN 'admin' THEN 2
                   WHEN 'editor' THEN 3
                   WHEN 'moderator' THEN 4
                   ELSE 5 END, m.created_at ASC`,
      [req.org.id]
    );

    return res.json({
      members,
      seats_used: members.length,
      max_seats: req.orgPlan?.max_seats ?? 1,
      plan_name: req.orgPlan?.display_name || 'Credo One',
      approval_workflow: Boolean(req.orgPlan?.approval_workflow),
      audit_logs_enabled: Boolean(req.orgPlan?.audit_logs_enabled),
    });
  } catch (err) {
    console.error('[studio/team]', err);
    return res.status(500).json({ error: 'No se pudo cargar el equipo' });
  }
});

router.post('/team/invite', requireAuth, requireOrgRole(['owner', 'admin'], 'team:manage_members'), async (req, res) => {
  try {
    const { email, role = 'editor' } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
    }
    const cntRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM organization_members
        WHERE organization_id = $1 AND status IN ('active', 'invited')`,
      [req.org.id]
    );
    const seatGuard = fsharpKernel.validateSeatInvite(
      req.orgPlan?.plan_sku || '',
      req.orgRole,
      role,
      cntRes.rows[0]?.cnt || 0
    );
    if (!seatGuard.allowed) {
      return res.status(seatGuard.http_status || 403).json({
        error: seatGuard.code,
        message: seatGuard.message,
      });
    }

    const userRes = await pool.query('SELECT id, full_name, username FROM users WHERE LOWER(email) = $1 LIMIT 1', [
      cleanEmail,
    ]);
    const existingUser = userRes.rows[0] || null;

    const { rows } = await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, invited_email, role, status, invited_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        req.org.id,
        existingUser ? existingUser.id : null,
        cleanEmail,
        role,
        existingUser ? 'active' : 'invited',
        req.user.id,
      ]
    );

    if (!rows[0]) {
      return res.status(409).json({ error: 'Este correo ya pertenece o fue invitado a tu organización.' });
    }

    if (existingUser) {
      await pool.query('UPDATE users SET studio_eligible = TRUE WHERE id = $1', [existingUser.id]);
    }

    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: 'team.member_invited',
      resourceType: 'organization_member',
      resourceId: String(rows[0].id),
      details: { email: cleanEmail, role },
      req,
    });

    return res.status(201).json({ member: rows[0] });
  } catch (err) {
    console.error('[studio/team/invite]', err);
    return res.status(500).json({ error: 'No se pudo invitar al miembro' });
  }
});

router.patch('/team/:memberId', requireAuth, requireOrgRole(['owner', 'admin'], 'team:manage_members'), async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role) || role === 'owner') {
      return res.status(400).json({ error: 'Rol inválido.' });
    }

    const targetRes = await pool.query(
      'SELECT * FROM organization_members WHERE id = $1 AND organization_id = $2',
      [memberId, req.org.id]
    );
    if (!targetRes.rows[0]) return res.status(404).json({ error: 'Miembro no encontrado' });
    const target = targetRes.rows[0];
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'No se puede modificar el rol del Owner principal.' });
    }
    if ((target.role === 'admin' || role === 'admin') && !hasPermission(req.orgRole, 'team:manage_admins')) {
      return res.status(403).json({ error: 'Solo el Owner puede gestionar permisos de Admin.' });
    }

    const upd = await pool.query(
      'UPDATE organization_members SET role = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [memberId, role]
    );
    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: 'team.role_changed',
      resourceType: 'organization_member',
      resourceId: String(memberId),
      details: { from: target.role, to: role, email: target.invited_email },
      req,
    });
    return res.json({ member: upd.rows[0] });
  } catch (err) {
    console.error('[studio/team/update]', err);
    return res.status(500).json({ error: 'No se pudo actualizar el rol' });
  }
});

router.delete('/team/:memberId', requireAuth, requireOrgRole(['owner', 'admin'], 'team:manage_members'), async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    const targetRes = await pool.query(
      'SELECT * FROM organization_members WHERE id = $1 AND organization_id = $2',
      [memberId, req.org.id]
    );
    if (!targetRes.rows[0]) return res.status(404).json({ error: 'Miembro no encontrado' });
    const target = targetRes.rows[0];
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'No se puede remover al Owner de la organización.' });
    }
    if (target.role === 'admin' && !hasPermission(req.orgRole, 'team:manage_admins')) {
      return res.status(403).json({ error: 'Solo el Owner puede remover a un Admin.' });
    }

    await pool.query("UPDATE organization_members SET status = 'revoked', updated_at = NOW() WHERE id = $1", [memberId]);
    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: 'team.member_removed',
      resourceType: 'organization_member',
      resourceId: String(memberId),
      details: { email: target.invited_email, role: target.role },
      req,
    });
    return res.json({ removed: true });
  } catch (err) {
    console.error('[studio/team/delete]', err);
    return res.status(500).json({ error: 'No se pudo remover al miembro' });
  }
});

// Approval Queue
router.get('/approvals', requireAuth, requireOrgRole(['owner', 'admin', 'editor'], 'analytics:read'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ar.*, c.title AS campaign_title, c.body AS campaign_body, c.media_url,
              c.cta_type, c.cta_label, c.cta_url, c.impressions_allocated,
              su.full_name AS submitted_by_name, ru.full_name AS reviewer_name
         FROM approval_requests ar
         LEFT JOIN campaigns c ON c.id = ar.campaign_id
         LEFT JOIN users su ON su.id = ar.submitted_by
         LEFT JOIN users ru ON ru.id = ar.reviewer_id
        WHERE ar.organization_id = $1
        ORDER BY CASE WHEN ar.status = 'pending' THEN 0 ELSE 1 END, ar.created_at DESC
        LIMIT 60`,
      [req.org.id]
    );
    return res.json({ approvals: rows });
  } catch (err) {
    console.error('[studio/approvals]', err);
    return res.status(500).json({ error: 'No se pudo cargar la cola de aprobación' });
  }
});

router.post('/approvals/:id/decide', requireAuth, requireOrgRole(['owner', 'admin'], 'campaign:approve'), async (req, res) => {
  try {
    const approvalId = Number(req.params.id);
    const { decision, note = '' } = req.body || {};
    if (!['approve', 'return'].includes(decision)) {
      return res.status(400).json({ error: 'decision debe ser approve o return' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1 AND organization_id = $2`,
      [approvalId, req.org.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Solicitud de aprobación no encontrada' });

    const reqRow = rows[0];
    const nextApprovalStatus = decision === 'approve' ? 'approved' : 'returned';
    const nextCampaignStatus = decision === 'approve' ? 'active' : 'rejected';

    await pool.query(
      `UPDATE approval_requests
          SET status = $2, reviewer_id = $3, reviewer_note = $4, reviewed_at = NOW()
        WHERE id = $1`,
      [approvalId, nextApprovalStatus, req.user.id, String(note || '').trim().slice(0, 500)]
    );

    if (reqRow.campaign_id) {
      await pool.query(
        'UPDATE campaigns SET status = $2, updated_at = NOW() WHERE id = $1',
        [reqRow.campaign_id, nextCampaignStatus]
      );
    }

    await writeAuditLog({
      organizationId: req.org.id,
      user: req.user,
      role: req.orgRole,
      action: decision === 'approve' ? 'approval.approved_and_published' : 'approval.returned_with_note',
      resourceType: 'campaign',
      resourceId: String(reqRow.campaign_id || approvalId),
      details: { approval_id: approvalId, note },
      req,
    });

    apiCache.invalidate('posts:');
    return res.json({ decided: true, status: nextApprovalStatus });
  } catch (err) {
    console.error('[studio/approvals/decide]', err);
    return res.status(500).json({ error: 'No se pudo procesar la aprobación' });
  }
});

// Enterprise Immutable Audit Logs
router.get('/audit-logs', requireAuth, requireOrgRole(['owner', 'admin'], 'audit:read'), async (req, res) => {
  try {
    if (!req.orgPlan?.audit_logs_enabled) {
      return res.status(403).json({
        error: 'ENTERPRISE_REQUIRED',
        message: 'El Registro de Auditoría Inmutable (Audit Logs) es exclusivo de Credo One Enterprise.',
      });
    }
    const { rows } = await pool.query(
      `SELECT id, actor_name, actor_role, action, resource_type, resource_id, details, ip_address, created_at
         FROM audit_logs
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 120`,
      [req.org.id]
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error('[studio/audit-logs]', err);
    return res.status(500).json({ error: 'No se pudieron cargar los logs de auditoría' });
  }
});

// ============================================================================
// MODULE 4: BILLING & CSV EXPORT (/api/v1/studio/billing & /export.csv)
// ============================================================================
router.get('/billing', requireAuth, requireOrgRole(['owner', 'admin', 'analyst'], 'analytics:read'), async (req, res) => {
  try {
    const { rows: txRows } = await pool.query(
      `SELECT id, paypal_sale_id, plan_sku, amount_cents, currency, status, description, created_at
         FROM billing_transactions
        WHERE organization_id = $1 OR user_id = $2
        ORDER BY created_at DESC
        LIMIT 40`,
      [req.org.id, req.org.owner_user_id]
    );

    return res.json({
      plan: req.orgPlan,
      can_manage_billing: hasPermission(req.orgRole, 'billing:manage'),
      transactions: txRows,
    });
  } catch (err) {
    console.error('[studio/billing]', err);
    return res.status(500).json({ error: 'No se pudo cargar la facturación' });
  }
});

router.get('/export.csv', requireAuth, requireOrgRole(['owner', 'admin', 'analyst'], 'analytics:export'), async (req, res) => {
  try {
    if (!req.orgPlan || !['biz_one_pro', 'biz_one_enterprise'].includes(req.orgPlan.plan_sku)) {
      return res.status(403).json({
        error: 'UPGRADE_REQUIRED',
        message: 'La exportación CSV/PDF está disponible a partir de Empresas Credo One Pro.',
      });
    }
    const { rows } = await pool.query(
      `SELECT id, title, status, objective, cta_type, target_country,
              impressions_allocated, impressions_served, clicks_count, unique_reach, created_at
         FROM campaigns
        WHERE organization_id = $1
        ORDER BY created_at DESC`,
      [req.org.id]
    );

    const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'ID,Titulo,Estado,Objetivo,CTA,Pais,Impresiones_Asignadas,Impresiones_Servidas,Clics,CTR_Pct,Alcance_Unico,Creada';
    const lines = rows.map((r) => {
      const ctr = r.impressions_served > 0 ? ((r.clicks_count / r.impressions_served) * 100).toFixed(2) : '0.00';
      return [
        r.id,
        r.title,
        r.status,
        r.objective,
        r.cta_type,
        r.target_country,
        r.impressions_allocated,
        r.impressions_served,
        r.clicks_count,
        ctr,
        r.unique_reach,
        r.created_at?.toISOString?.() || '',
      ]
        .map(escCsv)
        .join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="credo-one-studio-org-${req.org.id}.csv"`);
    return res.send([header, ...lines].join('\n'));
  } catch (err) {
    console.error('[studio/export.csv]', err);
    return res.status(500).json({ error: 'No se pudo generar el CSV' });
  }
});

module.exports = router;
