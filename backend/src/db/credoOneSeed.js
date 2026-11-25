const { pool } = require('./pool');
const { getKernelCatalog } = require('../services/fsharpKernel');

/**
 * Seeds PostgreSQL `subscription_plans` strictly from the compiled F# 8 kernel (`credo-core`).
 * Zero prices, quotas, seat ceilings, or critical plan parameters are hardcoded in JavaScript.
 */
async function seedCredoOnePlans() {
  const { plans, engine, integrity_seal } = getKernelCatalog();
  for (const p of plans) {
    await pool.query(
      `INSERT INTO subscription_plans (
         sku, audience, display_name, subtitle,
         price_monthly_cents, price_annual_cents,
         is_popular, is_enterprise, max_seats, monthly_impressions,
         max_active_campaigns, ad_free, can_publish_open, studio_access,
         approval_workflow, audit_logs_enabled, badge_type, features, sort_order, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,NOW()
       )
       ON CONFLICT (sku) DO UPDATE SET
         audience = EXCLUDED.audience,
         display_name = EXCLUDED.display_name,
         subtitle = EXCLUDED.subtitle,
         price_monthly_cents = EXCLUDED.price_monthly_cents,
         price_annual_cents = EXCLUDED.price_annual_cents,
         is_popular = EXCLUDED.is_popular,
         is_enterprise = EXCLUDED.is_enterprise,
         max_seats = EXCLUDED.max_seats,
         monthly_impressions = EXCLUDED.monthly_impressions,
         max_active_campaigns = EXCLUDED.max_active_campaigns,
         ad_free = EXCLUDED.ad_free,
         can_publish_open = EXCLUDED.can_publish_open,
         studio_access = EXCLUDED.studio_access,
         approval_workflow = EXCLUDED.approval_workflow,
         audit_logs_enabled = EXCLUDED.audit_logs_enabled,
         badge_type = EXCLUDED.badge_type,
         features = EXCLUDED.features,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()`,
      [
        p.sku,
        p.audience,
        p.display_name,
        p.subtitle,
        p.price_monthly_cents,
        p.price_annual_cents,
        p.is_popular,
        p.is_enterprise,
        p.max_seats,
        p.monthly_impressions,
        p.max_active_campaigns,
        p.ad_free,
        p.can_publish_open,
        p.studio_access,
        p.approval_workflow,
        p.audit_logs_enabled,
        p.badge_type,
        JSON.stringify(p.features || []),
        p.sort_order,
      ]
    );
  }
  return { engine, integrity_seal, count: plans.length };
}

module.exports = {
  seedCredoOnePlans,
};
