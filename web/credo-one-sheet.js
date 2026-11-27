// credo-one-sheet.js — Global Interactive Bottom Sheet "Familia Credo One"
// PayPal Web SDK v6 Core (6.72.6+) Full Repertoire:
//   <paypal-button>, <paypal-pay-later-button>, <paypal-credit-button>, <paypal-basic-card-button>,
//   <venmo-button>, <paypal-message>, PCI-DSS Card Fields (3DS/SCA), Subscriptions v6, Apple/Google Pay,
//   Vaulting 1-click, Presentation Mode Cascade (payment-handler -> popup -> modal -> redirect) & Return Resume,
//   plus seamless non-top-layer Live Smart Checkout fallback when server secret is awaiting pairing.

import { attachDismissableSheet, attachSegSpringPills } from './springs.mjs?v=23';

// Zero critical prices or quotas hardcoded on the client:
// All plan prices, quotas, and limits are served exclusively from the compiled F# 8 kernel via /api/v1/credo-one/plans.
const INITIAL_PLANS = [];
const PENDING_RETURN_KEY = 'credo_pp_pending_v6';

let v6CorePromise = null;
let v6CoreLoadedUrl = '';
const v5SdkPromises = {};

function isEmbeddedWebView() {
  const ua = navigator.userAgent || '';
  return /CredoAndroid|; wv\)|\bFBAN\b|\bFBAV\b|\bInstagram\b/i.test(ua);
}

function getPresentationCascade() {
  // In Android WebView / in-app webviews skip Web Payment Handler API so popup/modal/redirect fires immediately
  if (isEmbeddedWebView()) {
    return ['popup', 'modal', 'redirect'];
  }
  return ['auto', 'popup', 'modal', 'redirect'];
}

function loadPayPalSdkV6Core(coreUrl = 'https://www.paypal.com/web-sdk/v6/core') {
  if (window.paypal?.createInstance && v6CoreLoadedUrl === coreUrl) {
    return Promise.resolve(window.paypal);
  }
  if (v6CorePromise && v6CoreLoadedUrl === coreUrl) {
    return v6CorePromise;
  }
  v6CoreLoadedUrl = coreUrl;
  v6CorePromise = new Promise((resolve, reject) => {
    // Only remove legacy un-namespaced v5 script if present; namespaced paypal_pay/paypal_sub coexist cleanly
    const legacy = document.getElementById('credo-paypal-sdk-v5');
    if (legacy) {
      legacy.remove();
      try { delete window.paypal; } catch {}
    }
    const existing = document.getElementById('credo-paypal-sdk-v6');
    if (existing) existing.remove();

    const s = document.createElement('script');
    s.id = 'credo-paypal-sdk-v6';
    s.src = coreUrl;
    s.async = true;
    s.onload = () => {
      if (window.paypal?.createInstance) resolve(window.paypal);
      else reject(new Error('PayPal Web SDK v6 core no expuso createInstance'));
    };
    s.onerror = () => {
      v6CorePromise = null;
      reject(new Error('No se pudo cargar PayPal Web SDK v6 (verifica tu conexión)'));
    };
    document.head.appendChild(s);
  });
  return v6CorePromise;
}

function loadPayPalSdkV5Fallback(clientId, mode = 'capture') {
  if (!clientId) return Promise.reject(new Error('PAYPAL_CLIENT_ID no configurado'));
  const isSub = mode === 'subscription';
  const ns = isSub ? 'paypal_sub' : 'paypal_pay';
  const scriptId = isSub ? 'credo-paypal-sdk-v5-sub' : 'credo-paypal-sdk-v5-pay';
  const key = `${clientId}:${ns}`;

  if (window[ns]?.Buttons) {
    return Promise.resolve(window[ns]);
  }
  if (v5SdkPromises[key]) {
    return v5SdkPromises[key];
  }

  v5SdkPromises[key] = new Promise((resolve, reject) => {
    const existing = document.getElementById(scriptId);
    if (existing) existing.remove();

    const s = document.createElement('script');
    s.id = scriptId;
    s.setAttribute('data-namespace', ns);
    const qs = isSub
      ? `client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=USD&components=buttons,messages&locale=es_DO`
      : `client-id=${encodeURIComponent(clientId)}&intent=capture&currency=USD&components=buttons,messages&enable-funding=card,paylater&disable-funding=sepa,giropay,sofort,bancontact,eps,ideal,mybank,p24&locale=es_DO`;
    s.src = `https://www.paypal.com/sdk/js?${qs}`;
    s.async = true;
    s.onload = () => (window[ns]?.Buttons ? resolve(window[ns]) : reject(new Error('PayPal SDK no disponible')));
    s.onerror = () => {
      delete v5SdkPromises[key];
      reject(new Error('No se pudo cargar el SDK oficial de PayPal'));
    };
    document.head.appendChild(s);
  });
  return v5SdkPromises[key];
}

// Accessible post-interaction ARIA validation sync (MWG validate-input-after-interaction)
let ariaAnnouncer = null;
function bindAccessibleFormValidation(formEl) {
  if (!formEl) return;
  if (!ariaAnnouncer) {
    ariaAnnouncer = document.createElement('div');
    ariaAnnouncer.setAttribute('aria-live', 'polite');
    ariaAnnouncer.className = 'co-visually-hidden';
    document.body.appendChild(ariaAnnouncer);
  }

  const flagged = new WeakSet();
  const linkError = (el, shown) => {
    const errId = el.dataset.error;
    if (!errId) return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errId);
    if (shown) ids.push(errId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const sync = (el, announce = false) => {
    if (!el?.matches?.('input, select, textarea')) return;
    const supportsUI = window.CSS?.supports?.('selector(:user-invalid)');
    const invalid = supportsUI ? el.matches(':user-invalid') : el.classList.contains('co-user-invalid');
    if (invalid) {
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
      if (announce && el.dataset.error) {
        const msg = document.getElementById(el.dataset.error)?.textContent?.trim();
        if (msg) {
          ariaAnnouncer.textContent = '';
          setTimeout(() => { ariaAnnouncer.textContent = msg; }, 350);
        }
      }
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
    }
  };

  formEl.querySelectorAll('input, select, textarea').forEach((el) => {
    el.setAttribute('aria-invalid', 'false');
  });

  formEl.addEventListener('blur', (e) => {
    const el = e.target;
    if (!window.CSS?.supports?.('selector(:user-invalid)') && el.checkValidity) {
      el.classList.toggle('co-user-invalid', !el.validity.valid);
    }
    sync(el, true);
  }, true);

  formEl.addEventListener('input', (e) => {
    const el = e.target;
    if (!window.CSS?.supports?.('selector(:user-invalid)') && el.classList.contains('co-user-invalid')) {
      el.classList.toggle('co-user-invalid', !el.validity.valid);
    }
    if (el.hasAttribute('aria-invalid')) sync(el, false);
  });

  formEl.addEventListener('invalid', (e) => {
    const el = e.target;
    if (!window.CSS?.supports?.('selector(:user-invalid)')) {
      el.classList.add('co-user-invalid');
    }
    sync(el, false);
  }, true);
}

export function createCredoOneController(app) {
  const state = {
    audience: 'user', // 'user' | 'business'
    cycle: 'monthly', // 'monthly' | 'annual'
    view: 'plans', // 'plans' | 'checkout' | 'enterprise' | 'success'
    checkoutFlow: 'direct', // 'subscription' | 'direct'
    vaultPaymentMethod: false,
    selectedPlan: null,
    plans: INITIAL_PLANS,
    kernelSeal: '',
    paypal: {
      mode: 'live',
      client_id: '',
      configured: false,
      v6_ready: false,
      subscriptions_ready: false,
      sdk_v6_url: 'https://www.paypal.com/web-sdk/v6/core',
    },
    enterpriseWhatsapp: '18095550199',
    enterpriseSuccess: null,
    activatedSub: null,
    billingData: null,
    billingLoading: false,
    sheetCtrl: null,
    loadedRemote: false,
    prevFocus: null,
    mountSeq: 0,
  };

  const getDialog = () => document.getElementById('credoOneDialog');
  const getBackdrop = () => document.getElementById('coSheetBackdrop');
  const getAppShell = () => document.querySelector('.app-shell');

  const formatUsd = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

  async function loadMyBilling() {
    if (!app.user) return;
    state.billingLoading = true;
    renderSheet();
    try {
      const res = await app.api('/api/v1/credo-one/my-billing', { noCache: true });
      state.billingData = res;
      if (res?.paypal) {
        state.paypal = { ...state.paypal, ...res.paypal };
      }
    } catch {
      state.billingData = { subscriptions: [], transactions: [] };
    } finally {
      state.billingLoading = false;
      renderSheet();
    }
  }

  let escBound = false;
  function ensureGlobalSheetListeners() {
    if (escBound) return;
    escBound = true;

    const backdrop = getBackdrop();
    if (backdrop) {
      let pressed = false;
      backdrop.addEventListener('pointerdown', (e) => {
        pressed = e.target === backdrop;
      });
      backdrop.addEventListener('pointerup', (e) => {
        if (pressed && e.target === backdrop) closeSheet();
        pressed = false;
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dlg = getDialog();
      if (!dlg || !dlg.open) return;
      // Do not close Credo One sheet if PayPal modal / 3DS overlay is currently active above us
      if (document.querySelector('paypal-sdk-modal, [id^="zoid-paypal-checkout"], .paypal-checkout-sandbox')) {
        return;
      }
      e.preventDefault();
      closeSheet();
    });
  }

  function showSheetSurface() {
    ensureGlobalSheetListeners();
    const dlg = getDialog();
    const backdrop = getBackdrop();
    const shell = getAppShell();
    if (!dlg) return;

    state.prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dlg.removeAttribute('data-closing');
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.add('is-open');
    }
    if (shell) shell.setAttribute('inert', '');
    document.body.classList.add('co-sheet-open');

    // CRITICAL: Use non-modal dlg.show() (with backdrop + inert + Escape) instead of dlg.showModal().
    // Browser top-layer from showModal() traps PayPal v6/v5 modals, Pay Later calculators, and 3DS overlays
    // BEHIND the dialog regardless of z-index. With show() at z-index:960, PayPal overlays render unobstructed on top!
    if (!dlg.open) {
      dlg.show();
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion && typeof dlg.animate === 'function') {
        try {
          const anim = dlg.animate(
            [
              { transform: 'translate3d(0, 28px, 0)' },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
          );
          setTimeout(() => {
            try { anim.finish(); } catch {}
          }, 320);
        } catch {}
      }
    }
  }

  function closeSheet() {
    const dlg = getDialog();
    const backdrop = getBackdrop();
    const shell = getAppShell();
    if (!dlg || !dlg.open) return;

    if (state.sheetCtrl) {
      state.sheetCtrl.destroy();
      state.sheetCtrl = null;
    }

    if (backdrop) backdrop.classList.remove('is-open');

    const finish = () => {
      try { dlg.close(); } catch {}
      if (backdrop) backdrop.hidden = true;
      if (shell) shell.removeAttribute('inert');
      document.body.classList.remove('co-sheet-open');
      if (state.prevFocus && document.contains(state.prevFocus)) {
        try { state.prevFocus.focus({ preventScroll: true }); } catch {}
      }
      state.prevFocus = null;
    };

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && typeof dlg.animate === 'function') {
      try {
        const anim = dlg.animate(
          [
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            { opacity: 0, transform: 'translate3d(0, 48px, 0)' },
          ],
          { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }
        );
        anim.onfinish = finish;
        setTimeout(() => { if (dlg.open) finish(); }, 260);
        return;
      } catch {}
    }
    finish();
  }

  async function refreshPlans() {
    try {
      const data = await app.api('/api/v1/credo-one/plans', { noCache: true });
      if (Array.isArray(data.plans) && data.plans.length > 0) {
        state.plans = data.plans;
      }
      if (data.kernel?.integrity_seal) state.kernelSeal = data.kernel.integrity_seal;
      if (data.paypal) state.paypal = { ...state.paypal, ...data.paypal };
      if (data.enterprise_whatsapp) state.enterpriseWhatsapp = data.enterprise_whatsapp;
      state.loadedRemote = true;
    } catch {
      // Handled gracefully by retry / cached state
    }
  }

  function savePendingReturnMeta(plan, cycle, orgName, flow) {
    try {
      sessionStorage.setItem(
        PENDING_RETURN_KEY,
        JSON.stringify({
          plan_sku: plan.sku,
          billing_cycle: cycle,
          organization_name: orgName || '',
          flow,
          ts: Date.now(),
        })
      );
    } catch {}
  }

  function readPendingReturnMeta() {
    try {
      const raw = sessionStorage.getItem(PENDING_RETURN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - (parsed.ts || 0) > 60 * 60 * 1000) {
        sessionStorage.removeItem(PENDING_RETURN_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearPendingReturnMeta() {
    try { sessionStorage.removeItem(PENDING_RETURN_KEY); } catch {}
  }

  async function finalizeActivationSuccess(plan, sub) {
    clearPendingReturnMeta();
    state.selectedPlan = plan;
    state.activatedSub = sub || null;
    await app.refreshSession?.();
    state.view = 'success';
    const dlg = getDialog();
    if (dlg && !dlg.open) showSheetSurface();
    renderSheet();
    app.toast(`¡${plan?.display_name || 'Credo One'} activado!`);
  }

  // Runs automatically on app startup to resume PayPal redirect-mode returns (plans, subscriptions, & Studio campaigns)
  async function handlePayPalReturnIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const isOrderReturn = params.get('paypal_return') === '1';
    const isSubReturn = params.get('paypal_sub_return') === '1';
    const isCampaignReturn = params.get('paypal_campaign_return') === '1';
    const isCancel = params.get('paypal_cancel') === '1' || params.get('paypal_campaign_cancel') === '1';

    if (!isOrderReturn && !isSubReturn && !isCampaignReturn && !isCancel) return;

    const cleanUrl = `${window.location.pathname}${window.location.hash || '#/feed'}`;
    try {
      history.replaceState(null, '', cleanUrl);
    } catch {}

    if (isCancel) {
      clearPendingReturnMeta();
      app.toast('Pago con PayPal cancelado. Puedes intentarlo cuando gustes.');
      return;
    }

    if (!app.token) {
      app.toast('Inicia sesión para completar la activación de tu pago PayPal.');
      return;
    }

    if (isCampaignReturn) {
      const campId = Number(params.get('campaign_id') || 0);
      const orgId = Number(params.get('org_id') || 0);
      const orderId = params.get('token') || params.get('order_id') || '';
      if (campId && orderId) {
        try {
          app.toast('Confirmando pago de tu campaña en PayPal…');
          await app.api(`/api/v1/studio/campaigns/${campId}/paypal-capture`, {
            method: 'POST',
            body: { org_id: orgId || undefined, order_id: orderId },
          });
          app.toast('¡Pago confirmado! Tu campaña ya está activa en el feed.');
          if (location.hash.startsWith('#/studio')) {
            app.navigate?.();
          } else {
            location.hash = '#/studio/campaigns';
          }
        } catch (err) {
          app.toast(err?.message || 'No se pudo verificar el pago de la campaña.');
        }
      }
      return;
    }

    await refreshPlans();
    const pending = readPendingReturnMeta() || {};
    const sku = params.get('plan_sku') || pending.plan_sku;
    const cycle = params.get('billing_cycle') || pending.billing_cycle || 'monthly';
    const orgName = params.get('org_name') || pending.organization_name || '';
    const plan = state.plans.find((p) => p.sku === sku) || state.plans[0];

    try {
      if (isOrderReturn) {
        const orderId = params.get('token') || params.get('order_id');
        if (!orderId) return;
        app.toast('Confirmando tu pago con PayPal…');
        const res = await app.api(`/api/v1/credo-one/paypal/orders/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST',
          body: {
            plan_sku: sku,
            billing_cycle: cycle,
            organization_name: orgName,
            payment_method: 'PayPal (Redirect)',
          },
        });
        await finalizeActivationSuccess(plan, res.subscription);
      } else if (isSubReturn) {
        const subId = params.get('subscription_id') || params.get('ba_token') || params.get('token');
        if (!subId) return;
        app.toast('Activando tu suscripción Credo One…');
        const res = await app.api('/api/v1/credo-one/subscriptions/confirm', {
          method: 'POST',
          body: {
            subscription_id: subId,
            plan_sku: sku,
            billing_cycle: cycle,
            organization_name: orgName,
          },
        });
        await finalizeActivationSuccess(plan, res.subscription);
      }
    } catch (err) {
      app.toast(err?.message || 'No se pudo completar el retorno de PayPal.');
    }
  }

  function renderPlanCard(plan) {
    const isAnnual = state.cycle === 'annual';
    const isEnt = Boolean(plan.is_enterprise);
    const isCurrent = app.user?.active_plan_sku === plan.sku;
    const priceCents = isAnnual ? plan.price_annual_cents : plan.price_monthly_cents;
    const monthlyEquiv = isAnnual ? Math.round(plan.price_annual_cents / 12) : plan.price_monthly_cents;
    const features = Array.isArray(plan.features) ? plan.features : [];

    const tierClass = isEnt
      ? 'co-card--enterprise'
      : plan.is_popular
        ? 'co-card--popular'
        : 'co-card--standard';

    return `
      <article class="co-card ${tierClass}" data-sku="${app.esc(plan.sku)}">
        <div class="co-card-top">
          <div class="co-card-badges">
            <span class="co-tier-eyebrow">${plan.audience === 'business' ? 'Empresas' : 'Personal'}</span>
            ${plan.is_popular ? '<span class="co-badge-popular">Más Popular</span>' : ''}
            ${isEnt ? '<span class="co-badge-gold">Venta Corporativa</span>' : ''}
            ${isCurrent ? '<span class="co-badge-active">Plan Actual</span>' : ''}
          </div>
          <h3 class="co-card-title">${app.esc(plan.display_name)}</h3>
          <p class="co-card-sub">${app.esc(plan.subtitle)}</p>
        </div>

        <div class="co-card-price-block">
          ${isEnt ? `
            <div class="co-price-row">
              <span class="co-price-prefix">Desde</span>
              <span class="co-price-val co-price-gold">$350+</span>
              <span class="co-price-unit">USD/mes</span>
            </div>
            <p class="co-price-note">Facturación corporativa vía transferencia con factura fiscal</p>
          ` : `
            <div class="co-price-row">
              <span class="co-price-val">${formatUsd(priceCents)}</span>
              <span class="co-price-unit">USD/${isAnnual ? 'año' : 'mes'}</span>
            </div>
            <p class="co-price-note">${
              isAnnual
                ? `Equivalente a ${formatUsd(monthlyEquiv)}/mes · Ahorras 2 meses gratis`
                : `O ${formatUsd(plan.price_annual_cents)} USD/año (2 meses gratis)`
            }</p>
          `}
        </div>

        <ul class="co-feature-list">
          ${features.map((ft) => `
            <li>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" fill="${isEnt ? 'rgba(212,175,55,0.16)' : 'rgba(56,189,248,0.14)'}"/>
                <path d="M6.2 10.2 8.7 12.6 13.8 7.5" stroke="${isEnt ? '#D4AF37' : '#38BDF8'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>${app.esc(ft)}</span>
            </li>`).join('')}
        </ul>

        <div class="co-card-foot">
          ${isEnt ? `
            <button type="button" class="co-cta-btn co-cta-gold" data-select-enterprise="1">
              <span>Hablar con Ventas Corporativas</span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          ` : `
            <button type="button" class="co-cta-btn ${plan.is_popular ? 'co-cta-sapphire' : 'co-cta-glass'}" data-choose-plan="${app.esc(plan.sku)}" ${isCurrent ? 'disabled' : ''}>
              <span>${isCurrent ? 'Plan Activo' : 'Elegir Plan'}</span>
              ${isCurrent ? '' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'}
            </button>
          `}
        </div>
      </article>
    `;
  }

  function renderPlansView() {
    const visiblePlans = state.plans.filter((p) => p.audience === state.audience);
    const activeMeta = app.getPlanMeta?.(app.user) || null;
    const dynamicSubtitle =
      state.audience === 'business'
        ? 'Impulsa tu parroquia, emisora, comercio o institución con campañas medidas y control de equipo.'
        : 'Apoya la evangelización digital sin anuncios, con audio continuo y herramientas para creadores.';

    return `
      <div class="co-sheet-head">
        <div class="co-eyebrow-pill">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
          <span>Familia Credo One</span>
        </div>
        <h1 class="co-sheet-title" id="coSheetTitle">${activeMeta ? app.esc(activeMeta.name) : 'Únete a Credo One'}</h1>
        ${activeMeta ? `
          <div class="co-active-sheet-banner">
            ${app.renderPlanInsignia(app.user)}
            <span>Plan activo en tu cuenta</span>
            <button type="button" id="coOpenBillingBtn" style="margin-left:6px;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.12);color:#fff;font-size:0.74rem;font-weight:700;cursor:pointer">Mis pagos ›</button>
          </div>` : (app.user ? `
          <div style="margin-top:8px">
            <button type="button" class="co-back-btn" id="coOpenBillingBtn" style="margin:0">Ver historial de movimientos ›</button>
          </div>` : '')}
        <p class="co-sheet-subtitle">${dynamicSubtitle}</p>

        <div class="co-controls-bar">
          <div class="seg-tabs co-seg-audience" role="tablist" aria-label="Tipo de cuenta">
            <button type="button" role="tab" class="seg-tab${state.audience === 'user' ? ' is-active' : ''}" aria-selected="${state.audience === 'user'}" data-co-audience="user">User</button>
            <button type="button" role="tab" class="seg-tab${state.audience === 'business' ? ' is-active' : ''}" aria-selected="${state.audience === 'business'}" data-co-audience="business">Empresas</button>
          </div>

          <div class="co-cycle-switch" role="group" aria-label="Ciclo de facturación">
            <button type="button" class="co-cycle-btn${state.cycle === 'monthly' ? ' is-active' : ''}" data-co-cycle="monthly">Mensual</button>
            <button type="button" class="co-cycle-btn${state.cycle === 'annual' ? ' is-active' : ''}" data-co-cycle="annual">
              <span>Anual</span>
              <span class="co-save-chip">2 meses gratis</span>
            </button>
          </div>
        </div>
      </div>

      <div class="co-plans-grid ${state.audience === 'user' ? 'co-grid-2' : 'co-grid-3'}">
        ${visiblePlans.length > 0
          ? visiblePlans.map(renderPlanCard).join('')
          : Array.from({ length: state.audience === 'user' ? 2 : 3 }, () => `
              <div class="co-card" style="min-height:360px">
                <div class="skeleton" style="height:22px;width:45%;border-radius:8px;margin-bottom:12px"></div>
                <div class="skeleton" style="height:36px;width:55%;border-radius:10px;margin-bottom:18px"></div>
                <div class="skeleton" style="height:14px;width:90%;border-radius:6px;margin-bottom:10px"></div>
                <div class="skeleton" style="height:14px;width:82%;border-radius:6px;margin-bottom:10px"></div>
                <div class="skeleton" style="height:14px;width:74%;border-radius:6px"></div>
              </div>`).join('')}
      </div>

      <div class="co-sheet-footer-note">
        <span>Pagos cifrados con PayPal Web SDK v6 · Precios y cuotas sellados en núcleo compilado F#${state.kernelSeal ? ` (${app.esc(state.kernelSeal.slice(0, 8))})` : ''}.</span>
      </div>
    `;
  }

  function renderCheckoutView() {
    const plan = state.selectedPlan;
    if (!plan) return renderPlansView();
    const isAnnual = state.cycle === 'annual';
    const priceCents = isAnnual ? plan.price_annual_cents : plan.price_monthly_cents;
    const ppPlanId = isAnnual ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
    const canRecur = Boolean(ppPlanId && state.paypal.subscriptions_ready);

    return `
      <div class="co-subview co-slide-in">
        <button type="button" class="co-back-btn" id="coBackToPlans">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
          <span>Volver a los planes</span>
        </button>

        <div class="co-checkout-layout">
          <div class="co-checkout-summary">
            <span class="co-tier-eyebrow">${plan.audience === 'business' ? 'Plan Empresarial' : 'Plan Personal'}</span>
            <h1 class="co-sheet-title" id="coSheetTitle" style="text-align:left;margin-top:6px">${app.esc(plan.display_name)}</h1>
            <p class="co-card-sub" style="margin-bottom:16px">${app.esc(plan.subtitle)}</p>

            <div class="co-summary-box">
              <div class="co-summary-row">
                <span>SKU Interno</span>
                <code>${app.esc(plan.sku)}</code>
              </div>
              <div class="co-summary-row">
                <span>Ciclo de cobro</span>
                <strong>${isAnnual ? 'Anual (2 meses gratis)' : 'Mensual'}</strong>
              </div>
              ${plan.monthly_impressions > 0 ? `
                <div class="co-summary-row">
                  <span>Bolsa mensual garantizada</span>
                  <strong>${Number(plan.monthly_impressions).toLocaleString('es-DO')} impresiones</strong>
                </div>` : ''}
              <div class="co-summary-row co-summary-total">
                <span>Total verificado F#</span>
                <strong>${formatUsd(priceCents)} USD</strong>
              </div>
            </div>

            <div class="co-trust-pills">
              <span>🔒 TLS + PCI-DSS</span>
              <span>⚡ Activación instantánea</span>
              <span>🛡️ Núcleo F# 8</span>
            </div>

            ${plan.audience === 'business' ? `
              <div class="co-field" style="margin-top:14px">
                <label for="coOrgName">Nombre comercial o institución</label>
                <input id="coOrgName" type="text" placeholder="Ej. Parroquia San José / Radio Aire 96 FM" value="${app.esc(app.user?.full_name ? `${app.user.full_name} · Institucional` : '')}" />
              </div>` : ''}
          </div>

          <div class="co-checkout-paybox">
            <div class="co-paybox-head">
              <div>
                <h2 style="margin:0 0 4px;font-size:1.05rem;font-weight:700;color:#fff">Pago Seguro con PayPal</h2>
                <p class="co-card-sub" style="margin:0">PayPal, Tarjeta de Débito/Crédito, Pay Later y Wallets digitales.</p>
              </div>
              <span id="coSdkBadge" class="co-sdk-pill">Inicializando…</span>
            </div>

            ${canRecur ? `
              <div class="co-flow-tabs" role="tablist" aria-label="Modalidad de pago">
                <button type="button" role="tab" class="co-flow-tab${state.checkoutFlow === 'subscription' ? ' is-active' : ''}" data-co-flow="subscription">Suscripción automática</button>
                <button type="button" role="tab" class="co-flow-tab${state.checkoutFlow === 'direct' ? ' is-active' : ''}" data-co-flow="direct">Tarjeta / Wallets / Pay Later</button>
              </div>
            ` : ''}

            ${!app.user ? `
              <div class="co-auth-prompt" style="margin-top:14px">
                <p>Inicia sesión o crea tu cuenta en Credo para vincular tu plan y desbloquear Credo One al instante.</p>
                <button type="button" class="co-cta-btn co-cta-sapphire" id="coCheckoutLoginBtn">Iniciar sesión en Credo</button>
              </div>
            ` : !state.paypal.client_id ? `
              <div class="co-paypal-pending" style="margin-top:14px">
                <strong>Integración PayPal lista para activación de credenciales</strong>
                <p>El servidor aún no tiene configurado <code>PAYPAL_CLIENT_ID</code> en este entorno (${app.esc(state.paypal.mode)}).</p>
              </div>
            ` : `
              <div id="coPayPalMessageSlot" class="co-pp-msg-slot" hidden></div>
              <div id="coPayPalVaultRow" class="co-vault-row" hidden>
                <label class="co-vault-check">
                  <input type="checkbox" id="coVaultCheckbox" ${state.vaultPaymentMethod ? 'checked' : ''} />
                  <span>Guardar método de pago en PayPal Vault (1-clic para próximas renovaciones)</span>
                </label>
              </div>
              <div id="coPayPalStatus" class="co-pp-status" hidden></div>
              <div id="coPayPalButtonsHost" class="co-paypal-host">
                <div class="co-paypal-loading">Conectando con PayPal Web SDK v6…</div>
              </div>
              <div id="coCardFieldsSection" class="co-cardfields-wrap" hidden></div>
              <button type="button" class="co-cta-btn co-cta-glass" id="coDirectHostedPayBtn" style="margin-top:10px;min-height:40px;font-size:0.8rem">
                <span>¿No abre la ventana? Pagar directo en PayPal.com ↗</span>
              </button>
              <div id="coPayPalNotice" class="co-pp-notice" hidden></div>
              <div id="coPayPalError" class="co-inline-error" hidden></div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderEnterpriseView() {
    if (state.enterpriseSuccess) {
      return `
        <div class="co-subview co-slide-in co-success-box">
          <div class="co-gold-seal">✦</div>
          <h1 class="co-sheet-title" id="coSheetTitle">Solicitud Corporativa Registrada</h1>
          <p class="co-sheet-subtitle" style="max-width:540px">
            Hemos registrado tu requerimiento para <strong>${app.esc(state.enterpriseSuccess.company_name)}</strong> (#${app.esc(state.enterpriseSuccess.id)}).
            Un asesor ejecutivo coordinará tu activación corporativa y facturación fiscal vía transferencia.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:20px">
            <a href="${app.esc(state.enterpriseSuccess.whatsapp_url)}" target="_blank" rel="noopener noreferrer" class="co-cta-btn co-cta-gold" style="width:auto;padding-inline:24px">
              <span>Continuar por WhatsApp Corporativo</span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </a>
            <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;padding-inline:20px" id="coBackToPlans">Volver a planes</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="co-subview co-slide-in">
        <button type="button" class="co-back-btn" id="coBackToPlans">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
          <span>Volver a los planes</span>
        </button>

        <div class="co-ent-header">
          <span class="co-badge-gold">Credo One Enterprise · Venta Corporativa</span>
          <h1 class="co-sheet-title" id="coSheetTitle" style="text-align:left;margin-top:8px">Hablar con Ventas Corporativas</h1>
          <p class="co-card-sub">Para bancos, universidades, clínicas, aseguradoras, diócesis y grandes marcas nacionales. Contratación directa vía transferencia con factura fiscal y SLA dedicado.</p>
        </div>

        <form id="coEnterpriseForm" class="co-ent-form" novalidate>
          <div class="co-form-grid">
            <div class="co-field">
              <label for="entCompany">Empresa o Institución *</label>
              <input id="entCompany" name="company_name" required autocomplete="organization" placeholder="Ej. Banco Popular / Arquidiócesis" data-error="entCompanyErr" />
              <div id="entCompanyErr" class="co-field-err">Error: Ingresa el nombre de tu empresa o institución.</div>
            </div>
            <div class="co-field">
              <label for="entTax">RNC / ID Fiscal *</label>
              <input id="entTax" name="tax_id" required placeholder="Ej. 1-01-12345-6" data-error="entTaxErr" />
              <div id="entTaxErr" class="co-field-err">Error: Ingresa el RNC o número de identificación fiscal.</div>
            </div>
            <div class="co-field">
              <label for="entName">Nombre completo *</label>
              <input id="entName" name="contact_name" required autocomplete="name" value="${app.esc(app.user?.full_name || '')}" placeholder="Ej. Lic. Carlos Méndez" data-error="entNameErr" />
              <div id="entNameErr" class="co-field-err">Error: Ingresa tu nombre completo.</div>
            </div>
            <div class="co-field">
              <label for="entRole">Cargo ejecutivo *</label>
              <input id="entRole" name="contact_role" required autocomplete="organization-title" placeholder="Ej. Director de Mercadeo / Canciller" data-error="entRoleErr" />
              <div id="entRoleErr" class="co-field-err">Error: Indica tu cargo en la organización.</div>
            </div>
            <div class="co-field">
              <label for="entEmail">Correo Corporativo *</label>
              <span id="entEmailHint" class="co-field-hint">Usa el dominio oficial de tu institución</span>
              <input id="entEmail" name="corporate_email" type="email" required autocomplete="email" aria-describedby="entEmailHint" value="${app.esc(app.user?.email || '')}" placeholder="nombre@empresa.com" data-error="entEmailErr" />
              <div id="entEmailErr" class="co-field-err">Error: Ingresa un correo corporativo válido (ej. nombre@empresa.com).</div>
            </div>
            <div class="co-field">
              <label for="entPhone">WhatsApp / Teléfono *</label>
              <input id="entPhone" name="whatsapp_phone" type="tel" required autocomplete="tel" placeholder="+1 (809) 000-0000" data-error="entPhoneErr" />
              <div id="entPhoneErr" class="co-field-err">Error: Ingresa un número de WhatsApp o teléfono directo.</div>
            </div>
          </div>

          <div class="co-field">
            <label for="entGoal">Objetivo de Campaña y Alcance Deseado *</label>
            <textarea id="entGoal" name="campaign_goal" required rows="3" placeholder="Ej. Patrocinio del Evangelio del Día, red de 12 subcuentas de sucursales y 500,000 impresiones mensuales..." data-error="entGoalErr"></textarea>
            <div id="entGoalErr" class="co-field-err">Error: Cuéntanos brevemente tu objetivo de campaña.</div>
          </div>

          <div id="coEntSubmitErr" class="co-inline-error" hidden></div>

          <div class="co-ent-actions">
            <button type="submit" class="co-cta-btn co-cta-gold" id="coEntSubmitBtn">
              <span>Registrar Solicitud y Continuar por WhatsApp</span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </div>
        </form>
      </div>
    `;
  }

  function renderSuccessView() {
    const plan = state.selectedPlan;
    const canStudio = Boolean(plan?.studio_access);
    return `
      <div class="co-subview co-slide-in co-success-box">
        <div class="co-sapphire-seal">✓</div>
        <h1 class="co-sheet-title" id="coSheetTitle">¡Bienvenido a ${app.esc(plan?.display_name || 'Credo One')}!</h1>
        <p class="co-sheet-subtitle" style="max-width:520px">
          Tu pago ha sido verificado y tus beneficios ya se aplicaron a tu cuenta en tiempo real.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:20px">
          ${canStudio ? `
            <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;padding-inline:24px" id="coGoStudioBtn">
              <span>Abrir Credo One Studio</span>
            </button>` : ''}
          <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;padding-inline:22px" id="coDoneBtn">Ver mi plan y recibo</button>
        </div>
      </div>
    `;
  }

  function renderBillingView() {
    const subs = state.billingData?.subscriptions || [];
    const txs = state.billingData?.transactions || [];
    const activeSub = subs.find((s) => s.status === 'active') || null;
    const isSandboxKey = state.paypal?.effective_env === 'sandbox';
    const fmtDate = (iso) => {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString('es-DO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return iso;
      }
    };

    return `
      <div class="co-subview co-slide-in">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <button type="button" class="co-back-btn" id="coBackToPlans" style="margin:0">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
            <span>Explorar todos los planes</span>
          </button>
          <span class="co-sdk-pill ${isSandboxKey ? 'is-sandbox' : 'is-live'}">
            ${isSandboxKey ? 'Entorno PayPal: Sandbox (Prueba)' : 'Entorno PayPal: Live (Real)'}
          </span>
        </div>

        <h1 class="co-sheet-title" id="coSheetTitle" style="text-align:left;margin-bottom:6px">Mi Plan y Movimientos</h1>
        <p class="co-card-sub" style="margin-bottom:16px">Estado de tu membresía Credo One y comprobantes registrados en tu cuenta.</p>

        ${isSandboxKey ? `
          <div class="co-sandbox-alert">
            <strong>⚠️ Aviso de Entorno Sandbox (Pruebas):</strong>
            El <code>PAYPAL_CLIENT_ID</code> actualmente configurado en el servidor pertenece a <strong>PayPal Sandbox</strong>${state.paypal?.merchant_id ? ` (Merchant de prueba <code>${app.esc(state.paypal.merchant_id)}</code>)` : ''}.
            Los movimientos realizados en Sandbox usan saldo simulado de pruebas: <strong>no debitan dinero real de tu tarjeta/banco ni depositan saldo real en <code>paypal.com</code></strong> (solo aparecen en <code>sandbox.paypal.com</code>). Para cobros reales, reemplaza el Client ID + Secret por tus credenciales de la pestaña <strong>Live</strong> en PayPal Developer.
          </div>` : ''}

        ${state.billingLoading && !state.billingData ? `
          <div class="co-billing-card">
            <div class="skeleton" style="height:22px;width:45%;border-radius:8px;margin-bottom:10px"></div>
            <div class="skeleton" style="height:16px;width:72%;border-radius:6px"></div>
          </div>
        ` : activeSub ? `
          <div class="co-billing-card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  ${app.renderPlanInsignia(app.user)}
                  <strong style="font-size:1.1rem;color:#fff">${app.esc(activeSub.display_name || activeSub.plan_sku)}</strong>
                  <span class="co-badge-active">Activo</span>
                </div>
                <p class="co-card-sub" style="margin:0">
                  Ciclo ${activeSub.billing_cycle === 'annual' ? 'Anual' : 'Mensual'} · Vigente hasta <strong>${app.esc(fmtDate(activeSub.current_period_end))}</strong>
                </p>
                <p class="co-card-sub" style="margin:3px 0 0;font-size:0.74rem">
                  Ref. PayPal: <code>${app.esc(activeSub.paypal_subscription_id || '—')}</code>
                </p>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="co-cta-btn co-cta-glass" id="coChangePlanBtn" style="width:auto;min-height:38px;padding:7px 14px;font-size:0.8rem">Cambiar de plan</button>
                <button type="button" class="co-cta-btn co-cta-glass" id="coCancelMySubBtn" style="width:auto;min-height:38px;padding:7px 14px;font-size:0.8rem;color:#FCA5A5;border-color:rgba(248,113,113,0.35)">Cancelar plan</button>
              </div>
            </div>
          </div>
        ` : `
          <div class="co-billing-card">
            <strong style="color:#fff">No tienes una suscripción activa en este momento</strong>
            <p class="co-card-sub" style="margin:4px 0 12px">Elige un plan de la Familia Credo One para disfrutar Credo sin anuncios o impulsar tu institución.</p>
            <button type="button" class="co-cta-btn co-cta-sapphire" id="coChangePlanBtn" style="width:auto;padding-inline:20px">Ver planes disponibles</button>
          </div>
        `}

        <h2 style="font-size:0.96rem;font-weight:800;color:#fff;margin:18px 0 10px">Movimientos Registrados (${txs.length})</h2>
        ${txs.length === 0 ? `
          <div class="co-billing-card" style="text-align:center;color:#9CA3AF;font-size:0.85rem">
            Aún no hay movimientos registrados en tu cuenta.
          </div>
        ` : `
          <div class="co-tx-list">
            ${txs.map((tx) => {
              const st = String(tx.status || 'completed').toLowerCase();
              const isRefunded = st === 'refunded' || st === 'failed';
              const stLabel = isSandboxKey
                ? 'Sandbox (Prueba)'
                : st === 'refunded'
                  ? 'Reembolsado'
                  : st === 'failed'
                    ? 'Fallido'
                    : 'Completado';
              const pillCls = isSandboxKey
                ? 'co-sdk-pill is-sandbox'
                : isRefunded
                  ? 'co-status-pill co-status-rejected'
                  : 'co-badge-active';
              return `
              <div class="co-tx-item">
                <div class="co-tx-meta">
                  <strong>${app.esc(tx.display_name || tx.plan_sku)} · ${app.esc(tx.description || 'Pago PayPal')}</strong>
                  <small>Fecha: ${app.esc(fmtDate(tx.created_at))}</small>
                  <small>Captura PayPal: <code>${app.esc(tx.paypal_sale_id || '—')}</code> · Evento: <code>${app.esc(tx.paypal_event_id || '—')}</code></small>
                </div>
                <div class="co-tx-amt">
                  <strong>${formatUsd(tx.amount_cents)} ${app.esc(tx.currency || 'USD')}</strong>
                  <span class="${pillCls}" style="font-size:0.66rem">
                    ${stLabel}
                  </span>
                </div>
              </div>`;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  // =========================================================================
  // ENGINE A: FULL PAYPAL WEB SDK v6 (6.72.6+) — ALL AUTOMATIONS & AMENITIES
  // =========================================================================
  async function mountPayPalV6({ dlg, host, errBox, statusBox, msgSlot, vaultRow, cardWrap, sdkBadge, tokenData, plan, seq }) {
    const isAnnual = state.cycle === 'annual';
    const amountUsd = ((isAnnual ? plan.price_annual_cents : plan.price_monthly_cents) / 100).toFixed(2);
    const ppPlanId = isAnnual ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
    const useSubscription = state.checkoutFlow === 'subscription' && Boolean(ppPlanId && state.paypal.subscriptions_ready);

    const setStatus = (msg) => {
      if (!statusBox) return;
      if (!msg) {
        statusBox.hidden = true;
        statusBox.textContent = '';
      } else {
        statusBox.textContent = msg;
        statusBox.hidden = false;
      }
    };
    const setErr = (msg) => {
      if (!errBox) return;
      if (!msg) {
        errBox.hidden = true;
        errBox.textContent = '';
      } else {
        errBox.textContent = msg;
        errBox.hidden = false;
      }
    };

    const getOrgName = () => dlg.querySelector('#coOrgName')?.value?.trim() || '';

    const paypalV6 = await loadPayPalSdkV6Core(tokenData.sdk_v6_url || state.paypal.sdk_v6_url);
    if (seq !== state.mountSeq) return;

    const fullComponents = [
      'paypal-payments',
      'paypal-subscriptions',
      'paypal-guest-payments',
      'paypal-messages',
      'card-fields',
      'venmo-payments',
      'applepay-payments',
      'googlepay-payments',
    ];
    const coreComponents = [
      'paypal-payments',
      'paypal-subscriptions',
      'paypal-guest-payments',
      'paypal-messages',
      'card-fields',
    ];

    let sdkInstance;
    try {
      sdkInstance = await paypalV6.createInstance({
        clientToken: tokenData.client_token,
        components: fullComponents,
        pageType: 'checkout',
        locale: 'es-DO',
      });
    } catch {
      sdkInstance = await paypalV6.createInstance({
        clientToken: tokenData.client_token,
        components: coreComponents,
        pageType: 'checkout',
        locale: 'es-DO',
      });
    }
    if (seq !== state.mountSeq) return;

    if (sdkBadge) {
      sdkBadge.textContent = `SDK v6 · ${paypalV6.version || 'Live'}`;
      sdkBadge.classList.add('is-v6');
    }

    let eligibleMethods;
    try {
      eligibleMethods = await sdkInstance.findEligibleMethods({
        currencyCode: 'USD',
        ...(useSubscription ? { paymentFlow: 'RECURRING_PAYMENT' } : {}),
      });
    } catch {
      eligibleMethods = {
        _fallback: true,
        isEligible: (method) => method === 'paypal' || method === 'card',
        getDetails: () => ({}),
      };
    }
    if (seq !== state.mountSeq) return;

    // 1. Dynamic Pay Later promotional messaging (<paypal-message>)
    if (!useSubscription && !eligibleMethods._fallback && msgSlot && Number(amountUsd) >= 30 && typeof sdkInstance.createPayPalMessages === 'function') {
      try {
        sdkInstance.createPayPalMessages({ currencyCode: 'USD' });
        msgSlot.innerHTML = `<paypal-message amount="${app.esc(amountUsd)}" currency-code="USD" logo-position="inline" text-color="MONOCHROME" auto-bootstrap></paypal-message>`;
        msgSlot.hidden = false;
      } catch {}
    }

    // 2. Show 1-click PayPal Vaulting toggle ONLY when merchant account actually reports vault eligibility
    const vaultEligible = Boolean(!eligibleMethods._fallback && eligibleMethods.isEligible?.('vault'));
    if (!useSubscription && vaultEligible && vaultRow) {
      vaultRow.hidden = false;
      const chk = dlg.querySelector('#coVaultCheckbox');
      if (chk) {
        chk.onchange = () => {
          state.vaultPaymentMethod = Boolean(chk.checked);
        };
      }
    } else if (vaultRow) {
      vaultRow.hidden = true;
      state.vaultPaymentMethod = false;
    }

    // Helper: create Orders v2 on server (strictly F# 8 PricingKernel amounts, multi-funding ready)
    const createServerOrder = async (paymentSource = 'auto') => {
      const res = await app.api('/api/v1/credo-one/paypal/orders', {
        method: 'POST',
        body: {
          plan_sku: plan.sku,
          billing_cycle: state.cycle,
          vault: state.vaultPaymentMethod,
          payment_source: paymentSource,
          organization_name: getOrgName(),
        },
      });
      return { orderId: res.orderId || res.id, approve_url: res.approve_url || '' };
    };

    const captureServerOrder = async (orderId, methodLabel) => {
      setErr('');
      setStatus('Verificando y activando tu plan Credo One…');
      const res = await app.api(`/api/v1/credo-one/paypal/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        body: {
          plan_sku: plan.sku,
          billing_cycle: state.cycle,
          organization_name: getOrgName(),
          payment_method: methodLabel,
        },
      });
      setStatus('');
      await finalizeActivationSuccess(plan, res.subscription);
    };

    const startWithPresentationCascade = async (session, payloadPromiseFactory, flowTag) => {
      setErr('');
      setStatus('Conectando con PayPal seguro…');
      const modes = getPresentationCascade();
      let lastErr = null;

      // CRITICAL PayPal Web SDK v6 contract:
      // session.start({ presentationMode }, orderOrSubPromise) MUST receive an INVOKED Promise
      // resolving to { orderId } or { subscriptionId } — NEVER an un-invoked callback function!
      const rawPromise = Promise.resolve().then(() => payloadPromiseFactory());
      const sdkPayloadPromise = rawPromise.then((res) => {
        if (res?.subscriptionId) return { subscriptionId: res.subscriptionId };
        if (res?.orderId) return { orderId: res.orderId };
        throw new Error('El servidor no devolvió un identificador de pago PayPal válido.');
      });
      // Prevent unhandled rejection warning if session.start fails before awaiting sdkPayloadPromise
      sdkPayloadPromise.catch(() => {});

      for (const presentationMode of modes) {
        try {
          if (presentationMode === 'redirect') {
            savePendingReturnMeta(plan, state.cycle, getOrgName(), flowTag);
          }
          await session.start({ presentationMode }, sdkPayloadPromise);
          setStatus('');
          return;
        } catch (err) {
          lastErr = err;
          if (err?.isRecoverable || /popup|blocked|payment-handler|presentation/i.test(err?.message || '')) {
            continue;
          }
          break;
        }
      }

      // Ultimate safety net: if every embedded/popup mode was blocked by browser policy,
      // redirect directly to PayPal's official hosted approval URL returned by our server!
      try {
        const resolved = await rawPromise;
        if (resolved?.approve_url) {
          savePendingReturnMeta(plan, state.cycle, getOrgName(), flowTag);
          setStatus('Redirigiendo a PayPal seguro…');
          window.location.href = resolved.approve_url;
          return;
        }
      } catch (serverErr) {
        lastErr = serverErr;
      }

      setStatus('');
      if (lastErr) {
        setErr(lastErr?.message || 'No se pudo iniciar la sesión de pago con PayPal.');
      }
    };

    host.innerHTML = '';
    host.classList.add('co-paypal-host--v6');
    const stack = document.createElement('div');
    stack.className = 'co-v6-btn-stack';
    host.appendChild(stack);

    // 3. SUBSCRIPTION SESSION (<paypal-button type="subscribe">)
    if (useSubscription && typeof sdkInstance.createPayPalSubscriptionPaymentSession === 'function') {
      const subSession = sdkInstance.createPayPalSubscriptionPaymentSession({
        onApprove: async (data) => {
          try {
            setStatus('Confirmando suscripción recurrente con PayPal…');
            const res = await app.api('/api/v1/credo-one/subscriptions/confirm', {
              method: 'POST',
              body: {
                subscription_id: data.subscriptionId || data.subscriptionID,
                plan_sku: plan.sku,
                billing_cycle: state.cycle,
                organization_name: getOrgName(),
              },
            });
            setStatus('');
            await finalizeActivationSuccess(plan, res.subscription);
          } catch (err) {
            setStatus('');
            setErr(err?.message || 'No se pudo confirmar tu suscripción.');
          }
        },
        onCancel: () => {
          setStatus('');
        },
        onError: (err) => {
          setStatus('');
          setErr(err?.message || 'Error en la suscripción de PayPal.');
        },
      });

      const subBtn = document.createElement('paypal-button');
      subBtn.setAttribute('type', 'subscribe');
      subBtn.className = 'paypal-blue co-v6-el';
      subBtn.addEventListener('click', () => {
        startWithPresentationCascade(
          subSession,
          async () => {
            const created = await app.api('/api/v1/credo-one/paypal/subscriptions', {
              method: 'POST',
              body: {
                plan_sku: plan.sku,
                billing_cycle: state.cycle,
                organization_name: getOrgName(),
              },
            });
            return {
              subscriptionId: created.subscriptionId || created.id,
              approve_url: created.approve_url || '',
            };
          },
          'subscription'
        );
      });
      stack.appendChild(subBtn);

      const altCardBtn = document.createElement('button');
      altCardBtn.type = 'button';
      altCardBtn.className = 'co-cta-btn co-cta-glass';
      altCardBtn.style.cssText = 'margin-top:2px;min-height:42px;font-size:0.85rem;';
      altCardBtn.innerHTML = '<span>💳 Pagar con Tarjeta de Débito o Crédito</span>';
      altCardBtn.addEventListener('click', () => {
        state.checkoutFlow = 'direct';
        renderSheet();
      });
      stack.appendChild(altCardBtn);
      return;
    }

    // 4. STANDARD PAYPAL BUTTON (<paypal-button type="pay">)
    if (eligibleMethods.isEligible('paypal') && typeof sdkInstance.createPayPalOneTimePaymentSession === 'function') {
      const ppSession = sdkInstance.createPayPalOneTimePaymentSession({
        onApprove: async (data) => {
          try {
            await captureServerOrder(data.orderId || data.orderID, 'PayPal SDK v6');
          } catch (err) {
            setStatus('');
            setErr(err?.message || 'Error capturando el pago con PayPal.');
          }
        },
        onCancel: () => setStatus(''),
        onError: (err) => {
          setStatus('');
          setErr(err?.message || 'Error procesando el pago con PayPal.');
        },
      });

      if (typeof ppSession.hasReturned === 'function' && ppSession.hasReturned()) {
        ppSession.resume().catch(() => {});
      }

      const ppBtn = document.createElement('paypal-button');
      ppBtn.setAttribute('type', 'pay');
      ppBtn.className = 'paypal-blue co-v6-el';
      ppBtn.addEventListener('click', () => {
        startWithPresentationCascade(ppSession, () => createServerOrder('auto'), 'order');
      });
      stack.appendChild(ppBtn);
    }

    // 5. PAY LATER BUTTON (<paypal-pay-later-button>)
    if (eligibleMethods.isEligible('paylater') && typeof sdkInstance.createPayLaterOneTimePaymentSession === 'function') {
      const plSession = sdkInstance.createPayLaterOneTimePaymentSession({
        onApprove: async (data) => {
          try {
            await captureServerOrder(data.orderId || data.orderID, 'PayPal Pay Later');
          } catch (err) {
            setStatus('');
            setErr(err?.message || 'Error capturando pago Pay Later.');
          }
        },
        onCancel: () => setStatus(''),
        onError: (err) => {
          setStatus('');
          setErr(err?.message || 'Error iniciando Pay Later.');
        },
      });
      const plDetails = eligibleMethods.getDetails?.('paylater') || {};
      const plBtn = document.createElement('paypal-pay-later-button');
      if (plDetails.countryCode) plBtn.setAttribute('country-code', plDetails.countryCode);
      if (plDetails.productCode) plBtn.setAttribute('product-code', plDetails.productCode);
      plBtn.className = 'paypal-gold co-v6-el';
      plBtn.addEventListener('click', () => {
        startWithPresentationCascade(plSession, () => createServerOrder('auto'), 'paylater');
      });
      stack.appendChild(plBtn);
    }

    // 6. PAYPAL CREDIT BUTTON (<paypal-credit-button>)
    if (eligibleMethods.isEligible('credit') && typeof sdkInstance.createPayPalCreditOneTimePaymentSession === 'function') {
      const crSession = sdkInstance.createPayPalCreditOneTimePaymentSession({
        onApprove: async (data) => {
          try {
            await captureServerOrder(data.orderId || data.orderID, 'PayPal Credit');
          } catch (err) {
            setStatus('');
            setErr(err?.message || 'Error capturando PayPal Credit.');
          }
        },
        onCancel: () => setStatus(''),
        onError: (err) => {
          setStatus('');
          setErr(err?.message || 'Error en PayPal Credit.');
        },
      });
      const crDetails = eligibleMethods.getDetails?.('credit') || {};
      const crBtn = document.createElement('paypal-credit-button');
      if (crDetails.countryCode) crBtn.setAttribute('country-code', crDetails.countryCode);
      crBtn.className = 'paypal-blue co-v6-el';
      crBtn.addEventListener('click', () => {
        startWithPresentationCascade(crSession, () => createServerOrder('auto'), 'credit');
      });
      stack.appendChild(crBtn);
    }

    // 7. VENMO BUTTON (<venmo-button>)
    if (eligibleMethods.isEligible('venmo') && typeof sdkInstance.createVenmoOneTimePaymentSession === 'function') {
      const venmoSession = sdkInstance.createVenmoOneTimePaymentSession({
        onApprove: async (data) => {
          try {
            await captureServerOrder(data.orderId || data.orderID, 'Venmo (PayPal v6)');
          } catch (err) {
            setStatus('');
            setErr(err?.message || 'Error capturando pago con Venmo.');
          }
        },
        onCancel: () => setStatus(''),
        onError: (err) => {
          setStatus('');
          setErr(err?.message || 'Error procesando Venmo.');
        },
      });
      const vBtn = document.createElement('venmo-button');
      vBtn.setAttribute('type', 'pay');
      vBtn.className = 'co-v6-el';
      vBtn.addEventListener('click', () => {
        startWithPresentationCascade(venmoSession, () => createServerOrder('auto'), 'venmo');
      });
      stack.appendChild(vBtn);
    }

    // 8. APPLE PAY (Safari / iOS / macOS when eligible)
    if (
      eligibleMethods.isEligible('applepay') &&
      window.ApplePaySession?.canMakePayments?.() &&
      typeof sdkInstance.createApplePayOneTimePaymentSession === 'function'
    ) {
      try {
        const appleSessionApi = await sdkInstance.createApplePayOneTimePaymentSession();
        const appleCfg = await appleSessionApi.config();
        if (appleCfg?.isEligible) {
          const apBtn = document.createElement('button');
          apBtn.type = 'button';
          apBtn.className = 'co-wallet-btn co-wallet-apple';
          apBtn.innerHTML = '<span>Pagar con  Pay</span>';
          apBtn.addEventListener('click', () => {
            try {
              const apReq = {
                countryCode: appleCfg.countryCode || 'US',
                currencyCode: 'USD',
                merchantCapabilities: appleCfg.merchantCapabilities || ['supports3DS'],
                supportedNetworks: appleCfg.supportedNetworks || ['visa', 'masterCard', 'amex'],
                total: { label: `Credo One · ${plan.display_name}`, amount: amountUsd, type: 'final' },
              };
              const session = new window.ApplePaySession(4, apReq);
              session.onvalidatemerchant = async (ev) => {
                try {
                  const res = await appleSessionApi.validateMerchant({ validationUrl: ev.validationURL });
                  session.completeMerchantValidation(res.merchantSession);
                } catch (e) {
                  session.abort();
                  setErr(e?.message || 'No se pudo validar Apple Pay.');
                }
              };
              session.onpaymentauthorized = async (ev) => {
                try {
                  const { orderId } = await createServerOrder('auto');
                  await appleSessionApi.confirmOrder({
                    orderId,
                    token: ev.payment.token,
                    billingContact: ev.payment.billingContact,
                  });
                  session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
                  await captureServerOrder(orderId, 'Apple Pay (PayPal v6)');
                } catch (e) {
                  session.completePayment(window.ApplePaySession.STATUS_FAILURE);
                  setErr(e?.message || 'Error completando pago con Apple Pay.');
                }
              };
              session.begin();
            } catch (e) {
              setErr(e?.message || 'Apple Pay no pudo iniciarse en este dispositivo.');
            }
          });
          stack.appendChild(apBtn);
        }
      } catch {}
    }

    // 9. GUEST DEBIT / CREDIT CARD BUTTON (<paypal-basic-card-button>)
    if (typeof sdkInstance.createPayPalGuestOneTimePaymentSession === 'function') {
      try {
        const guestSession = await sdkInstance.createPayPalGuestOneTimePaymentSession({
          onApprove: async (data) => {
            try {
              await captureServerOrder(data.orderId || data.orderID, 'Tarjeta (Guest PayPal v6)');
            } catch (err) {
              setStatus('');
              setErr(err?.message || 'Error capturando pago con tarjeta.');
            }
          },
          onCancel: () => setStatus(''),
          onError: (err) => {
            setStatus('');
            setErr(err?.message || 'Error en checkout con tarjeta.');
          },
        });
        if (seq !== state.mountSeq) return;
        if (guestSession && typeof guestSession.start === 'function') {
          const guestContainer = document.createElement('paypal-basic-card-container');
          guestContainer.className = 'co-v6-el';
          const guestBtn = document.createElement('paypal-basic-card-button');
          guestBtn.className = 'co-v6-el';
          guestBtn.addEventListener('click', () => {
            startWithPresentationCascade(guestSession, () => createServerOrder('auto'), 'guest_card');
          });
          guestContainer.appendChild(guestBtn);
          stack.appendChild(guestContainer);
        }
      } catch (guestErr) {
        console.warn('[credo-one] Guest card button unavailable:', guestErr?.message || guestErr);
      }
    }

    // 10. PCI-DSS INLINE CARD FIELDS — ONLY mount when merchant account has ACDC (advanced_cards) enabled!
    // Dominican Republic / non-ACDC accounts use <paypal-basic-card-button> & Smart Checkout seamlessly.
    if (
      cardWrap &&
      !eligibleMethods._fallback &&
      eligibleMethods.isEligible('advanced_cards') &&
      typeof sdkInstance.createCardFieldsOneTimePaymentSession === 'function'
    ) {
      try {
        const cardSession = sdkInstance.createCardFieldsOneTimePaymentSession();
        const cfStyle = {
          input: { color: '#09090B' },
          '.invalid': { color: '#DC2626' },
        };

        cardWrap.innerHTML = `
          <div class="co-cf-divider"><span>O paga directamente con tu tarjeta</span></div>
          <div class="co-cf-box">
            <div class="co-cf-head">
              <strong>Tarjeta de Débito o Crédito</strong>
              <span id="coCfBrand" class="co-cf-brand">Visa · Mastercard · Amex</span>
            </div>
            <div class="co-cf-grid">
              <div class="co-cf-slot co-cf-full"><label>Titular</label><div id="coCfName" class="co-cf-iframe-slot"></div></div>
              <div class="co-cf-slot co-cf-full"><label>Número de tarjeta</label><div id="coCfNumber" class="co-cf-iframe-slot"></div></div>
              <div class="co-cf-slot"><label>Vencimiento</label><div id="coCfExpiry" class="co-cf-iframe-slot"></div></div>
              <div class="co-cf-slot"><label>CVV / CVC</label><div id="coCfCvv" class="co-cf-iframe-slot"></div></div>
            </div>
            <button type="button" class="co-cta-btn co-cta-sapphire" id="coCfSubmitBtn" style="margin-top:12px">
              <span>Pagar ${app.esc(formatUsd(isAnnual ? plan.price_annual_cents : plan.price_monthly_cents))} USD con Tarjeta</span>
            </button>
          </div>
        `;

        const nameEl = cardSession.createCardFieldsComponent({ type: 'name', placeholder: 'Nombre del titular', style: cfStyle });
        const numEl = cardSession.createCardFieldsComponent({ type: 'number', placeholder: '0000 0000 0000 0000', style: cfStyle });
        const expEl = cardSession.createCardFieldsComponent({ type: 'expiry', placeholder: 'MM / AA', style: cfStyle });
        const cvvEl = cardSession.createCardFieldsComponent({ type: 'cvv', placeholder: 'CVV', style: cfStyle });

        cardWrap.querySelector('#coCfName')?.appendChild(nameEl);
        cardWrap.querySelector('#coCfNumber')?.appendChild(numEl);
        cardWrap.querySelector('#coCfExpiry')?.appendChild(expEl);
        cardWrap.querySelector('#coCfCvv')?.appendChild(cvvEl);

        numEl.addEventListener?.('cardtypechange', (ev) => {
          const nice = ev?.detail?.cards?.[0]?.niceType;
          const bEl = cardWrap.querySelector('#coCfBrand');
          if (bEl && nice) bEl.textContent = nice;
        });

        const cfBtn = cardWrap.querySelector('#coCfSubmitBtn');
        cfBtn?.addEventListener('click', async () => {
          setErr('');
          cfBtn.disabled = true;
          const span = cfBtn.querySelector('span');
          const origLabel = span?.textContent || '';
          if (span) span.textContent = 'Procesando tarjeta (3DS)…';
          try {
            const { orderId } = await createServerOrder('card');
            const submitRes = await cardSession.submit(orderId);
            if (submitRes?.state === 'failed' || submitRes?.state === 'canceled') {
              throw new Error('La tarjeta no pudo ser verificada o el proceso fue cancelado.');
            }
            await captureServerOrder(orderId, 'Tarjeta PCI (PayPal SDK v6)');
          } catch (err) {
            setErr(err?.message || 'No se pudo procesar el pago con tarjeta.');
            cfBtn.disabled = false;
            if (span) span.textContent = origLabel;
          }
        });

        cardWrap.hidden = false;
      } catch {
        cardWrap.hidden = true;
      }
    } else if (cardWrap) {
      cardWrap.hidden = true;
    }

    if (stack.children.length === 0) {
      throw new Error('NO_V6_BUTTONS_MOUNTED');
    }
  }

  // =========================================================================
  // ENGINE B: RESILIENT LIVE SMART CHECKOUT (Server-Side Orders v2 & Subs v1)
  // =========================================================================
  async function mountPayPalV5Fallback({ dlg, host, errBox, statusBox, msgSlot, noticeBox, sdkBadge, plan, seq }) {
    const isAnnual = state.cycle === 'annual';
    const amountUsd = ((isAnnual ? plan.price_annual_cents : plan.price_monthly_cents) / 100).toFixed(2);
    const ppPlanId = isAnnual ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
    const useSubscription = state.checkoutFlow === 'subscription' && Boolean(ppPlanId && state.paypal.subscriptions_ready);
    const getOrgName = () => dlg.querySelector('#coOrgName')?.value?.trim() || '';

    const setStatus = (msg) => {
      if (!statusBox) return;
      statusBox.textContent = msg || '';
      statusBox.hidden = !msg;
    };
    const setErr = (msg) => {
      if (!errBox) return;
      errBox.textContent = msg || '';
      errBox.hidden = !msg;
    };

    const paypal = await loadPayPalSdkV5Fallback(state.paypal.client_id, useSubscription ? 'subscription' : 'capture');
    if (seq !== state.mountSeq) return;

    if (sdkBadge) {
      const isSb = state.paypal?.effective_env === 'sandbox';
      sdkBadge.textContent = isSb ? 'PayPal Sandbox · Prueba' : 'PayPal Live · Activo';
      sdkBadge.classList.add(isSb ? 'is-sandbox' : 'is-live');
    }

    if (!useSubscription && msgSlot && Number(amountUsd) >= 30) {
      msgSlot.innerHTML = `<div data-pp-message data-pp-placement="payment" data-pp-amount="${app.esc(amountUsd)}" data-pp-style-layout="text" data-pp-style-text-color="white" data-pp-style-logo-type="inline"></div>`;
      msgSlot.hidden = false;
    } else if (msgSlot) {
      msgSlot.innerHTML = '';
      msgSlot.hidden = true;
    }

    host.innerHTML = '';
    host.classList.remove('co-paypal-host--v6');

    const buttonCfg = {
      style: {
        shape: 'pill',
        color: 'blue',
        layout: 'vertical',
        label: useSubscription ? 'subscribe' : 'pay',
        height: 46,
      },
      onClick: () => {
        setErr('');
        setStatus('Conectando con PayPal seguro…');
      },
      onCancel: () => {
        setStatus('');
      },
      onError: (err) => {
        setStatus('');
        const raw = err?.message || String(err || '');
        setErr(
          raw.includes('popup') || raw.includes('window')
            ? 'Tu navegador bloqueó la ventana emergente de PayPal. Permite ventanas emergentes para credoapp.tech e intenta de nuevo.'
            : raw || 'Error procesando el pago con PayPal.'
        );
      },
    };

    if (useSubscription) {
      buttonCfg.createSubscription = async () => {
        const res = await app.api('/api/v1/credo-one/paypal/subscriptions', {
          method: 'POST',
          body: {
            plan_sku: plan.sku,
            billing_cycle: state.cycle,
            organization_name: getOrgName(),
          },
        });
        return res.subscriptionId || res.id;
      };
      buttonCfg.onApprove = async (data) => {
        try {
          setStatus('Activando tu suscripción Credo One…');
          const res = await app.api('/api/v1/credo-one/subscriptions/confirm', {
            method: 'POST',
            body: {
              subscription_id: data.subscriptionID || data.subscriptionId,
              plan_sku: plan.sku,
              billing_cycle: state.cycle,
              organization_name: getOrgName(),
            },
          });
          setStatus('');
          await finalizeActivationSuccess(plan, res.subscription);
        } catch (err) {
          setStatus('');
          setErr(err?.message || 'No se pudo confirmar tu suscripción con Credo.');
        }
      };
    } else if (state.paypal.oauth_healthy) {
      buttonCfg.createOrder = async () => {
        const res = await app.api('/api/v1/credo-one/paypal/orders', {
          method: 'POST',
          body: {
            plan_sku: plan.sku,
            billing_cycle: state.cycle,
            payment_source: 'auto',
            organization_name: getOrgName(),
          },
        });
        return res.orderId || res.id;
      };
      buttonCfg.onApprove = async (data) => {
        try {
          setStatus('Capturando y verificando pago con núcleo F#…');
          const res = await app.api(`/api/v1/credo-one/paypal/orders/${encodeURIComponent(data.orderID || data.orderId)}/capture`, {
            method: 'POST',
            body: {
              plan_sku: plan.sku,
              billing_cycle: state.cycle,
              organization_name: getOrgName(),
              payment_method: 'PayPal Smart Checkout',
            },
          });
          setStatus('');
          await finalizeActivationSuccess(plan, res.subscription);
        } catch (err) {
          setStatus('');
          setErr(err?.message || 'No se pudo confirmar tu pago con Credo.');
        }
      };
    } else {
      buttonCfg.createOrder = (_data, actions) =>
        actions.order.create({
          intent: 'CAPTURE',
          application_context: {
            brand_name: 'Credo One',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
          purchase_units: [
            {
              description: `${plan.display_name} (${isAnnual ? 'Anual' : 'Mensual'}) · SKU ${plan.sku}`,
              custom_id: `${app.user?.id || 0}:${plan.sku}:${state.cycle}`,
              amount: { currency_code: 'USD', value: amountUsd },
            },
          ],
        });
      buttonCfg.onApprove = async (data, actions) => {
        try {
          setStatus('Capturando y verificando pago con núcleo F#…');
          const details = await actions.order.capture();
          const cap = details?.purchase_units?.[0]?.payments?.captures?.[0];
          const res = await app.api('/api/v1/credo-one/orders/confirm', {
            method: 'POST',
            body: {
              order_id: details?.id || data.orderID,
              capture_id: cap?.id || '',
              status: details?.status || cap?.status || 'COMPLETED',
              amount_value: cap?.amount?.value || amountUsd,
              plan_sku: plan.sku,
              billing_cycle: state.cycle,
              organization_name: getOrgName(),
            },
          });
          setStatus('');
          await finalizeActivationSuccess(plan, res.subscription);
        } catch (err) {
          setStatus('');
          setErr(err?.message || 'No se pudo confirmar tu pago con Credo.');
        }
      };
    }

    const buttons = paypal.Buttons(buttonCfg);
    if (buttons.isEligible && !buttons.isEligible()) {
      setErr('Los botones de PayPal no están disponibles para esta región o moneda.');
      return;
    }

    await buttons.render(host);

    if (noticeBox) {
      noticeBox.hidden = true;
    }
  }

  async function mountPayPalCheckout(dlg) {
    const host = dlg.querySelector('#coPayPalButtonsHost');
    const errBox = dlg.querySelector('#coPayPalError');
    const statusBox = dlg.querySelector('#coPayPalStatus');
    const msgSlot = dlg.querySelector('#coPayPalMessageSlot');
    const vaultRow = dlg.querySelector('#coPayPalVaultRow');
    const cardWrap = dlg.querySelector('#coCardFieldsSection');
    const noticeBox = dlg.querySelector('#coPayPalNotice');
    const sdkBadge = dlg.querySelector('#coSdkBadge');
    const plan = state.selectedPlan;
    if (!host || !plan || !state.paypal.client_id) return;

    const seq = ++state.mountSeq;

    try {
      const tokenData = await app.api('/api/v1/credo-one/paypal/client-token', { noCache: true });
      if (seq !== state.mountSeq) return;

      if (tokenData?.v6_ready && tokenData?.client_token) {
        try {
          await mountPayPalV6({
            dlg,
            host,
            errBox,
            statusBox,
            msgSlot,
            vaultRow,
            cardWrap,
            sdkBadge,
            tokenData,
            plan,
            seq,
          });
          return;
        } catch (v6Err) {
          console.warn('[credo-one] SDK v6 fallback to Live Smart Checkout:', v6Err?.message || v6Err);
          if (seq !== state.mountSeq) return;
        }
      }

      await mountPayPalV5Fallback({
        dlg,
        host,
        errBox,
        statusBox,
        msgSlot,
        noticeBox,
        sdkBadge,
        plan,
        seq,
      });
    } catch (err) {
      if (seq !== state.mountSeq) return;
      host.innerHTML = '';
      if (errBox) {
        errBox.textContent = err?.message || 'No se pudo inicializar PayPal.';
        errBox.hidden = false;
      }
    }
  }

  function renderSheet() {
    const dlg = getDialog();
    if (!dlg) return;

    const bodyHtml =
      state.view === 'checkout'
        ? renderCheckoutView()
        : state.view === 'enterprise'
          ? renderEnterpriseView()
          : state.view === 'success'
            ? renderSuccessView()
            : state.view === 'billing'
              ? renderBillingView()
              : renderPlansView();

    dlg.innerHTML = `
      <div class="co-sheet-surface">
        <div class="co-sheet-chrome" id="coDragHandle">
          <div class="co-drag-pill" aria-hidden="true"></div>
          <button type="button" class="co-close-circle" id="coCloseBtn" aria-label="Cerrar Credo One">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="co-sheet-scroll">
          ${bodyHtml}
        </div>
      </div>
    `;

    dlg.querySelector('#coCloseBtn')?.addEventListener('click', closeSheet);

    // Swipe-down to dismiss on the drag bar
    if (state.sheetCtrl) {
      state.sheetCtrl.destroy();
      state.sheetCtrl = null;
    }
    const handle = dlg.querySelector('#coDragHandle');
    const surface = dlg.querySelector('.co-sheet-surface');
    if (handle && surface) {
      state.sheetCtrl = attachDismissableSheet(surface, handle, {
        threshold: 110,
        onDismiss: () => closeSheet(),
      });
    }

    // Wire Segmented Control (User | Empresas)
    attachSegSpringPills(dlg);
    dlg.querySelectorAll('[data-co-audience]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.coAudience;
        if (next && next !== state.audience) {
          state.audience = next;
          renderSheet();
        }
      });
    });

    // Wire Billing Cycle Toggle (Mensual | Anual)
    dlg.querySelectorAll('[data-co-cycle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.coCycle;
        if (next && next !== state.cycle) {
          state.cycle = next;
          renderSheet();
        }
      });
    });

    // Wire Checkout Flow Tabs (Subscription | Direct/Card/Wallets)
    dlg.querySelectorAll('[data-co-flow]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.coFlow;
        if (next && next !== state.checkoutFlow) {
          state.checkoutFlow = next;
          renderSheet();
        }
      });
    });

    // Choose Plan -> Embedded Checkout Slide
    dlg.querySelectorAll('[data-choose-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.choosePlan;
        state.selectedPlan = state.plans.find((p) => p.sku === sku) || null;
        state.checkoutFlow = state.paypal.subscriptions_ready ? 'subscription' : 'direct';
        state.view = 'checkout';
        renderSheet();
      });
    });

    // Enterprise -> Executive Form Slide
    dlg.querySelectorAll('[data-select-enterprise]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedPlan = state.plans.find((p) => p.sku === 'biz_one_enterprise') || null;
        state.enterpriseSuccess = null;
        state.view = 'enterprise';
        renderSheet();
      });
    });

    // Open Billing & Movements View
    dlg.querySelector('#coOpenBillingBtn')?.addEventListener('click', () => {
      state.view = 'billing';
      loadMyBilling();
    });

    dlg.querySelector('#coChangePlanBtn')?.addEventListener('click', () => {
      state.view = 'plans';
      renderSheet();
    });

    dlg.querySelector('#coCancelMySubBtn')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Cancelando…';
      try {
        await app.api('/api/v1/credo-one/subscriptions/cancel', {
          method: 'POST',
          body: { reason: 'Cancelado por el usuario desde Mi Plan y Movimientos' },
        });
        await app.refreshSession?.();
        app.toast('Suscripción cancelada.');
        await loadMyBilling();
      } catch (err) {
        app.toast(err?.message || 'No se pudo cancelar la suscripción.');
        btn.disabled = false;
        btn.textContent = 'Cancelar plan';
      }
    });

    // Back to Plans
    dlg.querySelector('#coBackToPlans')?.addEventListener('click', () => {
      state.mountSeq += 1;
      state.view = 'plans';
      state.enterpriseSuccess = null;
      renderSheet();
    });

    // Checkout Login Gate
    dlg.querySelector('#coCheckoutLoginBtn')?.addEventListener('click', () => {
      closeSheet();
      app.openAuthModal();
    });

    // Success buttons
    dlg.querySelector('#coGoStudioBtn')?.addEventListener('click', () => {
      closeSheet();
      location.hash = '#/studio/overview';
    });
    dlg.querySelector('#coDoneBtn')?.addEventListener('click', () => {
      state.view = 'billing';
      loadMyBilling();
    });

    // Direct hosted PayPal.com redirect fallback (works even with strict popup/ad-blockers)
    const directPayBtn = dlg.querySelector('#coDirectHostedPayBtn');
    if (directPayBtn && state.selectedPlan && app.user) {
      directPayBtn.addEventListener('click', async () => {
        const plan = state.selectedPlan;
        const errBox = dlg.querySelector('#coPayPalError');
        const statusBox = dlg.querySelector('#coPayPalStatus');
        const orgName = dlg.querySelector('#coOrgName')?.value?.trim() || '';
        const isAnnual = state.cycle === 'annual';
        const ppPlanId = isAnnual ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
        const useSub = state.checkoutFlow === 'subscription' && Boolean(ppPlanId && state.paypal.subscriptions_ready);

        if (errBox) { errBox.hidden = true; errBox.textContent = ''; }
        if (statusBox) { statusBox.textContent = 'Generando enlace seguro de PayPal.com…'; statusBox.hidden = false; }
        directPayBtn.disabled = true;
        try {
          const endpoint = useSub ? '/api/v1/credo-one/paypal/subscriptions' : '/api/v1/credo-one/paypal/orders';
          const res = await app.api(endpoint, {
            method: 'POST',
            body: {
              plan_sku: plan.sku,
              billing_cycle: state.cycle,
              organization_name: orgName,
              ...(useSub ? {} : { payment_source: 'auto', vault: false }),
            },
          });
          if (!res?.approve_url) {
            throw new Error('PayPal no devolvió el enlace directo de aprobación.');
          }
          savePendingReturnMeta(plan, state.cycle, orgName, useSub ? 'subscription' : 'order');
          window.location.href = res.approve_url;
        } catch (err) {
          if (statusBox) { statusBox.hidden = true; statusBox.textContent = ''; }
          if (errBox) { errBox.textContent = err?.message || 'No se pudo abrir el pago directo en PayPal.'; errBox.hidden = false; }
          directPayBtn.disabled = false;
        }
      });
    }

    // Mount PayPal SDK v6 (or Live Smart Checkout fallback) if on checkout view
    if (state.view === 'checkout' && app.user && state.paypal.client_id) {
      mountPayPalCheckout(dlg);
    }

    // Wire Enterprise Executive Form with MWG post-interaction validation
    const entForm = dlg.querySelector('#coEnterpriseForm');
    if (entForm) {
      bindAccessibleFormValidation(entForm);
      entForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!entForm.checkValidity()) {
          const firstBad = entForm.querySelector(':invalid');
          firstBad?.focus();
          return;
        }
        const submitBtn = dlg.querySelector('#coEntSubmitBtn');
        const errBox = dlg.querySelector('#coEntSubmitErr');
        if (errBox) errBox.hidden = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.querySelector('span').textContent = 'Registrando solicitud…';
        }
        try {
          const fd = new FormData(entForm);
          const res = await app.api('/api/v1/credo-one/enterprise-leads', {
            method: 'POST',
            body: Object.fromEntries(fd.entries()),
          });
          state.enterpriseSuccess = {
            ...(res.lead || {}),
            whatsapp_url: res.whatsapp_url,
          };
          renderSheet();
        } catch (err) {
          if (errBox) {
            errBox.textContent = err.message || 'No se pudo enviar la solicitud.';
            errBox.hidden = false;
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.querySelector('span').textContent = 'Registrar Solicitud y Continuar por WhatsApp';
          }
        }
      });
    }
  }

  async function open({ audience = null, cycle = null, planSku = null, view = null } = {}) {
    const dlg = getDialog();
    if (!dlg) return;

    if (audience === 'user' || audience === 'business') state.audience = audience;
    if (cycle === 'monthly' || cycle === 'annual') state.cycle = cycle;
    const defaultView = view === 'billing' ? 'billing' : 'plans';
    state.view = defaultView;
    state.enterpriseSuccess = null;

    if (!state.loadedRemote) {
      renderSheet();
      showSheetSurface();
      await refreshPlans();
      if (planSku) {
        const match = state.plans.find((p) => p.sku === planSku);
        if (match) {
          state.audience = match.audience;
          state.selectedPlan = match;
          state.checkoutFlow = state.paypal.subscriptions_ready ? 'subscription' : 'direct';
          state.view = match.is_enterprise ? 'enterprise' : 'checkout';
        }
      } else if (state.view === 'billing') {
        await loadMyBilling();
        return;
      }
      renderSheet();
      return;
    }

    if (planSku) {
      const match = state.plans.find((p) => p.sku === planSku);
      if (match) {
        state.audience = match.audience;
        state.selectedPlan = match;
        state.checkoutFlow = state.paypal.subscriptions_ready ? 'subscription' : 'direct';
        state.view = match.is_enterprise ? 'enterprise' : 'checkout';
      }
    }
    renderSheet();
    showSheetSurface();
    if (state.view === 'billing') {
      loadMyBilling();
    }
  }

  return { open, close: closeSheet, refreshPlans, handlePayPalReturnIfPresent };
}
