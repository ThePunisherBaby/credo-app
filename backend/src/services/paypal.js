const crypto = require('crypto');
const {
  PAYPAL_MODE,
  PAYPAL_API_BASE,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
} = require('../config');
const { pool } = require('../db/pool');

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

// Browser-safe SDK v6 clientToken cache keyed by sorted domain CSV
const clientTokenCache = new Map();

// Runtime health & auto-provisioned webhook state
let oauthHealthy = null; // null = untested, true = valid live/sandbox pair, false = auth failed
let lastOAuthError = '';
let resolvedWebhookId = PAYPAL_WEBHOOK_ID || '';
let detectedClientEnv = ''; // 'live' | 'sandbox' | ''
let detectedMerchantId = '';

const PAYPAL_WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'VAULT.PAYMENT-TOKEN.CREATED',
];

function isPayPalConfigured() {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

async function probeClientIdEnvironment() {
  if (!PAYPAL_CLIENT_ID) return '';
  try {
    const qs = `clientID=${encodeURIComponent(PAYPAL_CLIENT_ID)}&currency=USD&intent=capture&commit=true&vault=false&components=buttons`;
    const liveRes = await fetch(`https://www.paypal.com/smart/buttons?${qs}`);
    if (liveRes.ok) {
      const html = await liveRes.text().catch(() => '');
      const m = html.match(/"merchantID"\s*:\s*\["([A-Z0-9]+)"\]/);
      detectedClientEnv = 'live';
      detectedMerchantId = m ? m[1] : '';
      return 'live';
    }
    const sbRes = await fetch(`https://www.sandbox.paypal.com/smart/buttons?${qs}`);
    if (sbRes.ok) {
      const html = await sbRes.text().catch(() => '');
      const m = html.match(/"merchantID"\s*:\s*\["([A-Z0-9]+)"\]/);
      detectedClientEnv = 'sandbox';
      detectedMerchantId = m ? m[1] : '';
      return 'sandbox';
    }
  } catch {}
  return '';
}

function getPayPalSdkCoreUrl() {
  const eff = detectedClientEnv || PAYPAL_MODE;
  return eff === 'live'
    ? 'https://www.paypal.com/web-sdk/v6/core'
    : 'https://www.sandbox.paypal.com/web-sdk/v6/core';
}

function getPayPalStatusSnapshot() {
  const effectiveEnv = detectedClientEnv || PAYPAL_MODE;
  return {
    mode: PAYPAL_MODE,
    effective_env: effectiveEnv,
    env_mismatch: Boolean(detectedClientEnv && detectedClientEnv !== PAYPAL_MODE),
    merchant_id: detectedMerchantId || '',
    client_id: PAYPAL_CLIENT_ID || '',
    configured: Boolean(PAYPAL_CLIENT_ID),
    rest_configured: isPayPalConfigured(),
    oauth_healthy: oauthHealthy === true,
    v6_ready: Boolean(isPayPalConfigured() && oauthHealthy !== false),
    webhook_ready: Boolean(resolvedWebhookId || PAYPAL_WEBHOOK_ID),
    webhook_id: resolvedWebhookId || PAYPAL_WEBHOOK_ID || '',
    sdk_v6_url: getPayPalSdkCoreUrl(),
    last_oauth_error: oauthHealthy === false ? lastOAuthError : '',
  };
}

async function getAccessToken({ forceRefresh = false } = {}) {
  if (!isPayPalConfigured()) {
    oauthHealthy = false;
    lastOAuthError = 'PAYPAL_CLIENT_SECRET no configurado en el servidor.';
    throw new Error(lastOAuthError);
  }
  if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    oauthHealthy = true;
    return cachedAccessToken;
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
    oauthHealthy = false;
    lastOAuthError = `PayPal OAuth2 (${res.status}): ${txt.slice(0, 220)}`;
    throw new Error(lastOAuthError);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  oauthHealthy = true;
  lastOAuthError = '';
  return cachedAccessToken;
}

/**
 * Generates a short-lived, domain-bound browser-safe clientToken for PayPal Web SDK v6
 * (POST /v1/oauth2/token with grant_type=client_credentials&response_type=client_token&intent=sdk_init).
 */
async function generateBrowserSafeClientToken(domains = ['credoapp.tech']) {
  if (!isPayPalConfigured()) {
    oauthHealthy = false;
    lastOAuthError = 'PAYPAL_CLIENT_SECRET no configurado.';
    throw new Error(lastOAuthError);
  }

  const cleanDomains = Array.from(
    new Set(
      (Array.isArray(domains) ? domains : [domains])
        .map((d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0])
        .filter((d) => d && d !== 'localhost' && d !== '127.0.0.1' && d.includes('.'))
    )
  ).sort();

  const cacheKey = `${PAYPAL_MODE}:${cleanDomains.join(',') || 'default'}`;
  const cached = clientTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 90_000) {
    return {
      client_token: cached.token,
      expires_in: Math.max(60, Math.floor((cached.expiresAt - Date.now()) / 1000)),
      domains: cleanDomains,
    };
  }

  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    response_type: 'client_token',
    intent: 'sdk_init',
  });
  for (const dom of cleanDomains) {
    params.append('domains[]', dom);
  }

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    oauthHealthy = false;
    lastOAuthError = `PayPal SDK v6 clientToken (${res.status}): ${txt.slice(0, 220)}`;
    throw new Error(lastOAuthError);
  }

  const data = await res.json();
  const token = data.access_token || data.client_token;
  if (!token) {
    throw new Error('PayPal no devolvió access_token al solicitar client_token');
  }
  const expiresIn = Number(data.expires_in || 900);
  const expiresAt = Date.now() + expiresIn * 1000;
  clientTokenCache.set(cacheKey, { token, expiresAt });
  oauthHealthy = true;
  lastOAuthError = '';

  return {
    client_token: token,
    expires_in: expiresIn,
    domains: cleanDomains,
  };
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
    const detail = parsed?.details?.[0]?.description || parsed?.message || parsed?.error_description || text.slice(0, 240);
    const err = new Error(`PayPal ${method} ${apiPath} (${res.status}): ${detail}`);
    err.status = res.status;
    err.payload = parsed;
    throw err;
  }
  return parsed;
}

/**
 * Creates a server-side PayPal Orders v2 order using the exact F# 8 PricingKernel amount.
 * Supports PayPal Wallet, Pay Later, Venmo, Guest Card, PCI Card Fields, Apple Pay, Google Pay,
 * Redirect presentation return URLs, and optional PayPal Vaulting for 1-click returning buyers.
 */
async function createOrderV2({
  plan,
  cycle = 'monthly',
  userId,
  returnUrl = 'https://credoapp.tech/?paypal_return=1',
  cancelUrl = 'https://credoapp.tech/?paypal_cancel=1',
  vault = false,
  paymentSource = 'paypal',
  requestId = null,
}) {
  const isAnnual = cycle === 'annual';
  const cents = isAnnual ? plan.price_annual_cents : plan.price_monthly_cents;
  const valueStr = (Number(cents) / 100).toFixed(2);
  const cycleLabel = isAnnual ? 'Anual' : 'Mensual';
  const customId = `${userId || 0}:${plan.sku}:${isAnnual ? 'annual' : 'monthly'}`;

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: plan.sku,
        custom_id: customId,
        description: `${plan.display_name} (${cycleLabel}) · Credo One`,
        amount: {
          currency_code: 'USD',
          value: valueStr,
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: valueStr,
            },
          },
        },
        items: [
          {
            name: `${plan.display_name} (${cycleLabel})`,
            sku: plan.sku,
            quantity: '1',
            category: 'DIGITAL_GOODS',
            unit_amount: {
              currency_code: 'USD',
              value: valueStr,
            },
          },
        ],
      },
    ],
  };

  if (paymentSource === 'paypal') {
    payload.payment_source = {
      paypal: {
        experience_context: {
          brand_name: 'Credo One',
          locale: 'es-DO',
          landing_page: 'LOGIN',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    };
    if (vault) {
      payload.payment_source.paypal.attributes = {
        vault: {
          store_in_vault: 'ON_SUCCESS',
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
        },
      };
    }
  } else if (paymentSource === 'card') {
    payload.payment_source = {
      card: {
        attributes: {
          verification: {
            method: 'SCA_WHEN_REQUIRED',
          },
          ...(vault
            ? {
                vault: {
                  store_in_vault: 'ON_SUCCESS',
                },
              }
            : {}),
        },
      },
    };
  }

  try {
    return await paypalRequest('POST', '/v2/checkout/orders', payload, {
      requestId: requestId || `ord-${userId || 0}-${plan.sku}-${crypto.randomUUID().slice(0, 12)}`,
    });
  } catch (err) {
    if (vault && (err.status === 422 || /vault/i.test(err.message || ''))) {
      return createOrderV2({
        plan,
        cycle,
        userId,
        returnUrl,
        cancelUrl,
        vault: false,
        paymentSource,
        requestId: null,
      });
    }
    throw err;
  }
}

async function getOrderV2(orderId) {
  return paypalRequest('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

async function captureOrderV2(orderId, { requestId = null } = {}) {
  return paypalRequest(
    'POST',
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {},
    { requestId: requestId || `cap-${orderId}` }
  );
}

/**
 * Creates a server-side PayPal Subscription v1 for SDK v6 createPayPalSubscriptionPaymentSession.
 */
async function createSubscriptionV1({
  paypalPlanId,
  plan,
  cycle = 'monthly',
  userId,
  userName = '',
  returnUrl = 'https://credoapp.tech/?paypal_sub_return=1',
  cancelUrl = 'https://credoapp.tech/?paypal_cancel=1',
}) {
  const safeCycle = cycle === 'annual' ? 'annual' : 'monthly';
  const payload = {
    plan_id: paypalPlanId,
    custom_id: `${userId || 0}:${plan.sku}:${safeCycle}`,
    application_context: {
      brand_name: 'Credo One',
      locale: 'es-DO',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      payment_method: {
        payer_selected: 'PAYPAL',
        payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
      },
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };

  const parts = String(userName || '').trim().split(/\s+/).filter(Boolean);
  if (parts[0]) {
    payload.subscriber = {
      name: {
        given_name: parts[0].slice(0, 140),
        surname: (parts.slice(1).join(' ') || 'Credo').slice(0, 140),
      },
    };
  }

  return paypalRequest('POST', '/v1/billing/subscriptions', payload, {
    requestId: `sub-${userId || 0}-${plan.sku}-${crypto.randomUUID().slice(0, 12)}`,
  });
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

/**
 * Idempotently ensures the Credo One PayPal Webhook is registered on PayPal REST API
 * for all subscription, capture, refund, and vault events.
 */
async function ensureWebhookRegistered(webhookUrl = 'https://credoapp.tech/api/webhooks/paypal') {
  const listRes = await paypalRequest('GET', '/v1/notifications/webhooks').catch(() => ({ webhooks: [] }));
  const webhooks = listRes?.webhooks || [];
  const existing = webhooks.find((w) => String(w.url || '').replace(/\/+$/, '') === webhookUrl.replace(/\/+$/, ''));

  if (existing?.id) {
    resolvedWebhookId = existing.id;
    return { webhook_id: existing.id, url: existing.url, created: false };
  }

  const created = await paypalRequest(
    'POST',
    '/v1/notifications/webhooks',
    {
      url: webhookUrl,
      event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })),
    },
    { requestId: `wh-credo-one-${PAYPAL_MODE}` }
  );

  if (created?.id) {
    resolvedWebhookId = created.id;
  }
  return { webhook_id: created?.id || '', url: webhookUrl, created: true };
}

/**
 * Auto-runs on server startup whenever PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET are configured.
 * Verifies OAuth2 credentials, provisions all 4 products + 8 plans, and registers the live webhook.
 */
async function bootstrapPayPalAutomation() {
  const probedEnv = await probeClientIdEnvironment();
  if (!isPayPalConfigured()) {
    oauthHealthy = false;
    lastOAuthError = 'PAYPAL_CLIENT_SECRET no configurado (modo v5 Smart Checkout activo).';
    console.log(
      `[paypal] Mode=${PAYPAL_MODE} · EffectiveEnv=${probedEnv || PAYPAL_MODE} · Merchant=${detectedMerchantId || 'n/a'} · ClientID=${PAYPAL_CLIENT_ID ? 'set' : 'missing'} · Secret=missing`
    );
    return { ok: false, reason: 'missing_secret', effective_env: probedEnv || PAYPAL_MODE };
  }

  try {
    await getAccessToken({ forceRefresh: true });
    const plansSummary = await setupPayPalProductsAndPlans();
    const webhookRes = await ensureWebhookRegistered('https://credoapp.tech/api/webhooks/paypal').catch((e) => ({
      error: e.message,
    }));
    console.log(
      `[paypal] SDK v6 READY (${PAYPAL_MODE}) · ${plansSummary.length} products / ${plansSummary.length * 2} plans synced · webhook=${webhookRes.webhook_id || webhookRes.error || 'n/a'}`
    );
    return { ok: true, plans: plansSummary, webhook: webhookRes };
  } catch (err) {
    oauthHealthy = false;
    lastOAuthError = err.message;
    console.warn(`[paypal] Automation deferred (${PAYPAL_MODE}): ${err.message}`);
    return { ok: false, error: err.message };
  }
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
  const effectiveWebhookId = PAYPAL_WEBHOOK_ID || resolvedWebhookId;
  if (!isPayPalConfigured() || !effectiveWebhookId) {
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
    webhook_id: effectiveWebhookId,
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
  getPayPalSdkCoreUrl,
  getPayPalStatusSnapshot,
  getAccessToken,
  generateBrowserSafeClientToken,
  paypalRequest,
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
};
