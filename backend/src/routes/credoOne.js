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
  setupPayPalProductsAndPlans,
  getSubscriptionDetails,
  cancelPayPalSubscription,
  verifyWebhookSignature,
} = require('../services/paypal');
const { apiCache } = require('../utils/fastCache');
const fsharpKernel = require('../services/fsharpKernel');

const router = express.Router();

// GET /api/v1/credo-one/plans — Dynamic F#-sealed catalog + PayPal SDK bootstrap + user entitlement status
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

    return res.json({
      kernel: {
        engine: kernel.engine,
        integrity_seal: kernel.integrity_seal,
      },
      plans,
      paypal: {
        mode: PAYPAL_MODE,
        client_id: PAYPAL_CLIENT_ID || '',
        configured: isPayPalConfigured(),
      },
      enterprise_whatsapp: ENTERPRISE_WHATSAPP_NUMBER,
      active_subscriptions: activeSubscriptions,
    });
  } catch (err) {
    console.error('[credo-one/plans]', err);
    return res.status(500).json({ error: 'No se pudo cargar el catálogo Credo One' });
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

    // Cryptographically confirm status directly from PayPal REST API
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
        `Activación ${plan.display_name} (${safeCycle === 'annual' ? 'Anual' : 'Mensual'})`,
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

    if (sub.paypal_subscription_id && isPayPalConfigured()) {
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

// POST /api/v1/credo-one/admin/sync-paypal — Admin trigger for idempotent product/plan provisioning
router.post('/admin/sync-paypal', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const summary = await setupPayPalProductsAndPlans();
    return res.json({ synced: true, summary });
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
    } else if (eventType === 'PAYMENT.SALE.COMPLETED') {
      const amountVal = Number(resource.amount?.total || resource.amount?.value || 0);
      const amountCents = Math.round(amountVal * 100);
      const currency = String(resource.amount?.currency || resource.amount?.currency_code || 'USD');

      // Idempotency guard via unique paypal_event_id
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
        // Credit & reset monthly impression pool on each successful recurring charge
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
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      const nextStatus =
        eventType === 'BILLING.SUBSCRIPTION.SUSPENDED'
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
