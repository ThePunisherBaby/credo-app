const express = require('express');
const { pool } = require('../db/pool');
const {
  PAYPAL_MODE,
  PAYPAL_CLIENT_ID,
  ENTERPRISE_WHATSAPP_NUMBER,
} = require('../config');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');
const {
  ensureOrgForSubscription,
  reconcileUserEntitlements,
  pauseOrganizationCampaigns,
  writeAuditLog,
} = require('../middleware/rbac');
const {
  isPayPalConfigured,
  getPayPalStatusSnapshot,
  generateBrowserSafeClientToken,
  createOrderV2,
  getOrderV2,
  captureOrderV2,
  createSubscriptionV1,
  setupPayPalProductsAndPlans,
  ensureWebhookRegistered,
  bootstrapPayPalAutomation,
  getSubscriptionDetails,
  cancelPayPalSubscription,
  verifyWebhookSignature,
} = require('../services/paypal');
const { apiCache } = require('../utils/fastCache');
const fsharpKernel = require('../services/fsharpKernel');

const router = express.Router();

function resolveOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'credoapp.tech').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  if (host.includes('localhost') || host.startsWith('127.0.0.1')) {
    return `${proto}://${host}`;
  }
  return `https://${host}`;
}

async function activateCapturedOrder({
  user,
  kernelPlan,
  safeCycle,
  orderId,
  captureId,
  verifiedCents,
  organizationName = '',
  paymentMethodLabel = 'PayPal SDK v6',
  vaultTokenId = '',
  req = null,
}) {
  // Immutable F# 8 PricingKernel verification (blocks any tampered / underpaid amount)
  const fsharpVerdict = fsharpKernel.verifyPayment(kernelPlan.sku, safeCycle, verifiedCents);
  if (!fsharpVerdict.allowed) {
    const err = new Error(fsharpVerdict.message);
    err.httpStatus = fsharpVerdict.http_status || 402;
    err.code = fsharpVerdict.code;
    throw err;
  }

  // Idempotent check — return existing activation cleanly if already applied
  const dupCheck = await pool.query(
    `SELECT bt.id, bt.subscription_id
       FROM billing_transactions bt
      WHERE bt.paypal_event_id = $1
      LIMIT 1`,
    [`order-${orderId}`]
  );
  if (dupCheck.rows.length > 0) {
    const subExisting = await pool.query('SELECT * FROM subscriptions WHERE id = $1 LIMIT 1', [
      dupCheck.rows[0].subscription_id,
    ]);
    const entitlements = await reconcileUserEntitlements(user.id);
    return {
      subscription: subExisting.rows[0] || null,
      organization: null,
      entitlements,
      already_applied: true,
    };
  }

  let org = null;
  if (kernelPlan.studio_access || kernelPlan.audience === 'business') {
    org = await ensureOrgForSubscription(user, kernelPlan);
    if (organizationName && String(organizationName).trim()) {
      const upd = await pool.query(
        'UPDATE organizations SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
        [org.id, String(organizationName).trim().slice(0, 80)]
      );
      org = upd.rows[0] || org;
    }
  }

  const periodEnd = new Date(Date.now() + (safeCycle === 'annual' ? 365 : 30) * 86400 * 1000);
  const subKey = `ORD-${orderId}`;

  const { rows: subRows } = await pool.query(
    `INSERT INTO subscriptions (
       user_id, organization_id, plan_sku, billing_cycle,
       paypal_subscription_id, status, impressions_quota, impressions_used,
       current_period_start, current_period_end, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'active',$6,0,NOW(),$7,NOW())
     ON CONFLICT (paypal_subscription_id) DO UPDATE SET
       status = 'active',
       impressions_quota = EXCLUDED.impressions_quota,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = NOW()
     RETURNING *`,
    [
      user.id,
      org ? org.id : null,
      kernelPlan.sku,
      safeCycle,
      subKey,
      kernelPlan.monthly_impressions,
      periodEnd.toISOString(),
    ]
  );

  await pool.query(
    `INSERT INTO billing_transactions (
       subscription_id, user_id, organization_id, paypal_event_id,
       paypal_sale_id, plan_sku, amount_cents, currency, status, description
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','completed',$8)
     ON CONFLICT (paypal_event_id) DO NOTHING`,
    [
      subRows[0].id,
      user.id,
      org ? org.id : null,
      `order-${orderId}`,
      String(captureId || orderId),
      kernelPlan.sku,
      verifiedCents,
      `${paymentMethodLabel} · ${kernelPlan.display_name} (${safeCycle === 'annual' ? 'Anual' : 'Mensual'})`,
    ]
  );

  const entitlements = await reconcileUserEntitlements(user.id);
  if (org) {
    await writeAuditLog({
      organizationId: org.id,
      user,
      role: 'owner',
      action: 'billing.order_captured',
      resourceType: 'subscription',
      resourceId: String(subRows[0].id),
      details: {
        plan_sku: kernelPlan.sku,
        billing_cycle: safeCycle,
        order_id: orderId,
        capture_id: captureId,
        amount_cents: verifiedCents,
        payment_method: paymentMethodLabel,
        vault_token_saved: Boolean(vaultTokenId),
      },
      req,
    });
  }

  apiCache.invalidatePrefix('posts:');
  return {
    subscription: subRows[0],
    organization: org,
    entitlements,
    vault_token_saved: Boolean(vaultTokenId),
  };
}

// GET /api/v1/credo-one/plans — Dynamic F#-sealed catalog + PayPal SDK v6 bootstrap + user entitlement status
router.get('/plans', optionalAuth, async (req, res) => {
  try {
    const kernel = fsharpKernel.getKernelCatalog();
    const { rows: dbPlans } = await pool.query(
      `SELECT sku, paypal_plan_id_monthly, paypal_plan_id_annual FROM subscription_plans`
    );
    const ppMap = new Map(dbPlans.map((r) => [r.sku, r]));
    // Authoritative prices, quotas, and limits come directly from the immutable F# kernel
    const plans = kernel.plans.map((kp) => ({
      ...kp,
      paypal_plan_id_monthly: ppMap.get(kp.sku)?.paypal_plan_id_monthly || '',
      paypal_plan_id_annual: ppMap.get(kp.sku)?.paypal_plan_id_annual || '',
    }));

    let activeSubscriptions = [];
    if (req.user) {
      const subRes = await pool.query(
        `SELECT s.id, s.plan_sku, s.billing_cycle, s.status, s.organization_id,
                s.impressions_quota, s.impressions_used, s.current_period_end,
                p.display_name, p.audience
           FROM subscriptions s
           JOIN subscription_plans p ON p.sku = s.plan_sku
          WHERE s.user_id = $1 AND s.status IN ('active', 'pending')
          ORDER BY p.sort_order DESC`,
        [req.user.id]
      );
      activeSubscriptions = subRes.rows;
    }

    const hasSyncedPlans = plans
      .filter((p) => !p.is_enterprise)
      .every((p) => Boolean(p.paypal_plan_id_monthly && p.paypal_plan_id_annual));

    const ppSnap = getPayPalStatusSnapshot();

    return res.json({
      kernel: {
        engine: kernel.engine,
        integrity_seal: kernel.integrity_seal,
      },
      plans,
      paypal: {
        mode: ppSnap.mode,
        client_id: ppSnap.client_id,
        configured: ppSnap.configured,
        checkout_ready: ppSnap.configured,
        v6_ready: ppSnap.v6_ready,
        oauth_healthy: ppSnap.oauth_healthy,
        subscriptions_ready: Boolean(ppSnap.oauth_healthy && hasSyncedPlans),
        webhook_ready: ppSnap.webhook_ready,
        sdk_v6_url: ppSnap.sdk_v6_url,
      },
      enterprise_whatsapp: ENTERPRISE_WHATSAPP_NUMBER,
      active_subscriptions: activeSubscriptions,
    });
  } catch (err) {
    console.error('[credo-one/plans]', err);
    return res.status(500).json({ error: 'No se pudo cargar el catálogo Credo One' });
  }
});

// GET /api/v1/credo-one/paypal/client-token — Mints domain-bound browser-safe clientToken for PayPal Web SDK v6
router.get('/paypal/client-token', optionalAuth, async (req, res) => {
  const ppSnap = getPayPalStatusSnapshot();
  if (!PAYPAL_CLIENT_ID) {
    return res.status(200).json({
      sdk_version: 'none',
      v6_ready: false,
      mode: PAYPAL_MODE,
      client_id: '',
      client_token: null,
      reason: 'PAYPAL_CLIENT_ID no configurado en el servidor.',
    });
  }

  if (!isPayPalConfigured()) {
    return res.status(200).json({
      sdk_version: 'v5-fallback',
      v6_ready: false,
      mode: PAYPAL_MODE,
      client_id: PAYPAL_CLIENT_ID,
      client_token: null,
      sdk_v6_url: ppSnap.sdk_v6_url,
      reason: 'Awaiting matching Live PAYPAL_CLIENT_SECRET for SDK v6 clientToken.',
    });
  }

  try {
    const reqHost = String(req.headers['x-forwarded-host'] || req.hostname || 'credoapp.tech')
      .split(',')[0]
      .trim()
      .split(':')[0]
      .toLowerCase();
    const domains = ['credoapp.tech'];
    if (reqHost && reqHost !== 'credoapp.tech' && reqHost.includes('.')) {
      domains.push(reqHost);
    }

    const tokenRes = await generateBrowserSafeClientToken(domains);
    return res.status(200).json({
      sdk_version: 'v6',
      v6_ready: true,
      mode: PAYPAL_MODE,
      client_id: PAYPAL_CLIENT_ID,
      client_token: tokenRes.client_token,
      expires_in: tokenRes.expires_in,
      domains: tokenRes.domains,
      sdk_v6_url: ppSnap.sdk_v6_url,
      features: [
        'paypal-payments',
        'paypal-subscriptions',
        'paypal-guest-payments',
        'paypal-messages',
        'card-fields',
        'venmo-payments',
        'applepay-payments',
        'googlepay-payments',
        'vaulting',
      ],
    });
  } catch (err) {
    console.warn('[credo-one/paypal/client-token] Falling back to Smart Checkout:', err.message);
    return res.status(200).json({
      sdk_version: 'v5-fallback',
      v6_ready: false,
      mode: PAYPAL_MODE,
      client_id: PAYPAL_CLIENT_ID,
      client_token: null,
      sdk_v6_url: ppSnap.sdk_v6_url,
      reason: err.message,
    });
  }
});

// POST /api/v1/credo-one/paypal/orders — Creates authoritative server-side Orders v2 order for PayPal SDK v6
router.post('/paypal/orders', requireAuth, async (req, res) => {
  try {
    const {
      plan_sku,
      billing_cycle = 'monthly',
      vault = false,
      payment_source = 'paypal',
      organization_name = '',
    } = req.body || {};

    if (!plan_sku) {
      return res.status(400).json({ error: 'plan_sku es requerido' });
    }
    if (!isPayPalConfigured()) {
      return res.status(503).json({
        error: 'PAYPAL_REST_UNAVAILABLE',
        message: 'Las credenciales REST (PAYPAL_CLIENT_SECRET) aún no están configuradas.',
      });
    }

    const kernelPlan = fsharpKernel.getPlanSpec(plan_sku);
    if (!kernelPlan || kernelPlan.is_enterprise) {
      return res.status(404).json({ error: 'Plan Credo One no válido.' });
    }

    const safeCycle = billing_cycle === 'annual' ? 'annual' : 'monthly';
    const origin = resolveOrigin(req);
    const qs = new URLSearchParams({
      paypal_return: '1',
      plan_sku: kernelPlan.sku,
      billing_cycle: safeCycle,
      ...(organization_name ? { org_name: String(organization_name).slice(0, 80) } : {}),
    });

    const order = await createOrderV2({
      plan: kernelPlan,
      cycle: safeCycle,
      userId: req.user.id,
      returnUrl: `${origin}/?${qs.toString()}`,
      cancelUrl: `${origin}/?paypal_cancel=1&plan_sku=${encodeURIComponent(kernelPlan.sku)}`,
      vault: Boolean(vault),
      paymentSource: payment_source === 'card' ? 'card' : 'paypal',
    });

    const amountCents = safeCycle === 'annual' ? kernelPlan.price_annual_cents : kernelPlan.price_monthly_cents;
    return res.status(201).json({
      orderId: order.id,
      id: order.id,
      status: order.status,
      amount_cents: amountCents,
      amount_usd: (amountCents / 100).toFixed(2),
      links: order.links || [],
    });
  } catch (err) {
    console.error('[credo-one/paypal/orders]', err);
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo crear la orden de PayPal' });
  }
});

// POST /api/v1/credo-one/paypal/orders/:orderId/capture — Captures & verifies Orders v2 payment via F# 8 kernel
router.post('/paypal/orders/:orderId/capture', requireAuth, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const {
      plan_sku,
      billing_cycle = 'monthly',
      organization_name = '',
      payment_method = 'PayPal SDK v6',
    } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: 'orderId es requerido' });
    }
    if (!isPayPalConfigured()) {
      return res.status(503).json({ error: 'PAYPAL_REST_UNAVAILABLE' });
    }

    // Attempt capture (if already captured on redirect/retry, fetch order details cleanly)
    let orderData = null;
    try {
      orderData = await captureOrderV2(orderId);
    } catch (capErr) {
      const existingOrder = await getOrderV2(orderId).catch(() => null);
      if (existingOrder && String(existingOrder.status).toUpperCase() === 'COMPLETED') {
        orderData = existingOrder;
      } else {
        throw capErr;
      }
    }

    const pu = orderData?.purchase_units?.[0] || {};
    const cap = pu.payments?.captures?.[0] || null;
    const captureStatus = String(cap?.status || orderData?.status || '').toUpperCase();
    if (!['COMPLETED', 'APPROVED'].includes(captureStatus)) {
      return res.status(402).json({
        error: 'PAYMENT_NOT_COMPLETED',
        message: `El estado del cobro en PayPal es ${captureStatus || 'desconocido'}.`,
      });
    }

    // Resolve plan_sku & billing_cycle securely from custom_id first, then request body
    const customParts = String(pu.custom_id || cap?.custom_id || '').split(':');
    const resolvedSku = customParts[1] || plan_sku;
    const resolvedCycle = (customParts[2] || billing_cycle) === 'annual' ? 'annual' : 'monthly';

    const kernelPlan = fsharpKernel.getPlanSpec(resolvedSku);
    if (!kernelPlan || kernelPlan.is_enterprise) {
      return res.status(404).json({ error: 'Plan Credo One no encontrado para esta orden.' });
    }

    const capturedAmount = Number(cap?.amount?.value || pu.amount?.value || 0);
    const verifiedCents = Math.round(capturedAmount * 100);
    const vaultTokenId =
      orderData?.payment_source?.paypal?.attributes?.vault?.id ||
      orderData?.payment_source?.card?.attributes?.vault?.id ||
      '';

    const result = await activateCapturedOrder({
      user: req.user,
      kernelPlan,
      safeCycle: resolvedCycle,
      orderId,
      captureId: cap?.id || orderId,
      verifiedCents,
      organizationName: organization_name,
      paymentMethodLabel: String(payment_method || 'PayPal SDK v6').slice(0, 60),
      vaultTokenId,
      req,
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[credo-one/paypal/orders/capture]', err);
    return res.status(err.httpStatus || err.status || 500).json({
      error: err.code || 'CAPTURE_ERROR',
      message: err.message || 'No se pudo capturar el pago con PayPal',
    });
  }
});

// POST /api/v1/credo-one/paypal/subscriptions — Creates server-side Subscription v1 for SDK v6
router.post('/paypal/subscriptions', requireAuth, async (req, res) => {
  try {
    const {
      plan_sku,
      billing_cycle = 'monthly',
      organization_name = '',
    } = req.body || {};

    if (!plan_sku) {
      return res.status(400).json({ error: 'plan_sku es requerido' });
    }
    if (!isPayPalConfigured()) {
      return res.status(503).json({
        error: 'PAYPAL_REST_UNAVAILABLE',
        message: 'Las credenciales REST de PayPal no están configuradas.',
      });
    }

    const kernelPlan = fsharpKernel.getPlanSpec(plan_sku);
    if (!kernelPlan || kernelPlan.is_enterprise) {
      return res.status(404).json({ error: 'Plan Credo One no válido.' });
    }
    const safeCycle = billing_cycle === 'annual' ? 'annual' : 'monthly';

    let { rows } = await pool.query('SELECT * FROM subscription_plans WHERE sku = $1 LIMIT 1', [kernelPlan.sku]);
    let ppPlanId = safeCycle === 'annual' ? rows[0]?.paypal_plan_id_annual : rows[0]?.paypal_plan_id_monthly;

    if (!ppPlanId || !ppPlanId.startsWith('P-')) {
      await setupPayPalProductsAndPlans();
      const refreshed = await pool.query('SELECT * FROM subscription_plans WHERE sku = $1 LIMIT 1', [kernelPlan.sku]);
      rows = refreshed.rows;
      ppPlanId = safeCycle === 'annual' ? rows[0]?.paypal_plan_id_annual : rows[0]?.paypal_plan_id_monthly;
    }

    if (!ppPlanId) {
      return res.status(503).json({ error: 'No se pudo sincronizar el Billing Plan en PayPal.' });
    }

    const origin = resolveOrigin(req);
    const qs = new URLSearchParams({
      paypal_sub_return: '1',
      plan_sku: kernelPlan.sku,
      billing_cycle: safeCycle,
      ...(organization_name ? { org_name: String(organization_name).slice(0, 80) } : {}),
    });

    const sub = await createSubscriptionV1({
      paypalPlanId: ppPlanId,
      plan: kernelPlan,
      cycle: safeCycle,
      userId: req.user.id,
      userEmail: req.user.email || '',
      userName: req.user.full_name || '',
      returnUrl: `${origin}/?${qs.toString()}`,
      cancelUrl: `${origin}/?paypal_cancel=1&plan_sku=${encodeURIComponent(kernelPlan.sku)}`,
    });

    return res.status(201).json({
      subscriptionId: sub.id,
      id: sub.id,
      status: sub.status,
      links: sub.links || [],
    });
  } catch (err) {
    console.error('[credo-one/paypal/subscriptions]', err);
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo crear la suscripción en PayPal' });
  }
});

// POST /api/v1/credo-one/subscriptions/confirm — Verifies PayPal subscription against PayPal API & F# PricingKernel
router.post('/subscriptions/confirm', requireAuth, async (req, res) => {
  try {
    const {
      subscription_id,
      plan_sku,
      billing_cycle = 'monthly',
      organization_name = '',
    } = req.body || {};

    if (!subscription_id || !plan_sku) {
      return res.status(400).json({ error: 'subscription_id y plan_sku son requeridos' });
    }

    const kernelPlan = fsharpKernel.getPlanSpec(plan_sku);
    const { rows: planRows } = await pool.query(
      'SELECT * FROM subscription_plans WHERE sku = $1 AND is_enterprise = FALSE',
      [plan_sku]
    );
    if (!planRows[0] || !kernelPlan || kernelPlan.is_enterprise) {
      return res.status(404).json({ error: 'Plan Credo One no encontrado' });
    }
    const plan = { ...planRows[0], ...kernelPlan };
    const safeCycle = billing_cycle === 'annual' ? 'annual' : 'monthly';

    if (!isPayPalConfigured()) {
      return res.status(503).json({
        error: 'PAYPAL_NOT_CONFIGURED',
        message: 'Las credenciales REST de PayPal aún no están configuradas en el servidor.',
      });
    }

    const ppSub = await getSubscriptionDetails(subscription_id);
    const validStatuses = new Set(['ACTIVE', 'APPROVED']);
    if (!ppSub || !validStatuses.has(String(ppSub.status || '').toUpperCase())) {
      return res.status(402).json({
        error: 'SUBSCRIPTION_NOT_ACTIVE',
        message: `La suscripción de PayPal se encuentra en estado ${ppSub?.status || 'desconocido'}.`,
      });
    }

    const reportedVal = Number(ppSub.billing_info?.last_payment?.amount?.value ?? -1);
    const reportedCents = reportedVal >= 0 ? Math.round(reportedVal * 100) : -1;
    const fsharpVerdict = fsharpKernel.verifyPayment(plan.sku, safeCycle, reportedCents);
    if (!fsharpVerdict.allowed) {
      return res.status(fsharpVerdict.http_status || 402).json({
        error: fsharpVerdict.code,
        message: fsharpVerdict.message,
      });
    }

    const expectedPlanId =
      safeCycle === 'annual' ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
    if (expectedPlanId && ppSub.plan_id && ppSub.plan_id !== expectedPlanId) {
      return res.status(400).json({
        error: 'PLAN_MISMATCH',
        message: 'El plan aprobado en PayPal no coincide con el plan seleccionado.',
      });
    }

    let org = null;
    if (plan.studio_access || plan.audience === 'business') {
      org = await ensureOrgForSubscription(req.user, plan);
      if (organization_name && String(organization_name).trim()) {
        const cleanOrgName = String(organization_name).trim().slice(0, 80);
        const upd = await pool.query(
          'UPDATE organizations SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
          [org.id, cleanOrgName]
        );
        org = upd.rows[0] || org;
      }
    }

    const periodEnd = ppSub.billing_info?.next_billing_time
      ? new Date(ppSub.billing_info.next_billing_time)
      : new Date(Date.now() + (safeCycle === 'annual' ? 365 : 30) * 86400 * 1000);

    const { rows: subRows } = await pool.query(
      `INSERT INTO subscriptions (
         user_id, organization_id, plan_sku, billing_cycle,
         paypal_subscription_id, status, impressions_quota, impressions_used,
         current_period_start, current_period_end, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'active',$6,0,NOW(),$7,NOW())
       ON CONFLICT (paypal_subscription_id) DO UPDATE SET
         plan_sku = EXCLUDED.plan_sku,
         billing_cycle = EXCLUDED.billing_cycle,
         organization_id = COALESCE(EXCLUDED.organization_id, subscriptions.organization_id),
         status = 'active',
         impressions_quota = EXCLUDED.impressions_quota,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        org ? org.id : null,
        plan.sku,
        safeCycle,
        String(subscription_id),
        plan.monthly_impressions,
        periodEnd.toISOString(),
      ]
    );

    const amountCents = safeCycle === 'annual' ? plan.price_annual_cents : plan.price_monthly_cents;
    await pool.query(
      `INSERT INTO billing_transactions (
         subscription_id, user_id, organization_id, paypal_event_id,
         paypal_sale_id, plan_sku, amount_cents, currency, status, description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','completed',$8)
       ON CONFLICT (paypal_event_id) DO NOTHING`,
      [
        subRows[0].id,
        req.user.id,
        org ? org.id : null,
        `confirm-${subscription_id}`,
        String(subscription_id),
        plan.sku,
        amountCents,
        `Suscripción PayPal SDK v6 · ${plan.display_name} (${safeCycle === 'annual' ? 'Anual' : 'Mensual'})`,
      ]
    );

    const entitlements = await reconcileUserEntitlements(req.user.id);
    if (org) {
      await writeAuditLog({
        organizationId: org.id,
        user: req.user,
        role: 'owner',
        action: 'subscription.activated',
        resourceType: 'subscription',
        resourceId: String(subRows[0].id),
        details: { plan_sku: plan.sku, billing_cycle: safeCycle, paypal_subscription_id: subscription_id },
        req,
      });
    }

    apiCache.invalidatePrefix('posts:');
    return res.status(201).json({
      subscription: subRows[0],
      organization: org,
      entitlements,
    });
  } catch (err) {
    console.error('[credo-one/confirm]', err);
    return res.status(500).json({ error: err.message || 'No se pudo confirmar la suscripción' });
  }
});

// POST /api/v1/credo-one/orders/confirm — Confirms Smart Checkout live capture (Engine B fallback + REST double-check)
router.post('/orders/confirm', requireAuth, async (req, res) => {
  try {
    const {
      order_id,
      capture_id = '',
      plan_sku,
      billing_cycle = 'monthly',
      amount_value,
      status = '',
      organization_name = '',
    } = req.body || {};

    if (!order_id || !plan_sku) {
      return res.status(400).json({ error: 'order_id y plan_sku son requeridos' });
    }
    if (String(status).toUpperCase() !== 'COMPLETED') {
      return res.status(402).json({ error: 'El pago en PayPal no fue completado.' });
    }

    const kernelPlan = fsharpKernel.getPlanSpec(plan_sku);
    if (!kernelPlan || kernelPlan.is_enterprise) {
      return res.status(404).json({ error: 'Plan Credo One no válido.' });
    }

    const safeCycle = billing_cycle === 'annual' ? 'annual' : 'monthly';
    let verifiedCents = Math.round(Number(amount_value || 0) * 100);
    let verifiedCaptureId = String(capture_id || order_id);

    if (isPayPalConfigured()) {
      try {
        const ppOrder = await getOrderV2(order_id);
        if (!ppOrder || String(ppOrder.status).toUpperCase() !== 'COMPLETED') {
          return res.status(402).json({ error: 'La orden de PayPal no está en estado COMPLETED.' });
        }
        const cap = ppOrder.purchase_units?.[0]?.payments?.captures?.[0];
        if (cap?.amount?.value) {
          verifiedCents = Math.round(Number(cap.amount.value) * 100);
          verifiedCaptureId = cap.id || verifiedCaptureId;
        }
      } catch (ppErr) {
        console.warn('[credo-one/orders/confirm] PayPal REST lookup skipped:', ppErr.message);
      }
    }

    const result = await activateCapturedOrder({
      user: req.user,
      kernelPlan,
      safeCycle,
      orderId: order_id,
      captureId: verifiedCaptureId,
      verifiedCents,
      organizationName: organization_name,
      paymentMethodLabel: 'Pago PayPal Live',
      req,
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[credo-one/orders/confirm]', err);
    return res.status(err.httpStatus || 500).json({ error: err.message || 'No se pudo activar tu plan Credo One' });
  }
});

// POST /api/v1/credo-one/subscriptions/cancel — Cancels active renewal on PayPal & DB
router.post('/subscriptions/cancel', requireAuth, async (req, res) => {
  try {
    const { subscription_id, reason = 'Cancelado por el usuario desde Credo One Studio' } = req.body || {};
    const { rows } = await pool.query(
      `SELECT * FROM subscriptions
        WHERE user_id = $1 AND status = 'active'
          AND ($2::int IS NULL OR id = $2)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [req.user.id, subscription_id ? Number(subscription_id) : null]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'No tienes una suscripción activa para cancelar.' });
    }
    const sub = rows[0];

    if (sub.paypal_subscription_id && !sub.paypal_subscription_id.startsWith('ORD-') && isPayPalConfigured()) {
      await cancelPayPalSubscription(sub.paypal_subscription_id, String(reason).slice(0, 127));
    }

    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [sub.id]
    );
    if (sub.organization_id) {
      await pauseOrganizationCampaigns(sub.organization_id, 'user_cancelled');
      await writeAuditLog({
        organizationId: sub.organization_id,
        user: req.user,
        role: 'owner',
        action: 'subscription.cancelled',
        resourceType: 'subscription',
        resourceId: String(sub.id),
        details: { reason },
        req,
      });
    }
    const entitlements = await reconcileUserEntitlements(req.user.id);
    return res.json({ cancelled: true, entitlements });
  } catch (err) {
    console.error('[credo-one/cancel]', err);
    return res.status(500).json({ error: err.message || 'Error al cancelar la suscripción' });
  }
});

// POST /api/v1/credo-one/enterprise-leads — Executive Corporate Sales Inquiry
router.post('/enterprise-leads', optionalAuth, async (req, res) => {
  try {
    const {
      company_name,
      tax_id,
      contact_name,
      contact_role,
      corporate_email,
      whatsapp_phone,
      campaign_goal,
    } = req.body || {};

    const cleanCompany = String(company_name || '').trim();
    const cleanTax = String(tax_id || '').trim();
    const cleanName = String(contact_name || '').trim();
    const cleanRole = String(contact_role || '').trim();
    const cleanEmail = String(corporate_email || '').trim().toLowerCase();
    const cleanPhone = String(whatsapp_phone || '').trim();
    const cleanGoal = String(campaign_goal || '').trim();

    if (!cleanCompany || !cleanTax || !cleanName || !cleanRole || !cleanEmail || !cleanPhone || !cleanGoal) {
      return res.status(400).json({ error: 'Todos los campos ejecutivos son obligatorios.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Ingresa un correo corporativo válido.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO enterprise_leads (
         user_id, company_name, tax_id, contact_name, contact_role,
         corporate_email, whatsapp_phone, campaign_goal
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, company_name, created_at`,
      [
        req.user?.id || null,
        cleanCompany.slice(0, 140),
        cleanTax.slice(0, 60),
        cleanName.slice(0, 120),
        cleanRole.slice(0, 100),
        cleanEmail.slice(0, 140),
        cleanPhone.slice(0, 40),
        cleanGoal.slice(0, 1000),
      ]
    );

    const waText = [
      `Hola equipo de Ventas Corporativas Credo One Enterprise (#${rows[0].id})`,
      `• Empresa/Institución: ${cleanCompany}`,
      `• RNC / ID Fiscal: ${cleanTax}`,
      `• Contacto: ${cleanName} (${cleanRole})`,
      `• Correo: ${cleanEmail}`,
      `• Objetivo: ${cleanGoal}`,
      'Deseo coordinar activación corporativa vía transferencia con factura fiscal.',
    ].join('\n');

    const whatsappUrl = `https://wa.me/${ENTERPRISE_WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`;

    return res.status(201).json({
      lead: rows[0],
      whatsapp_url: whatsappUrl,
    });
  } catch (err) {
    console.error('[credo-one/enterprise-leads]', err);
    return res.status(500).json({ error: 'No se pudo registrar la solicitud Enterprise' });
  }
});

// POST /api/v1/credo-one/admin/sync-paypal — Admin trigger for full idempotent catalog + plans + webhook provisioning
router.post('/admin/sync-paypal', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await bootstrapPayPalAutomation();
    if (!result.ok) {
      return res.status(503).json({ synced: false, ...result });
    }
    const webhook = await ensureWebhookRegistered('https://credoapp.tech/api/webhooks/paypal').catch((e) => ({
      error: e.message,
    }));
    return res.json({ synced: true, summary: result.plans, webhook });
  } catch (err) {
    console.error('[credo-one/sync-paypal]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// SECURE PAYPAL WEBHOOK HANDLER (/api/webhooks/paypal)
// ============================================================================
async function handlePayPalWebhook(req, res) {
  try {
    const event = req.body;
    if (!event || !event.event_type) {
      return res.status(400).json({ error: 'Invalid PayPal webhook payload' });
    }

    const verification = await verifyWebhookSignature(req.headers, event);
    if (!verification.verified) {
      console.warn('[paypal-webhook] Signature rejected:', verification.reason || verification.status);
      return res.status(401).json({ error: 'Invalid PayPal webhook signature' });
    }

    const eventId = String(event.id || '');
    const eventType = String(event.event_type || '');
    const resource = event.resource || {};

    // Handle Orders v2 capture/refund events cleanly
    if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      const captureId = String(resource.id || '');
      const txRes = await pool.query(
        `SELECT subscription_id, user_id, organization_id
           FROM billing_transactions
          WHERE paypal_sale_id = $1
          LIMIT 1`,
        [captureId]
      );
      if (txRes.rows[0]) {
        await pool.query(`UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [
          txRes.rows[0].subscription_id,
        ]);
        if (txRes.rows[0].organization_id) {
          await pauseOrganizationCampaigns(txRes.rows[0].organization_id, 'payment_refunded');
        }
        await reconcileUserEntitlements(txRes.rows[0].user_id);
        apiCache.invalidatePrefix('posts:');
      }
      return res.status(200).json({ received: true, event_type: eventType });
    }

    const paypalSubId = resource.billing_agreement_id || resource.id || '';
    if (!paypalSubId) {
      return res.status(200).json({ received: true, ignored: 'missing_subscription_id' });
    }

    const { rows: subRows } = await pool.query(
      `SELECT s.*, p.monthly_impressions, p.display_name, p.sku
         FROM subscriptions s
         JOIN subscription_plans p ON p.sku = s.plan_sku
        WHERE s.paypal_subscription_id = $1
        LIMIT 1`,
      [paypalSubId]
    );

    if (!subRows[0]) {
      console.warn(`[paypal-webhook] Unmatched subscription ${paypalSubId} for ${eventType}`);
      return res.status(200).json({ received: true, unmatched: true });
    }
    const sub = subRows[0];

    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' || eventType === 'BILLING.SUBSCRIPTION.UPDATED') {
      const nextBilling = resource.billing_info?.next_billing_time
        ? new Date(resource.billing_info.next_billing_time)
        : new Date(Date.now() + 30 * 86400 * 1000);
      await pool.query(
        `UPDATE subscriptions
            SET status = 'active',
                impressions_quota = $2,
                current_period_end = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [sub.id, sub.monthly_impressions, nextBilling.toISOString()]
      );
      await reconcileUserEntitlements(sub.user_id);
      if (sub.organization_id) {
        await writeAuditLog({
          organizationId: sub.organization_id,
          role: 'system',
          action: `webhook.${eventType.toLowerCase()}`,
          resourceType: 'subscription',
          resourceId: String(sub.id),
          details: { event_id: eventId, paypal_subscription_id: paypalSubId },
        });
      }
    } else if (eventType === 'PAYMENT.SALE.COMPLETED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const amountVal = Number(resource.amount?.total || resource.amount?.value || 0);
      const amountCents = Math.round(amountVal * 100);
      const currency = String(resource.amount?.currency || resource.amount?.currency_code || 'USD');

      const txInsert = await pool.query(
        `INSERT INTO billing_transactions (
           subscription_id, user_id, organization_id, paypal_event_id,
           paypal_sale_id, plan_sku, amount_cents, currency, status, description, raw_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10::jsonb)
         ON CONFLICT (paypal_event_id) DO NOTHING
         RETURNING id`,
        [
          sub.id,
          sub.user_id,
          sub.organization_id,
          eventId || `sale-${resource.id || Date.now()}`,
          String(resource.id || ''),
          sub.plan_sku,
          amountCents,
          currency,
          `Renovación automática ${sub.display_name}`,
          JSON.stringify(event),
        ]
      );

      if (txInsert.rows.length > 0) {
        const nextPeriodEnd = new Date(
          Date.now() + (sub.billing_cycle === 'annual' ? 365 : 30) * 86400 * 1000
        );
        await pool.query(
          `UPDATE subscriptions
              SET status = 'active',
                  impressions_quota = $2,
                  impressions_used = 0,
                  current_period_start = NOW(),
                  current_period_end = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [sub.id, sub.monthly_impressions, nextPeriodEnd.toISOString()]
        );
        await reconcileUserEntitlements(sub.user_id);
        if (sub.organization_id) {
          await writeAuditLog({
            organizationId: sub.organization_id,
            role: 'system',
            action: 'billing.payment_completed',
            resourceType: 'subscription',
            resourceId: String(sub.id),
            details: {
              event_id: eventId,
              amount_cents: amountCents,
              impressions_credited: sub.monthly_impressions,
            },
          });
        }
      }
    } else if (
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED' ||
      eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
    ) {
      const nextStatus =
        eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
          ? 'suspended'
          : eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
            ? 'expired'
            : 'cancelled';

      await pool.query(
        `UPDATE subscriptions SET status = $2, updated_at = NOW() WHERE id = $1`,
        [sub.id, nextStatus]
      );
      if (sub.organization_id) {
        await pauseOrganizationCampaigns(sub.organization_id, nextStatus);
      }
      await reconcileUserEntitlements(sub.user_id);
      apiCache.invalidatePrefix('posts:');
    }

    return res.status(200).json({ received: true, event_type: eventType });
  } catch (err) {
    console.error('[paypal-webhook] Error:', err);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}

module.exports = router;
module.exports.handlePayPalWebhook = handlePayPalWebhook;
