/**
 * fsharpKernel.js — Bridge to the compiled F# 8 Core (`credo-core`) for all tamper-sensitive
 * pricing, impression quotas, seat limits, RBAC permissions, and payment integrity checks.
 *
 * - In Production Docker (`backend/Dockerfile`): executes the compiled F# binary `/app/bin/credo-core`.
 * - In local environments without .NET installed: parses canonical plan records directly from
 *   `fsharp-core/PricingKernel.fs` so the `.fs` file remains the SINGLE source of truth.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { JWT_SECRET } = require('../config');

const CANDIDATE_BINARIES = [
  process.env.CREDO_FSHARP_BIN || '',
  path.join(__dirname, '..', '..', 'bin', 'credo-core'),
  path.join(__dirname, '..', '..', 'fsharp-core', 'bin', 'Release', 'net8.0', 'credo-core'),
].filter(Boolean);

const FS_KERNEL_SOURCE = path.join(__dirname, '..', '..', 'fsharp-core', 'PricingKernel.fs');

function findCompiledBinary() {
  for (const p of CANDIDATE_BINARIES) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    } catch {}
  }
  return null;
}

function invokeBinary(args) {
  const bin = findCompiledBinary();
  if (!bin) return null;
  const out = execFileSync(bin, args.map(String), {
    encoding: 'utf8',
    timeout: 4000,
    env: { ...process.env, JWT_SECRET },
  });
  return JSON.parse(out.trim());
}

// Strict parser reading canonical immutable F# literals directly from PricingKernel.fs
// (only used when running outside the compiled Docker container).
function parsePlansFromFSharpSource() {
  const src = fs.readFileSync(FS_KERNEL_SOURCE, 'utf8');
  const blocks = src.split(/\{\s*Sku\s*=/).slice(1);
  const plans = [];

  for (const blk of blocks) {
    const str = (key) => {
      const m = blk.match(new RegExp(`${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      return m ? m[1].replace(/\\"/g, '"') : '';
    };
    const num = (key) => {
      const m = blk.match(new RegExp(`${key}\\s*=\\s*(-?\\d+)`));
      return m ? Number(m[1]) : 0;
    };
    const bool = (key) => {
      const m = blk.match(new RegExp(`${key}\\s*=\\s*(true|false)`));
      return m ? m[1] === 'true' : false;
    };
    const featMatch = blk.match(/Features\s*=\s*\[([\s\S]*?)\]/);
    const features = [];
    if (featMatch) {
      const rx = /"((?:[^"\\]|\\.)*)"/g;
      let fm;
      while ((fm = rx.exec(featMatch[1])) !== null) {
        features.push(fm[1].replace(/\\"/g, '"'));
      }
    }

    const sku = str('SkuCode');
    if (!sku) continue;
    plans.push({
      sku,
      audience: str('AudienceCode'),
      display_name: str('DisplayName'),
      subtitle: str('Subtitle'),
      price_monthly_cents: num('PriceMonthlyCents'),
      price_annual_cents: num('PriceAnnualCents'),
      is_popular: bool('IsPopular'),
      is_enterprise: bool('IsEnterprise'),
      max_seats: num('MaxSeats'),
      monthly_impressions: num('MonthlyImpressions'),
      max_active_campaigns: num('MaxActiveCampaigns'),
      ad_free: bool('AdFree'),
      can_publish_open: bool('CanPublishOpen'),
      studio_access: bool('StudioAccess'),
      approval_workflow: bool('ApprovalWorkflow'),
      audit_logs_enabled: bool('AuditLogsEnabled'),
      badge_type: str('BadgeCode'),
      sort_order: num('SortOrder'),
      features,
    });
  }

  const canonical = plans
    .map(
      (p) =>
        `${p.sku}|${p.audience}|${p.price_monthly_cents}|${p.price_annual_cents}|${p.max_seats}|${p.monthly_impressions}|${p.max_active_campaigns}|${p.ad_free}|${p.can_publish_open}|${p.studio_access}|${p.approval_workflow}|${p.audit_logs_enabled}`
    )
    .join('\n');
  const seal = crypto
    .createHmac('sha256', JWT_SECRET || 'credo-one-kernel-seal-v1')
    .update(canonical)
    .digest('hex');

  return {
    engine: 'fsharp-source-verified',
    integrity_seal: seal,
    constants: {
      min_campaign_allocation: 500,
      annual_free_months: 2,
      feed_first_slot: 1,
      feed_interval: 6,
      max_sponsored_per_page: 3,
    },
    plans,
  };
}

let cachedCatalog = null;

function getKernelCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const fromBin = invokeBinary(['catalog']);
  if (fromBin && Array.isArray(fromBin.plans) && fromBin.plans.length === 5) {
    console.log(`[fsharp-kernel] Active engine: ${fromBin.engine} (seal=${fromBin.integrity_seal.slice(0, 12)}…)`);
    cachedCatalog = fromBin;
    return cachedCatalog;
  }
  cachedCatalog = parsePlansFromFSharpSource();
  console.log(`[fsharp-kernel] Active engine: ${cachedCatalog.engine} (seal=${cachedCatalog.integrity_seal.slice(0, 12)}…)`);
  return cachedCatalog;
}

function getPlanSpec(sku) {
  return getKernelCatalog().plans.find((p) => p.sku === sku) || null;
}

function verifyPayment(sku, cycle, amountCents) {
  const fromBin = invokeBinary(['verify-payment', sku, cycle, Number(amountCents ?? -1)]);
  if (fromBin) return fromBin;

  const spec = getPlanSpec(sku);
  if (!spec) return { allowed: false, code: 'UNKNOWN_SKU', http_status: 404, message: 'Plan no reconocido.' };
  const expected = cycle === 'annual' ? spec.price_annual_cents : spec.price_monthly_cents;
  if (Number(amountCents) >= 0 && Number(amountCents) < expected) {
    return {
      allowed: false,
      code: 'PAYMENT_AMOUNT_TAMPERED',
      http_status: 402,
      message: `Monto recibido (${amountCents}¢) inferior al precio oficial F# (${expected}¢).`,
    };
  }
  return { allowed: true, code: `VERIFIED_${spec.sku}_${expected}`, http_status: 200, message: 'OK' };
}

function validateSeatInvite(sku, actorRole, targetRole, currentSeats) {
  const fromBin = invokeBinary(['validate-seat', sku, actorRole, targetRole, Number(currentSeats || 0)]);
  if (fromBin) return fromBin;

  const spec = getPlanSpec(sku);
  if (!spec) return { allowed: false, code: 'UNKNOWN_SKU', http_status: 402, message: 'Plan requerido.' };
  if (targetRole === 'owner') return { allowed: false, code: 'CANNOT_INVITE_OWNER', http_status: 400, message: 'No se puede invitar otro Owner.' };
  if (targetRole === 'admin' && actorRole !== 'owner') {
    return { allowed: false, code: 'OWNER_ONLY_ADMIN_GRANT', http_status: 403, message: 'Solo el Owner puede asignar el rol Admin.' };
  }
  if (!['owner', 'admin'].includes(actorRole)) {
    return { allowed: false, code: 'RBAC_FORBIDDEN', http_status: 403, message: 'Sin permiso para invitar miembros.' };
  }
  if (spec.max_seats > 0 && Number(currentSeats) >= spec.max_seats) {
    return {
      allowed: false,
      code: 'SEAT_LIMIT_REACHED',
      http_status: 402,
      message: `Alcanzaste el límite de ${spec.max_seats} asientos de tu plan (${spec.display_name}).`,
    };
  }
  return { allowed: true, code: 'SEAT_AVAILABLE', http_status: 200, message: 'OK' };
}

function validateCampaignCreation({
  sku,
  actorRole,
  ctaType,
  activeCampaignsCount,
  requestedImpressions,
  remainingPool,
  orgApprovalRequired,
}) {
  const fromBin = invokeBinary([
    'validate-campaign',
    sku,
    actorRole,
    ctaType,
    Number(activeCampaignsCount || 0),
    Number(requestedImpressions || 0),
    Number(remainingPool || 0),
    orgApprovalRequired ? 'true' : 'false',
  ]);
  if (fromBin) return fromBin;

  const spec = getPlanSpec(sku);
  if (!spec) return { allowed: false, code: 'PLAN_REQUIRED', http_status: 402, message: 'Plan Credo One requerido.' };
  if (!['owner', 'admin', 'editor'].includes(actorRole)) {
    return { allowed: false, code: 'RBAC_FORBIDDEN', http_status: 403, message: 'Tu rol no permite crear campañas.' };
  }
  if (ctaType === 'lead_form' && !spec.is_enterprise) {
    return { allowed: false, code: 'ENTERPRISE_REQUIRED', http_status: 403, message: 'Los Formularios de Leads Nativos in-app son exclusivos de Credo One Enterprise.' };
  }
  if (['offering', 'event_register'].includes(ctaType) && ['user_one_pro', 'biz_one_plus'].includes(spec.sku)) {
    return { allowed: false, code: 'UPGRADE_REQUIRED', http_status: 403, message: 'Los botones avanzados requieren Empresas One Pro o Enterprise.' };
  }
  if (spec.max_active_campaigns > 0 && Number(activeCampaignsCount) >= spec.max_active_campaigns) {
    return {
      allowed: false,
      code: 'CAMPAIGN_LIMIT_REACHED',
      http_status: 402,
      message: `Tu plan (${spec.display_name}) permite hasta ${spec.max_active_campaigns} campañas activas simultáneas.`,
    };
  }
  const maxCap = Number(remainingPool) > 0 ? Math.min(spec.monthly_impressions, Number(remainingPool)) : spec.monthly_impressions;
  const clamped = Math.max(500, Math.min(Number(requestedImpressions) || 5000, Math.max(500, maxCap)));
  const requiresApproval = actorRole === 'editor' && (spec.is_enterprise || Boolean(orgApprovalRequired));
  return {
    allowed: true,
    code: 'CAMPAIGN_OK',
    http_status: 200,
    message: 'OK',
    safe_allocated_impressions: clamped,
    requires_approval: requiresApproval,
  };
}

module.exports = {
  getKernelCatalog,
  getPlanSpec,
  verifyPayment,
  validateSeatInvite,
  validateCampaignCreation,
};
