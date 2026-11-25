// credo-one-sheet.js — Global Interactive Bottom Sheet "Familia Credo One"
// Native <dialog> + iOS Segmented Control + Embedded PayPal Subscriptions SDK + Enterprise Lead Form

import { attachDismissableSheet, attachSegSpringPills } from './springs.mjs?v=23';

// Zero critical prices or quotas hardcoded on the client:
// All plan prices, quotas, and limits are served exclusively from the compiled F# 8 kernel via /api/v1/credo-one/plans.
const INITIAL_PLANS = [];

let paypalSdkPromise = null;
let paypalLoadedClientId = '';

function loadPayPalSdk(clientId) {
  if (!clientId) return Promise.reject(new Error('PAYPAL_CLIENT_ID no configurado'));
  if (window.paypal && paypalLoadedClientId === clientId) {
    return Promise.resolve(window.paypal);
  }
  if (paypalSdkPromise && paypalLoadedClientId === clientId) {
    return paypalSdkPromise;
  }
  paypalLoadedClientId = clientId;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('credo-paypal-sdk');
    if (existing) existing.remove();
    const s = document.createElement('script');
    s.id = 'credo-paypal-sdk';
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=USD`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK no disponible')));
    s.onerror = () => reject(new Error('No se pudo cargar el SDK oficial de PayPal'));
    document.head.appendChild(s);
  });
  return paypalSdkPromise;
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
    selectedPlan: null,
    plans: INITIAL_PLANS,
    kernelSeal: '',
    paypal: { mode: 'sandbox', client_id: '', configured: false },
    enterpriseWhatsapp: '18095550199',
    enterpriseSuccess: null,
    activatedSub: null,
    sheetCtrl: null,
    loadedRemote: false,
  };

  const getDialog = () => document.getElementById('credoOneDialog');

  const formatUsd = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

  async function refreshPlans() {
    try {
      const data = await app.api('/api/v1/credo-one/plans');
      if (Array.isArray(data.plans) && data.plans.length > 0) {
        state.plans = data.plans;
      }
      if (data.kernel?.integrity_seal) state.kernelSeal = data.kernel.integrity_seal;
      if (data.paypal) state.paypal = data.paypal;
      if (data.enterprise_whatsapp) state.enterpriseWhatsapp = data.enterprise_whatsapp;
      state.loadedRemote = true;
    } catch {
      // Handled gracefully by retry button if offline
    }
  }

  function closeSheet() {
    const dlg = getDialog();
    if (!dlg || !dlg.open) return;
    if (state.sheetCtrl) {
      state.sheetCtrl.destroy();
      state.sheetCtrl = null;
    }
    app.closeDialogAnimated(dlg);
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
        <h1 class="co-sheet-title" id="coSheetTitle">Únete a Credo One</h1>
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
        <span>Pagos cifrados con PayPal Subscriptions · Precios y cuotas verificados por núcleo F#${state.kernelSeal ? ` (${app.esc(state.kernelSeal.slice(0, 8))})` : ''}.</span>
      </div>
    `;
  }

  function renderCheckoutView() {
    const plan = state.selectedPlan;
    if (!plan) return renderPlansView();
    const isAnnual = state.cycle === 'annual';
    const priceCents = isAnnual ? plan.price_annual_cents : plan.price_monthly_cents;
    const ppPlanId = isAnnual ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;

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
                <strong>${isAnnual ? 'Anual (2 meses gratis)' : 'Mensual recurrente'}</strong>
              </div>
              ${plan.monthly_impressions > 0 ? `
                <div class="co-summary-row">
                  <span>Bolsa mensual garantizada</span>
                  <strong>${Number(plan.monthly_impressions).toLocaleString('es-DO')} impresiones</strong>
                </div>` : ''}
              <div class="co-summary-row co-summary-total">
                <span>Total a facturar</span>
                <strong>${formatUsd(priceCents)} USD</strong>
              </div>
            </div>

            ${plan.audience === 'business' ? `
              <div class="co-field" style="margin-top:14px">
                <label for="coOrgName">Nombre comercial o institución</label>
                <input id="coOrgName" type="text" placeholder="Ej. Parroquia San José / Radio Aire 96 FM" value="${app.esc(app.user?.full_name ? `${app.user.full_name} · Institucional` : '')}" />
              </div>` : ''}
          </div>

          <div class="co-checkout-paybox">
            <h2 style="margin:0 0 6px;font-size:1.05rem;font-weight:700;color:#fff">Confirmación segura con PayPal</h2>
            <p class="co-card-sub" style="margin:0 0 16px">Activación instantánea con renovación automática protegida vía PayPal REST API.</p>

            ${!app.user ? `
              <div class="co-auth-prompt">
                <p>Inicia sesión o crea tu cuenta en Credo para vincular tu suscripción y desbloquear Credo One al instante.</p>
                <button type="button" class="co-cta-btn co-cta-sapphire" id="coCheckoutLoginBtn">Iniciar sesión en Credo</button>
              </div>
            ` : !state.paypal.configured || !ppPlanId ? `
              <div class="co-paypal-pending">
                <strong>Integración PayPal lista para activación de credenciales</strong>
                <p>El servidor aún no tiene configurado <code>PAYPAL_CLIENT_ID</code> o los planes sincronizados (<code>P-...</code>) en este entorno (${app.esc(state.paypal.mode)}).</p>
                <p class="co-hint-small">Ejecuta <code>npm run setup-paypal-plans</code> tras agregar <code>PAYPAL_CLIENT_ID</code> y <code>PAYPAL_CLIENT_SECRET</code> en las variables de entorno del VPS para renderizar aquí los botones oficiales de PayPal en 1 clic.</p>
              </div>
            ` : `
              <div id="coPayPalButtonsHost" class="co-paypal-host">
                <div class="co-paypal-loading">Cargando botones oficiales de PayPal…</div>
              </div>
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
          Tu suscripción está activa y tus beneficios ya se aplicaron a tu cuenta en tiempo real.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:20px">
          ${canStudio ? `
            <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;padding-inline:24px" id="coGoStudioBtn">
              <span>Abrir Credo One Studio</span>
            </button>` : ''}
          <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;padding-inline:22px" id="coDoneBtn">Continuar en Credo</button>
        </div>
      </div>
    `;
  }

  async function mountPayPalButtons(dlg) {
    const host = dlg.querySelector('#coPayPalButtonsHost');
    const errBox = dlg.querySelector('#coPayPalError');
    const plan = state.selectedPlan;
    if (!host || !plan || !state.paypal.client_id) return;

    const ppPlanId = state.cycle === 'annual' ? plan.paypal_plan_id_annual : plan.paypal_plan_id_monthly;
    if (!ppPlanId) return;

    try {
      const paypal = await loadPayPalSdk(state.paypal.client_id);
      host.innerHTML = '';
      paypal.Buttons({
        style: {
          shape: 'pill',
          color: 'blue',
          layout: 'vertical',
          label: 'subscribe',
        },
        createSubscription: (_data, actions) => {
          return actions.subscription.create({
            plan_id: ppPlanId,
            custom_id: `${app.user?.id || 0}:${plan.sku}:${state.cycle}`,
          });
        },
        onApprove: async (data) => {
          try {
            const orgName = dlg.querySelector('#coOrgName')?.value || '';
            const res = await app.api('/api/v1/credo-one/subscriptions/confirm', {
              method: 'POST',
              body: {
                subscription_id: data.subscriptionID,
                plan_sku: plan.sku,
                billing_cycle: state.cycle,
                organization_name: orgName,
              },
            });
            state.activatedSub = res.subscription;
            await app.refreshSession?.();
            state.view = 'success';
            renderSheet();
            app.toast(`${plan.display_name} activado`);
          } catch (err) {
            if (errBox) {
              errBox.textContent = err.message || 'No se pudo confirmar la suscripción';
              errBox.hidden = false;
            }
          }
        },
        onError: (err) => {
          if (errBox) {
            errBox.textContent = err?.message || 'Error procesando el pago con PayPal.';
            errBox.hidden = false;
          }
        },
      }).render(host);
    } catch (err) {
      host.innerHTML = '';
      if (errBox) {
        errBox.textContent = err.message;
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

    // Choose Plan -> Embedded Checkout Slide
    dlg.querySelectorAll('[data-choose-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.choosePlan;
        state.selectedPlan = state.plans.find((p) => p.sku === sku) || null;
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

    // Back to Plans
    dlg.querySelector('#coBackToPlans')?.addEventListener('click', () => {
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
    dlg.querySelector('#coDoneBtn')?.addEventListener('click', closeSheet);

    // Mount PayPal Buttons if on checkout view
    if (state.view === 'checkout' && app.user && state.paypal.configured) {
      mountPayPalButtons(dlg);
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

  async function open({ audience = null, cycle = null, planSku = null } = {}) {
    const dlg = getDialog();
    if (!dlg) return;

    if (audience === 'user' || audience === 'business') state.audience = audience;
    if (cycle === 'monthly' || cycle === 'annual') state.cycle = cycle;
    state.view = 'plans';
    state.enterpriseSuccess = null;

    if (!state.loadedRemote) {
      renderSheet();
      if (!dlg.open) dlg.showModal();
      await refreshPlans();
      if (planSku) {
        const match = state.plans.find((p) => p.sku === planSku);
        if (match) {
          state.audience = match.audience;
          state.selectedPlan = match;
          state.view = match.is_enterprise ? 'enterprise' : 'checkout';
        }
      }
      renderSheet();
      return;
    }

    if (planSku) {
      const match = state.plans.find((p) => p.sku === planSku);
      if (match) {
        state.audience = match.audience;
        state.selectedPlan = match;
        state.view = match.is_enterprise ? 'enterprise' : 'checkout';
      }
    }
    renderSheet();
    if (!dlg.open) dlg.showModal();
  }

  return { open, close: closeSheet, refreshPlans };
}
