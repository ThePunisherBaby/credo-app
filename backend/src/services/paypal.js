const crypto = require('crypto');
const {
  PAYPAL_MODE,
  PAYPAL_API_BASE,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
} = require('../config');
const { pool } = require('../db/pool');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function isPayPalConfigured() {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

async function getAccessToken({ forceRefresh = false } = {}) {
  if (!isPayPalConfigured()) {
    throw new Error('PayPal credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are not configured.');
  }
  if (!forceRefresh && cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PayPal OAuth2 failed (${res.status}): ${txt.slice(0, 240)}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function paypalRequest(method, apiPath, body = null, { requestId = null } = {}) {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (requestId) {
    headers['PayPal-Request-Id'] = requestId;
  }

  const res = await fetch(`${PAYPAL_API_BASE}${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const msg = parsed?.message || parsed?.error_description || text.slice(0, 240);
    const err = new Error(`PayPal ${method} ${apiPath} failed (${res.status}): ${msg}`);
    err.status = res.status;
    err.payload = parsed;
    throw err;
  }
  return parsed;
}

/**
 * Idempotently verifies or creates the 4 payable Credo One products and 8 billing plans
 * (Monthly + Annual for user_one_plus, user_one_pro, biz_one_plus, biz_one_pro)
 * and persists their paypal_product_id and paypal_plan_id_* into subscription_plans.
 */
async function setupPayPalProductsAndPlans() {
  const { rows: plans } = await pool.query(
    `SELECT * FROM subscription_plans WHERE is_enterprise = FALSE ORDER BY sort_order ASC`
  );

  // List existing products & plans first for strict idempotency
  const existingProductsRes = await paypalRequest('GET', '/v1/catalogs/products?page_size=20&page=1').catch(() => ({
    products: [],
  }));
  const existingProducts = existingProductsRes?.products || [];

  const existingPlansRes = await paypalRequest('GET', '/v1/billing/plans?page_size=20&page=1&total_required=true').catch(
    () => ({ plans: [] })
  );
  const existingPlans = existingPlansRes?.plans || [];

  const summary = [];

  for (const plan of plans) {
    const productCode = `CREDO_ONE_${plan.sku.toUpperCase()}`;
    const productName = `${plan.display_name} (${plan.audience === 'business' ? 'Empresas' : 'User'})`;

    let productId = plan.paypal_product_id;
    if (!productId) {
      const foundProd = existingProducts.find(
        (pr) => pr.id === productCode || pr.name === productName
      );
      if (foundProd) {
        productId = foundProd.id;
      } else {
        const created = await paypalRequest(
          'POST',
          '/v1/catalogs/products',
          {
            id: productCode,
            name: productName,
            description: plan.subtitle.slice(0, 127),
            type: 'SERVICE',
            category: 'SOFTWARE',
          },
          { requestId: `prod-${plan.sku}-${PAYPAL_MODE}` }
        );
        productId = created.id;
      }
    }

    const ensureBillingPlan = async (cycle, existingId, cents) => {
      if (existingId && existingId.startsWith('P-')) {
        return existingId;
      }
      const cycleLabel = cycle === 'annual' ? 'Anual' : 'Mensual';
      const targetName = `${productName} - ${cycleLabel}`;
      const foundPlan = existingPlans.find(
        (pl) => pl.product_id === productId && pl.name === targetName && pl.status === 'ACTIVE'
      );
      if (foundPlan) return foundPlan.id;

      const intervalUnit = cycle === 'annual' ? 'YEAR' : 'MONTH';
      const valueStr = (cents / 100).toFixed(2);
      const createdPlan = await paypalRequest(
        'POST',
        '/v1/billing/plans',
        {
          product_id: productId,
          name: targetName,
          description: `${plan.display_name} (${cycleLabel}) — SKU ${plan.sku}`,
          status: 'ACTIVE',
          billing_cycles: [
            {
              frequency: {
                interval_unit: intervalUnit,
                interval_count: 1,
              },
              tenure_type: 'REGULAR',
              sequence: 1,
              total_cycles: 0,
              pricing_scheme: {
                fixed_price: {
                  value: valueStr,
                  currency_code: 'USD',
                },
              },
            },
          ],
          payment_preferences: {
            auto_bill_outstanding: true,
            setup_fee_failure_action: 'CONTINUE',
            payment_failure_threshold: 2,
          },
        },
        { requestId: `plan-${plan.sku}-${cycle}-${PAYPAL_MODE}` }
      );
      return createdPlan.id;
    };

    const monthlyId = await ensureBillingPlan('monthly', plan.paypal_plan_id_monthly, plan.price_monthly_cents);
    const annualId = await ensureBillingPlan('annual', plan.paypal_plan_id_annual, plan.price_annual_cents);

    await pool.query(
      `UPDATE subscription_plans
          SET paypal_product_id = $2,
              paypal_plan_id_monthly = $3,
              paypal_plan_id_annual = $4,
              updated_at = NOW()
        WHERE sku = $1`,
      [plan.sku, productId, monthlyId, annualId]
    );

    summary.push({
      sku: plan.sku,
      product_id: productId,
      monthly_plan_id: monthlyId,
      annual_plan_id: annualId,
    });
  }

  return summary;
}

async function getSubscriptionDetails(subscriptionId) {
  return paypalRequest('GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function cancelPayPalSubscription(subscriptionId, reason = 'Cancelado por el usuario desde Credo One Studio') {
  return paypalRequest('POST', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    reason,
  });
}

async function verifyWebhookSignature(headers, webhookEventBody) {
  if (!isPayPalConfigured() || !PAYPAL_WEBHOOK_ID) {
    return { verified: false, reason: 'PAYPAL_WEBHOOK_ID or PayPal API credentials not configured' };
  }

  const transmissionId = headers['paypal-transmission-id'];
  const transmissionTime = headers['paypal-transmission-time'];
  const certUrl = headers['paypal-cert-url'];
  const authAlgo = headers['paypal-auth-algo'];
  const transmissionSig = headers['paypal-transmission-sig'];

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { verified: false, reason: 'Missing required PayPal signature headers' };
  }

  const verifyPayload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: webhookEventBody,
  };

  const result = await paypalRequest('POST', '/v1/notifications/verify-webhook-signature', verifyPayload, {
    requestId: `verify-${crypto.randomUUID()}`,
  });

  return {
    verified: result?.verification_status === 'SUCCESS',
    status: result?.verification_status || 'FAILURE',
  };
}

module.exports = {
  isPayPalConfigured,
  getAccessToken,
  paypalRequest,
  setupPayPalProductsAndPlans,
  getSubscriptionDetails,
  cancelPayPalSubscription,
  verifyWebhookSignature,
};
