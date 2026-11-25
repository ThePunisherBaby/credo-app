// views/studio.js — Credo One Studio (/studio/overview, /campaigns, /team, /billing)
// Dark OLED + Liquid Glass Command Center with RBAC, Live Mobile Preview Mockup & Interactive SVG Analytics

const ROLE_DESCRIPTIONS = {
  owner: 'Control absoluto, facturación PayPal, eliminación de cuenta y gestión de Admins.',
  admin: 'Configura perfil institucional, gestiona miembros (excepto Owner), aprueba y lanza campañas.',
  editor: 'Crea publicaciones, transmisiones En Vivo y borradores de campañas (requiere aprobación en Enterprise).',
  moderator: 'Responde y modera comentarios, mensajes y peticiones de oración de la comunidad.',
  analyst: 'Acceso exclusivo de solo lectura a métricas y exportación de reportes CSV/PDF.',
};

const CTA_PRESETS = [
  { id: 'whatsapp', label: 'Enviar WhatsApp', defaultText: 'Ir a WhatsApp', icon: '💬' },
  { id: 'web', label: 'Abrir Sitio Web', defaultText: 'Visitar Sitio Web', icon: '🌐' },
  { id: 'offering', label: 'Realizar Ofrenda / Aporte', defaultText: 'Ofrendar Ahora', icon: '🙏', proOnly: true },
  { id: 'event_register', label: 'Registro a Evento', defaultText: 'Registrarme al Evento', icon: '📅', proOnly: true },
  { id: 'lead_form', label: 'Formulario de Lead Nativo', defaultText: 'Solicitar Información', icon: '✦', enterpriseOnly: true },
];

const STATUS_LABELS = {
  active: 'Activa',
  pending_approval: 'En Revisión',
  scheduled: 'Programada',
  paused: 'Pausada',
  completed: 'Finalizada',
  rejected: 'Devuelta',
  draft: 'Borrador',
};

function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-DO');
}

function fmtUsd(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function buildSmoothAreaChart(series) {
  const pts = Array.isArray(series) && series.length > 0 ? series : [];
  if (pts.length === 0) {
    return `<div style="padding:36px;text-align:center;color:#9CA3AF;font-size:0.84rem">Aún no hay impresiones registradas en este rango. Lanza tu primera campaña para ver la curva en tiempo real.</div>`;
  }
  const W = 720;
  const H = 220;
  const padL = 36;
  const padR = 14;
  const padT = 18;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(
    10,
    ...pts.map((p) => Math.max(Number(p.organic || 0), Number(p.boosted || 0)))
  );

  const toX = (i) => padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const toY = (v) => padT + plotH - (Math.max(0, Number(v || 0)) / maxVal) * plotH;

  const makePath = (key) => {
    const coords = pts.map((p, i) => [toX(i), toY(p[key])]);
    if (coords.length === 1) {
      return { line: `M ${coords[0][0]} ${coords[0][1]}`, area: '' };
    }
    let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1];
      const [x1, y1] = coords[i];
      const cx = ((x0 + x1) / 2).toFixed(1);
      d += ` C ${cx} ${y0.toFixed(1)}, ${cx} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    const base = (padT + plotH).toFixed(1);
    const area = `${d} L ${coords[coords.length - 1][0].toFixed(1)} ${base} L ${coords[0][0].toFixed(1)} ${base} Z`;
    return { line: d, area };
  };

  const boosted = makePath('boosted');
  const organic = makePath('organic');

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = (padT + plotH * (1 - t)).toFixed(1);
    const val = Math.round(maxVal * t);
    return `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
      <text x="${padL - 6}" y="${Number(y) + 3}" text-anchor="end" fill="#6B7280" font-size="10">${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}</text>
    `;
  }).join('');

  const step = Math.max(1, Math.floor(pts.length / 6));
  const xLabels = pts
    .map((p, i) => (i % step === 0 || i === pts.length - 1
      ? `<text x="${toX(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#6B7280" font-size="10">${String(p.date || '').slice(5)}</text>`
      : ''))
    .join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva comparativa de impresiones orgánicas e impulsadas">
      <defs>
        <linearGradient id="studioBoostGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.38" />
          <stop offset="100%" stop-color="#0A84FF" stop-opacity="0.01" />
        </linearGradient>
        <linearGradient id="studioOrgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#D4AF37" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#D4AF37" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${organic.area ? `<path d="${organic.area}" fill="url(#studioOrgGrad)" />` : ''}
      ${boosted.area ? `<path d="${boosted.area}" fill="url(#studioBoostGrad)" />` : ''}
      <path d="${organic.line}" fill="none" stroke="#D4AF37" stroke-width="2" stroke-linecap="round" />
      <path d="${boosted.line}" fill="none" stroke="#38BDF8" stroke-width="2.4" stroke-linecap="round" />
      ${xLabels}
    </svg>
  `;
}

export async function mount({ root, app, signal, params }) {
  document.body.classList.add('is-studio-mode');

  if (!app.user) {
    root.innerHTML = `
      <div class="studio-glass-panel" style="padding:36px 24px;text-align:center;max-width:560px;margin:28px auto">
        <span class="co-badge-gold">Credo One Studio</span>
        <h1 class="co-sheet-title" style="margin-top:12px">Inicia sesión para entrar a Studio</h1>
        <p class="co-sheet-subtitle" style="margin-bottom:20px">Administra tus campañas, métricas en tiempo real, equipo multinivel y facturación de Familia Credo One.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;padding-inline:22px" id="studioLoginBtn">Iniciar sesión</button>
          <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;padding-inline:20px" id="studioPlansBtn">Ver planes Credo One</button>
        </div>
      </div>
    `;
    root.querySelector('#studioLoginBtn')?.addEventListener('click', () => app.openAuthModal());
    root.querySelector('#studioPlansBtn')?.addEventListener('click', () => app.openCredoOne({ audience: 'business' }));
    return {
      cleanup() {
        document.body.classList.remove('is-studio-mode');
      },
    };
  }

  root.innerHTML = `<div class="studio-glass-panel" style="padding:32px"><div class="skeleton" style="height:260px;border-radius:16px"></div></div>`;

  const state = {
    section: ['overview', 'campaigns', 'team', 'billing'].includes(params?.section) ? params.section : 'overview',
    orgs: [],
    activeOrgId: null,
    range: 30,
    campStatusFilter: 'all',
    campSearch: '',
    creatorOpen: false,
    teamSubtab: 'members', // 'members' | 'approvals' | 'audit'
    overviewData: null,
    campaignsData: null,
    teamData: null,
    approvalsData: null,
    auditData: null,
    billingData: null,
    draft: {
      post_id: '',
      title: 'Acompáñanos en nuestra transmisión especial',
      body: 'Conéctate hoy con nuestra comunidad, comparte tus intenciones y descubre nuestras actividades semanales.',
      media_url: '/icons/art_gospel.jpg',
      cta_type: 'whatsapp',
      cta_label: 'Ir a WhatsApp',
      cta_url: 'https://wa.me/18095550199',
      target_country: 'DO',
      target_city: 'Santo Domingo',
      target_category: 'general',
      impressions_allocated: 5000,
    },
  };

  const getActiveOrg = () => state.orgs.find((o) => o.id === state.activeOrgId) || state.orgs[0] || null;

  async function loadContext() {
    const ctx = await app.api('/api/v1/studio/context', { signal });
    state.orgs = ctx.organizations || [];
    if (!state.activeOrgId && state.orgs[0]) {
      state.activeOrgId = state.orgs[0].id;
    }
    return ctx;
  }

  async function loadSectionData() {
    const org = getActiveOrg();
    if (!org) return;
    const oid = org.id;
    if (state.section === 'overview') {
      state.overviewData = await app.api(`/api/v1/studio/overview?org_id=${oid}&range=${state.range}`, { signal });
    } else if (state.section === 'campaigns') {
      const qs = new URLSearchParams({ org_id: String(oid), status: state.campStatusFilter, q: state.campSearch });
      state.campaignsData = await app.api(`/api/v1/studio/campaigns?${qs}`, { signal });
    } else if (state.section === 'team') {
      const [teamRes, appRes] = await Promise.all([
        app.api(`/api/v1/studio/team?org_id=${oid}`, { signal }),
        app.api(`/api/v1/studio/approvals?org_id=${oid}`, { signal }).catch(() => ({ approvals: [] })),
      ]);
      state.teamData = teamRes;
      state.approvalsData = appRes;
      if (org.plan?.audit_logs_enabled) {
        state.auditData = await app.api(`/api/v1/studio/audit-logs?org_id=${oid}`, { signal }).catch(() => ({ logs: [] }));
      }
    } else if (state.section === 'billing') {
      state.billingData = await app.api(`/api/v1/studio/billing?org_id=${oid}`, { signal });
    }
  }

  function renderUpgradeGate() {
    root.innerHTML = `
      <div class="studio-glass-panel" style="padding:36px 24px;text-align:center;max-width:620px;margin:24px auto">
        <span class="co-badge-gold">Credo One Studio</span>
        <h1 class="co-sheet-title" style="margin-top:12px">Desbloquea Credo One Studio</h1>
        <p class="co-sheet-subtitle" style="margin-bottom:22px">
          El Centro de Comando Profesional con analíticas, campañas patrocinadas, gestión de equipo multinivel y facturación está disponible desde <strong>User One Pro</strong> y planes <strong>Empresas</strong>.
        </p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;padding-inline:24px" id="gateOpenBiz">Ver Planes Empresas</button>
          <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;padding-inline:22px" id="gateOpenUser">Ver User One Pro</button>
        </div>
      </div>
    `;
    root.querySelector('#gateOpenBiz')?.addEventListener('click', () => app.openCredoOne({ audience: 'business' }));
    root.querySelector('#gateOpenUser')?.addEventListener('click', () => app.openCredoOne({ audience: 'user' }));
  }

  function renderOverviewModule(org) {
    const d = state.overviewData;
    if (!d) return `<div class="studio-glass-panel" style="padding:28px"><div class="skeleton" style="height:200px"></div></div>`;
    const k = d.kpis;
    const fmtDelta = (v) => `${v >= 0 ? '+' : ''}${v}% vs 30d ant.`;

    return `
      <div class="studio-kpi-grid">
        <div class="studio-glass-panel studio-kpi-card">
          <span class="studio-kpi-label">Impresiones Totales Entregadas</span>
          <strong class="studio-kpi-val">${fmtNum(k.impressions.value)}</strong>
          <span class="studio-kpi-delta${k.impressions.delta_pct < 0 ? ' is-neg' : ''}">${fmtDelta(k.impressions.delta_pct)}</span>
        </div>
        <div class="studio-glass-panel studio-kpi-card">
          <span class="studio-kpi-label">Clics en Botones CTA</span>
          <strong class="studio-kpi-val">${fmtNum(k.clicks.value)}</strong>
          <span class="studio-kpi-delta${k.clicks.delta_pct < 0 ? ' is-neg' : ''}">${fmtDelta(k.clicks.delta_pct)}</span>
        </div>
        <div class="studio-glass-panel studio-kpi-card">
          <span class="studio-kpi-label">Tasa de Conversión Media (CTR)</span>
          <strong class="studio-kpi-val">${k.ctr.value}%</strong>
          <span class="studio-kpi-delta${k.ctr.delta_pct < 0 ? ' is-neg' : ''}">${k.ctr.delta_pct >= 0 ? '+' : ''}${k.ctr.delta_pct} pts</span>
        </div>
        <div class="studio-glass-panel studio-kpi-card">
          <span class="studio-kpi-label">Alcance Único · Pico En Vivo</span>
          <strong class="studio-kpi-val">${fmtNum(k.reach.value)}</strong>
          <span class="studio-kpi-delta">🔴 ${fmtNum(k.reach.live_peak)} oyentes pico</span>
        </div>
      </div>

      <section class="studio-glass-panel studio-chart-card">
        <div class="studio-chart-head">
          <div>
            <h2 style="margin:0;font-size:1.02rem;font-weight:800">Impresiones Orgánicas vs. Impulsadas Credo One</h2>
            <div class="studio-chart-legend" style="margin-top:6px">
              <span><i class="studio-dot" style="background:#38BDF8"></i>Impulsadas Credo One</span>
              <span><i class="studio-dot" style="background:#D4AF37"></i>Orgánicas</span>
            </div>
          </div>
          <div class="co-cycle-switch" role="group" aria-label="Rango de días">
            ${[7, 30, 90].map((r) => `
              <button type="button" class="co-cycle-btn${state.range === r ? ' is-active' : ''}" data-studio-range="${r}">${r}D</button>
            `).join('')}
          </div>
        </div>
        <div class="studio-svg-wrap">${buildSmoothAreaChart(d.series)}</div>
      </section>

      <section class="studio-glass-panel" style="padding:18px">
        <div class="co-table-wrap" tabindex="0" role="region" aria-labelledby="topCampCaption">
          <table class="co-table">
            <caption id="topCampCaption">Top 5 Campañas por Conversión</caption>
            <thead>
              <tr>
                <th>Campaña</th>
                <th>CTA</th>
                <th>Estado</th>
                <th>Impresiones</th>
                <th>Clics</th>
                <th>CTR</th>
              </tr>
            </thead>
            <tbody>
              ${(d.top_campaigns || []).length === 0 ? `
                <tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:22px">Aún no has creado campañas en ${app.esc(org.name)}.</td></tr>
              ` : d.top_campaigns.map((c) => `
                <tr>
                  <th scope="row">${app.esc(c.title)}</th>
                  <td data-label="CTA">${app.esc(c.cta_label || c.cta_type)}</td>
                  <td data-label="Estado"><span class="co-status-pill co-status-${app.esc(c.status)}">${app.esc(STATUS_LABELS[c.status] || c.status)}</span></td>
                  <td data-label="Impresiones">${fmtNum(c.impressions_served)} / ${fmtNum(c.impressions_allocated)}</td>
                  <td data-label="Clics">${fmtNum(c.clicks_count)}</td>
                  <td data-label="CTR"><strong>${c.ctr}%</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPhonePreviewHtml(org) {
    const d = state.draft;
    const isEnt = Boolean(org.plan?.is_enterprise);
    return `
      <div class="studio-phone-frame" aria-label="Vista previa móvil en tiempo real">
        <div class="studio-phone-notch" aria-hidden="true"></div>
        <div class="studio-preview-card">
          <div class="studio-preview-head">
            <div class="studio-preview-av${isEnt ? ' studio-preview-av--square' : ''}" style="background:${app.esc(org.avatar_color || '#0A84FF')}">
              ${org.avatar_url ? `<img src="${app.esc(org.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover" />` : app.initials(org.name)}
            </div>
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                <strong style="font-size:0.82rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${app.esc(org.name)}</strong>
                ${isEnt ? '<span class="co-badge-gold" style="padding:1px 6px;font-size:0.6rem">✦ Enterprise</span>' : '<span class="ig-sponsored-pill" style="padding:1px 6px;font-size:0.6rem">✓ Verificado</span>'}
              </div>
              <span class="ig-sponsored-pill${isEnt ? ' ig-sponsored-pill--gold' : ''}" style="margin-top:2px">Patrocinado · ${app.esc(d.target_country === 'ALL' ? 'Global' : d.target_country)}</span>
            </div>
          </div>

          <div class="studio-preview-media">
            ${d.media_url ? `<img src="${app.esc(d.media_url)}" alt="Vista previa" />` : '<span>Sin imagen adjunta</span>'}
          </div>

          <div class="studio-preview-cta${isEnt ? ' studio-preview-cta--gold' : ''}">
            <span>${app.esc(d.cta_label || 'Más información')}</span>
            <span>↗</span>
          </div>

          <div style="padding:10px 12px 13px">
            <strong style="display:block;font-size:0.84rem;color:#fff;margin-bottom:4px">${app.esc(d.title || 'Título de tu campaña')}</strong>
            <p style="margin:0;font-size:0.76rem;color:#9CA3AF;line-height:1.4">${app.esc((d.body || '').slice(0, 140))}${(d.body || '').length > 140 ? '…' : ''}</p>
          </div>
        </div>
        <div style="text-align:center;margin-top:10px;font-size:0.7rem;color:#9CA3AF">
          Cuota asignada: <strong style="color:#fff">${fmtNum(d.impressions_allocated)} impresiones</strong>
        </div>
      </div>
    `;
  }

  function renderCampaignsModule(org) {
    const data = state.campaignsData || { campaigns: [], available_posts: [] };
    const plan = org.plan || {};
    const maxSlider = Math.max(500, org.impressions_available || plan.monthly_impressions || 5000);
    if (state.draft.impressions_allocated > maxSlider) state.draft.impressions_allocated = maxSlider;

    if (state.creatorOpen) {
      return `
        <div class="studio-glass-panel" style="padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <div>
              <h2 style="margin:0;font-size:1.15rem;font-weight:800">Creador de Campaña con Previsualización</h2>
              <p style="margin:4px 0 0;font-size:0.8rem;color:#9CA3AF">Configura tu anuncio a la izquierda y observa el resultado real dentro del feed en vivo.</p>
            </div>
            <button type="button" class="co-back-btn" style="margin:0" id="closeCreatorBtn">← Volver a campañas</button>
          </div>

          <div class="studio-creator-split">
            <form id="studioCreateCampaignForm" style="display:flex;flex-direction:column;gap:14px">
              ${data.available_posts.length > 0 ? `
                <div class="co-field">
                  <label for="campSourcePost">Impulsar publicación existente (opcional)</label>
                  <select id="campSourcePost" name="post_id">
                    <option value="">— Redactar nuevo anuncio multimedia —</option>
                    ${data.available_posts.map((p) => `<option value="${p.id}"${String(state.draft.post_id) === String(p.id) ? ' selected' : ''}>${app.esc((p.title || p.content || '').slice(0, 68))}</option>`).join('')}
                  </select>
                </div>` : ''}

              <div class="co-field">
                <label for="campTitle">Título del anuncio *</label>
                <input id="campTitle" name="title" required value="${app.esc(state.draft.title)}" placeholder="Ej. Gran Concierto Católico 2026" />
              </div>

              <div class="co-field">
                <label for="campBody">Texto principal</label>
                <textarea id="campBody" name="body" rows="3" placeholder="Describe tu mensaje, horario o invitación...">${app.esc(state.draft.body)}</textarea>
              </div>

              <div class="co-field">
                <label for="campMedia">URL de Imagen o Arte</label>
                <input id="campMedia" name="media_url" value="${app.esc(state.draft.media_url)}" placeholder="/icons/art_gospel.jpg o https://..." />
              </div>

              <div class="co-form-grid">
                <div class="co-field">
                  <label for="campCtaType">Objetivo y Botón CTA</label>
                  <select id="campCtaType" name="cta_type">
                    ${CTA_PRESETS.map((cta) => {
                      const lockedEnt = cta.enterpriseOnly && !plan.is_enterprise;
                      const lockedPro = cta.proOnly && ['user_one_pro', 'biz_one_plus'].includes(plan.plan_sku);
                      const disabled = lockedEnt || lockedPro;
                      return `<option value="${cta.id}"${state.draft.cta_type === cta.id ? ' selected' : ''}${disabled ? ' disabled' : ''}>${cta.icon} ${cta.label}${lockedEnt ? ' [Solo Enterprise]' : lockedPro ? ' [Solo Pro+]' : ''}</option>`;
                    }).join('')}
                  </select>
                </div>

                <div class="co-field">
                  <label for="campCtaLabel">Texto del botón</label>
                  <input id="campCtaLabel" name="cta_label" value="${app.esc(state.draft.cta_label)}" placeholder="Ej. Ir a WhatsApp" />
                </div>

                <div class="co-field">
                  <label for="campCtaUrl">URL destino / WhatsApp</label>
                  <input id="campCtaUrl" name="cta_url" value="${app.esc(state.draft.cta_url)}" placeholder="https://wa.me/1809... o https://..." />
                </div>

                <div class="co-field">
                  <label for="campCountry">Segmentación por País</label>
                  <select id="campCountry" name="target_country">
                    <option value="ALL"${state.draft.target_country === 'ALL' ? ' selected' : ''}>Global (Todos los países)</option>
                    <option value="DO"${state.draft.target_country === 'DO' ? ' selected' : ''}>República Dominicana (DO)</option>
                    <option value="US"${state.draft.target_country === 'US' ? ' selected' : ''}>Estados Unidos (US)</option>
                    <option value="ES"${state.draft.target_country === 'ES' ? ' selected' : ''}>España (ES)</option>
                    <option value="MX"${state.draft.target_country === 'MX' ? ' selected' : ''}>México (MX)</option>
                    <option value="CO"${state.draft.target_country === 'CO' ? ' selected' : ''}>Colombia (CO)</option>
                  </select>
                </div>

                <div class="co-field">
                  <label for="campCity">Ciudad / Provincia</label>
                  <input id="campCity" name="target_city" value="${app.esc(state.draft.target_city)}" placeholder="Ej. Santo Domingo, Santiago" />
                </div>

                <div class="co-field">
                  <label for="campEnd">Fecha de finalización (opcional)</label>
                  <input id="campEnd" name="ends_at" type="date" />
                </div>
              </div>

              <div class="co-field">
                <label for="campSlider">Cuota de Impresiones a Asignar: <strong id="campSliderVal" style="color:#38BDF8">${fmtNum(state.draft.impressions_allocated)}</strong> / ${fmtNum(maxSlider)} disponibles</label>
                <input id="campSlider" name="impressions_allocated" type="range" min="500" max="${maxSlider}" step="500" value="${state.draft.impressions_allocated}" style="padding:0;accent-color:#0A84FF" />
              </div>

              <div id="studioCampErr" class="co-inline-error" hidden></div>

              <button type="submit" class="co-cta-btn ${plan.is_enterprise ? 'co-cta-gold' : 'co-cta-sapphire'}" id="submitCampaignBtn">
                <span>${org.my_role === 'editor' && (plan.is_enterprise || org.approval_required) ? 'Enviar a Cola de Aprobación' : 'Lanzar Campaña Ahora'}</span>
              </button>
            </form>

            <div id="studioPhonePreviewHost">
              ${renderPhonePreviewHtml(org)}
            </div>
          </div>
        </div>
      `;
    }

    const filterTabs = [
      ['all', 'Todas'],
      ['active', 'Activas'],
      ['pending_approval', 'Pendientes de Aprobación'],
      ['scheduled', 'Programadas'],
      ['completed', 'Finalizadas'],
    ];

    return `
      <div class="studio-glass-panel" style="padding:18px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${filterTabs.map(([id, lbl]) => `
              <button type="button" class="co-cycle-btn${state.campStatusFilter === id ? ' is-active' : ''}" data-camp-filter="${id}">${lbl}</button>
            `).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="search" id="studioCampSearch" value="${app.esc(state.campSearch)}" placeholder="Buscar campaña…" style="padding:8px 12px;border-radius:10px;background:#09090B;border:1px solid rgba(255,255,255,0.12);color:#fff;font-size:0.82rem" />
            ${['owner', 'admin', 'editor'].includes(org.my_role) ? `
              <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;min-height:38px;padding:6px 14px" id="openCreatorBtn2">+ Nueva Campaña</button>
            ` : ''}
          </div>
        </div>

        <div class="co-table-wrap" tabindex="0" role="region" aria-labelledby="campTableCap">
          <table class="co-table">
            <caption id="campTableCap">Campañas de ${app.esc(org.name)}</caption>
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Objetivo</th>
                <th>Progreso de Impresiones</th>
                <th>Clics / CTR</th>
                <th>Estado</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              ${data.campaigns.length === 0 ? `
                <tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:24px">No hay campañas en esta vista.</td></tr>
              ` : data.campaigns.map((c) => {
                const pct = Math.min(100, Math.round((Number(c.impressions_served || 0) / Math.max(1, Number(c.impressions_allocated || 1))) * 100));
                const canToggle = ['owner', 'admin'].includes(org.my_role) && ['active', 'paused', 'scheduled'].includes(c.status);
                return `
                  <tr>
                    <th scope="row">
                      <div style="display:flex;align-items:center;gap:10px">
                        ${c.media_url ? `<img src="${app.esc(c.media_url)}" alt="" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0" />` : ''}
                        <span>${app.esc(c.title)}</span>
                      </div>
                    </th>
                    <td data-label="Objetivo">${app.esc(c.cta_label || c.cta_type)}</td>
                    <td data-label="Impresiones">
                      <div style="min-width:130px">
                        <div style="font-size:0.75rem;margin-bottom:4px">${fmtNum(c.impressions_served)} / ${fmtNum(c.impressions_allocated)} (${pct}%)</div>
                        <div class="studio-pool-track"><div class="studio-pool-fill" style="width:${pct}%"></div></div>
                      </div>
                    </td>
                    <td data-label="Clics / CTR">${fmtNum(c.clicks_count)} · <strong>${c.ctr}%</strong></td>
                    <td data-label="Estado"><span class="co-status-pill co-status-${app.esc(c.status)}">${app.esc(STATUS_LABELS[c.status] || c.status)}</span></td>
                    <td data-label="Control">
                      ${canToggle ? `
                        <button type="button" class="co-cycle-btn is-active" data-toggle-camp="${c.id}">
                          ${c.status === 'active' ? 'Pausar' : 'Activar'}
                        </button>` : '<span style="color:#6B7280;font-size:0.76rem">—</span>'}
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderTeamModule(org) {
    const t = state.teamData || { members: [], seats_used: 1, max_seats: 1 };
    const approvals = state.approvalsData?.approvals || [];
    const logs = state.auditData?.logs || [];
    const atLimit = t.max_seats > 0 && t.seats_used >= t.max_seats;
    const seatLabel = t.max_seats < 0 ? `${t.seats_used} administradores activos (Ilimitados — Enterprise)` : `${t.seats_used} de ${t.max_seats} administradores en uso — ${t.plan_name || 'Credo One'}`;

    return `
      <div class="studio-glass-panel" style="padding:18px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <h2 style="margin:0;font-size:1.1rem;font-weight:800">Equipo, Permisos RBAC y Auditoría</h2>
            <p style="margin:4px 0 0;font-size:0.82rem;color:#9CA3AF">${app.esc(seatLabel)}</p>
          </div>
          ${['owner', 'admin'].includes(org.my_role) ? (
            atLimit
              ? `<button type="button" class="co-cta-btn co-cta-gold" style="width:auto;min-height:38px;padding:6px 16px" id="studioSeatUpgradeBtn">🔒 Ampliar Asientos (Upgrade)</button>`
              : `<button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;min-height:38px;padding:6px 16px" id="studioInviteBtn">+ Invitar Miembro</button>`
          ) : ''}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="co-cycle-btn${state.teamSubtab === 'members' ? ' is-active' : ''}" data-team-tab="members">Equipo y Roles</button>
          <button type="button" class="co-cycle-btn${state.teamSubtab === 'approvals' ? ' is-active' : ''}" data-team-tab="approvals">Cola de Aprobación (${approvals.filter((a) => a.status === 'pending').length})</button>
          <button type="button" class="co-cycle-btn${state.teamSubtab === 'audit' ? ' is-active' : ''}" data-team-tab="audit">Audit Logs ${org.plan?.audit_logs_enabled ? '✦' : '🔒'}</button>
        </div>

        ${state.teamSubtab === 'members' ? `
          <div class="co-table-wrap" tabindex="0" role="region" aria-labelledby="teamTableCap">
            <table class="co-table">
              <caption id="teamTableCap">Miembros de ${app.esc(org.name)}</caption>
              <thead>
                <tr>
                  <th>Usuario / Correo</th>
                  <th>Rol RBAC</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${t.members.map((m) => `
                  <tr>
                    <th scope="row">
                      <div>${app.esc(m.full_name || m.invited_email)}</div>
                      <small style="color:#9CA3AF;font-weight:500">${app.esc(m.email || m.invited_email)}</small>
                    </th>
                    <td data-label="Rol">
                      <span class="studio-role-badge${m.role === 'owner' ? ' studio-role-badge--owner' : ''}">${app.esc(m.role)}</span>
                    </td>
                    <td data-label="Estado"><span class="co-status-pill co-status-${m.status === 'active' ? 'active' : 'pending_approval'}">${m.status === 'active' ? 'Activo' : 'Invitado'}</span></td>
                    <td data-label="Acciones">
                      ${m.role !== 'owner' && ['owner', 'admin'].includes(org.my_role) ? `
                        <button type="button" class="co-cycle-btn" style="color:#FCA5A5" data-remove-member="${m.id}">Revocar</button>
                      ` : '<span style="color:#6B7280;font-size:0.75rem">Protegido</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:10px">
            ${Object.entries(ROLE_DESCRIPTIONS).map(([r, desc]) => `
              <div style="padding:12px;border-radius:14px;background:rgba(9,9,11,0.55);border:1px solid rgba(255,255,255,0.06)">
                <span class="studio-role-badge${r === 'owner' ? ' studio-role-badge--owner' : ''}" style="margin-bottom:6px;display:inline-block">${r}</span>
                <p style="margin:4px 0 0;font-size:0.75rem;color:#9CA3AF;line-height:1.4">${desc}</p>
              </div>`).join('')}
          </div>
        ` : state.teamSubtab === 'approvals' ? `
          ${approvals.length === 0 ? `
            <div style="padding:28px;text-align:center;color:#9CA3AF;font-size:0.86rem">No hay envíos pendientes en la Cola de Aprobación.</div>
          ` : approvals.map((a) => `
            <div style="padding:16px;border-radius:16px;background:rgba(9,9,11,0.65);border:1px solid rgba(255,255,255,0.08);display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:center">
              <div style="flex:1;min-width:220px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                  <span class="co-status-pill co-status-${a.status === 'pending' ? 'pending_approval' : a.status === 'approved' ? 'active' : 'rejected'}">${app.esc(a.status)}</span>
                  <strong style="font-size:0.94rem">${app.esc(a.campaign_title || 'Campaña')}</strong>
                </div>
                <p style="margin:0;font-size:0.8rem;color:#9CA3AF">${app.esc((a.campaign_body || '').slice(0, 160))}</p>
                <small style="color:#6B7280">Enviado por ${app.esc(a.submitted_by_name || 'Editor')} · ${fmtNum(a.impressions_allocated)} impresiones</small>
                ${a.reviewer_note ? `<div style="margin-top:6px;font-size:0.78rem;color:#FCD34D">Nota: ${app.esc(a.reviewer_note)}</div>` : ''}
              </div>
              ${a.status === 'pending' && ['owner', 'admin'].includes(org.my_role) ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;min-height:36px;padding:6px 14px" data-approve-id="${a.id}">Aprobar y Publicar</button>
                  <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;min-height:36px;padding:6px 14px" data-return-id="${a.id}">Devolver con Nota</button>
                </div>` : ''}
            </div>`).join('')}
        ` : !org.plan?.audit_logs_enabled ? `
          <div style="padding:28px;text-align:center;border-radius:16px;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.32)">
            <span class="co-badge-gold">Exclusivo Credo One Enterprise</span>
            <h3 style="margin:10px 0 6px">Registro de Auditoría Inmutable (Audit Logs)</h3>
            <p style="margin:0 0 16px;color:#9CA3AF;font-size:0.84rem">Registra usuario, rol, acción exacta, recurso afectado, IP y marca de tiempo de cada cambio corporativo.</p>
            <button type="button" class="co-cta-btn co-cta-gold" style="width:auto;padding-inline:20px" id="auditUpgradeBtn">Solicitar Credo One Enterprise</button>
          </div>
        ` : `
          <div class="co-table-wrap" tabindex="0" role="region" aria-labelledby="auditCap">
            <table class="co-table">
              <caption id="auditCap">Registro Cronológico Inmutable (Audit Logs)</caption>
              <thead>
                <tr>
                  <th>Fecha / Hora</th>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Acción</th>
                  <th>Recurso</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                ${logs.length === 0 ? `
                  <tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:22px">Aún no hay eventos registrados.</td></tr>
                ` : logs.map((lg) => `
                  <tr>
                    <th scope="row">${new Date(lg.created_at).toLocaleString('es-DO')}</th>
                    <td data-label="Usuario">${app.esc(lg.actor_name)}</td>
                    <td data-label="Rol"><span class="studio-role-badge">${app.esc(lg.actor_role)}</span></td>
                    <td data-label="Acción"><code>${app.esc(lg.action)}</code></td>
                    <td data-label="Recurso">${app.esc(lg.resource_type)} #${app.esc(lg.resource_id)}</td>
                    <td data-label="IP">${app.esc(lg.ip_address || '—')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  function renderBillingModule(org) {
    const b = state.billingData || { plan: org.plan, transactions: [] };
    const p = b.plan || org.plan || {};
    const nextDate = p.current_period_end ? new Date(p.current_period_end).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Renovación corporativa';

    return `
      <div class="studio-glass-panel" style="padding:22px;display:flex;flex-direction:column;gap:18px;border-color:${p.is_enterprise ? 'rgba(212,175,55,0.45)' : 'rgba(56,189,248,0.35)'}">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:14px">
          <div>
            <span class="${p.is_enterprise ? 'co-badge-gold' : 'co-badge-popular'}">${p.is_enterprise ? '✦ Enterprise' : 'Suscripción Activa'}</span>
            <h2 style="margin:8px 0 4px;font-size:1.35rem;font-weight:800">${app.esc(p.display_name || 'Credo One')}</h2>
            <p style="margin:0;color:#9CA3AF;font-size:0.84rem">SKU: <code>${app.esc(p.plan_sku || '')}</code> · Ciclo: <strong>${p.billing_cycle === 'annual' ? 'Anual' : p.billing_cycle === 'custom' ? 'Corporativo' : 'Mensual'}</strong> · Próximo corte: <strong>${app.esc(nextDate)}</strong></p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${['biz_one_pro', 'biz_one_enterprise'].includes(p.plan_sku) ? `
              <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;min-height:38px;padding:6px 14px" id="studioExportCsvBtn">⬇ Exportar CSV</button>` : ''}
            <button type="button" class="co-cta-btn co-cta-sapphire" style="width:auto;min-height:38px;padding:6px 16px" id="studioChangePlanBtn">Cambiar Plan</button>
            ${b.can_manage_billing && p.subscription_id ? `
              <button type="button" class="co-cta-btn co-cta-glass" style="width:auto;min-height:38px;padding:6px 14px;color:#FCA5A5" id="studioCancelSubBtn">Cancelar renovación</button>` : ''}
          </div>
        </div>

        <div class="co-table-wrap" tabindex="0" role="region" aria-labelledby="txTableCap">
          <table class="co-table">
            <caption id="txTableCap">Historial de Pagos Recibidos vía Webhook PayPal</caption>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Referencia PayPal</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(b.transactions || []).length === 0 ? `
                <tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:22px">Sin cargos registrados todavía en este ciclo.</td></tr>
              ` : b.transactions.map((tx) => `
                <tr>
                  <th scope="row">${new Date(tx.created_at).toLocaleDateString('es-DO')}</th>
                  <td data-label="Descripción">${app.esc(tx.description || tx.plan_sku)}</td>
                  <td data-label="Referencia"><code>${app.esc(tx.paypal_sale_id || '—')}</code></td>
                  <td data-label="Monto"><strong>${fmtUsd(tx.amount_cents)} ${app.esc(tx.currency || 'USD')}</strong></td>
                  <td data-label="Estado"><span class="co-status-pill co-status-active">${app.esc(tx.status)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderStudio() {
    const org = getActiveOrg();
    if (!org) {
      renderUpgradeGate();
      return;
    }

    const quota = Math.max(1, Number(org.impressions_quota || 1));
    const availPct = Math.min(100, Math.round((Number(org.impressions_available || 0) / quota) * 100));
    const isEnt = Boolean(org.plan?.is_enterprise);

    const navItems = [
      ['overview', 'Dashboard'],
      ['campaigns', 'Campañas'],
      ['team', 'Equipo y RBAC'],
      ['billing', 'Facturación'],
    ];

    const bodyHtml =
      state.section === 'campaigns'
        ? renderCampaignsModule(org)
        : state.section === 'team'
          ? renderTeamModule(org)
          : state.section === 'billing'
            ? renderBillingModule(org)
            : renderOverviewModule(org);

    root.innerHTML = `
      <div class="studio-shell">
        <aside class="studio-glass-panel studio-sidebar">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <strong style="font-size:0.96rem;letter-spacing:-0.02em">✦ Credo One Studio</strong>
            <a href="#/feed" style="font-size:0.74rem;color:#9CA3AF;text-decoration:none">← App</a>
          </div>

          <div class="studio-org-switcher">
            <label for="studioOrgSelect">Cuenta / Organización Activa</label>
            <select id="studioOrgSelect" class="studio-org-select">
              ${state.orgs.map((o) => `<option value="${o.id}"${o.id === org.id ? ' selected' : ''}>${app.esc(o.name)} (${app.esc(o.my_role)})</option>`).join('')}
            </select>
          </div>

          <nav class="studio-nav" aria-label="Módulos de Credo One Studio">
            ${navItems.map(([id, label]) => `
              <button type="button" class="studio-nav-btn${state.section === id ? ' is-active' : ''}" data-studio-sec="${id}">${label}</button>
            `).join('')}
          </nav>

          <button type="button" class="co-cta-btn ${isEnt ? 'co-cta-gold' : 'co-cta-glass'}" style="min-height:38px;font-size:0.78rem" id="studioSidebarPlansBtn">
            ${isEnt ? '✦ Plan Enterprise Activo' : 'Mejorar Plan Credo One'}
          </button>
        </aside>

        <div class="studio-main">
          <header class="studio-glass-panel studio-topbar">
            <div class="studio-pool-wrap">
              <div class="studio-pool-meta">
                <span>Bolsa de Impresiones del Mes</span>
                <strong>${fmtNum(org.impressions_available)} / ${fmtNum(org.impressions_quota)} disponibles</strong>
              </div>
              <div class="studio-pool-track">
                <div class="studio-pool-fill${isEnt ? ' studio-pool-fill--gold' : ''}" style="width:${availPct}%"></div>
              </div>
            </div>

            <div class="studio-top-actions">
              <span class="studio-role-badge${org.my_role === 'owner' ? ' studio-role-badge--owner' : ''}">Rol: ${app.esc(org.my_role)}</span>
              ${['owner', 'admin', 'editor'].includes(org.my_role) ? `
                <button type="button" class="co-cta-btn ${isEnt ? 'co-cta-gold' : 'co-cta-sapphire'}" style="width:auto;min-height:38px;padding:6px 15px" id="studioQuickNewCamp">+ Nueva Campaña</button>
              ` : ''}
            </div>
          </header>

          ${bodyHtml}
        </div>
      </div>
    `;

    // Org switcher
    root.querySelector('#studioOrgSelect')?.addEventListener('change', async (e) => {
      state.activeOrgId = Number(e.target.value);
      state.creatorOpen = false;
      await loadSectionData();
      renderStudio();
    });

    // Sidebar navigation
    root.querySelectorAll('[data-studio-sec]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.section = btn.dataset.studioSec;
        state.creatorOpen = false;
        history.replaceState(null, '', `#/studio/${state.section}`);
        await loadSectionData();
        renderStudio();
      });
    });

    root.querySelector('#studioSidebarPlansBtn')?.addEventListener('click', () =>
      app.openCredoOne({ audience: org.plan?.audience || 'business' })
    );

    const openCreator = async () => {
      state.section = 'campaigns';
      state.creatorOpen = true;
      if (!state.campaignsData) await loadSectionData();
      renderStudio();
    };
    root.querySelector('#studioQuickNewCamp')?.addEventListener('click', openCreator);
    root.querySelector('#openCreatorBtn2')?.addEventListener('click', openCreator);
    root.querySelector('#closeCreatorBtn')?.addEventListener('click', () => {
      state.creatorOpen = false;
      renderStudio();
    });

    // Overview range switch
    root.querySelectorAll('[data-studio-range]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.range = Number(btn.dataset.studioRange);
        await loadSectionData();
        renderStudio();
      });
    });

    // Campaigns filters & search
    root.querySelectorAll('[data-camp-filter]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.campStatusFilter = btn.dataset.campFilter;
        await loadSectionData();
        renderStudio();
      });
    });
    const searchEl = root.querySelector('#studioCampSearch');
    if (searchEl) {
      let t = 0;
      searchEl.addEventListener('input', () => {
        state.campSearch = searchEl.value;
        clearTimeout(t);
        t = setTimeout(async () => {
          await loadSectionData();
          renderStudio();
        }, 280);
      });
    }

    // Campaign toggle switch
    root.querySelectorAll('[data-toggle-camp]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await app.api(`/api/v1/studio/campaigns/${btn.dataset.toggleCamp}/toggle?org_id=${org.id}`, {
            method: 'PATCH',
          });
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast('Estado de campaña actualizado');
        } catch (err) {
          app.toast(err.message);
        }
      });
    });

    // Live Campaign Creator Form -> Real-time Smartphone Mockup Sync
    const campForm = root.querySelector('#studioCreateCampaignForm');
    if (campForm) {
      const updatePreview = () => {
        const host = root.querySelector('#studioPhonePreviewHost');
        if (host) host.innerHTML = renderPhonePreviewHtml(org);
        const valEl = root.querySelector('#campSliderVal');
        if (valEl) valEl.textContent = fmtNum(state.draft.impressions_allocated);
      };

      campForm.querySelector('#campSourcePost')?.addEventListener('change', (e) => {
        const pid = e.target.value;
        state.draft.post_id = pid;
        const found = (state.campaignsData?.available_posts || []).find((p) => String(p.id) === String(pid));
        if (found) {
          state.draft.title = found.title || state.draft.title;
          state.draft.body = found.content || '';
          state.draft.media_url = found.image_url || state.draft.media_url;
          campForm.querySelector('#campTitle').value = state.draft.title;
          campForm.querySelector('#campBody').value = state.draft.body;
          campForm.querySelector('#campMedia').value = state.draft.media_url;
        }
        updatePreview();
      });

      const bindField = (sel, key, transform = (v) => v) => {
        campForm.querySelector(sel)?.addEventListener('input', (e) => {
          state.draft[key] = transform(e.target.value);
          updatePreview();
        });
      };
      bindField('#campTitle', 'title');
      bindField('#campBody', 'body');
      bindField('#campMedia', 'media_url');
      bindField('#campCtaLabel', 'cta_label');
      bindField('#campCtaUrl', 'cta_url');
      bindField('#campCity', 'target_city');
      bindField('#campSlider', 'impressions_allocated', Number);

      campForm.querySelector('#campCountry')?.addEventListener('change', (e) => {
        state.draft.target_country = e.target.value;
        updatePreview();
      });
      campForm.querySelector('#campCtaType')?.addEventListener('change', (e) => {
        state.draft.cta_type = e.target.value;
        const preset = CTA_PRESETS.find((c) => c.id === e.target.value);
        if (preset) {
          state.draft.cta_label = preset.defaultText;
          campForm.querySelector('#campCtaLabel').value = preset.defaultText;
        }
        updatePreview();
      });

      campForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const errBox = root.querySelector('#studioCampErr');
        const btn = root.querySelector('#submitCampaignBtn');
        if (errBox) errBox.hidden = true;
        if (btn) btn.disabled = true;
        try {
          const fd = new FormData(campForm);
          const payload = {
            org_id: org.id,
            post_id: fd.get('post_id') || null,
            title: fd.get('title'),
            body: fd.get('body'),
            media_url: fd.get('media_url'),
            cta_type: fd.get('cta_type'),
            cta_label: fd.get('cta_label'),
            cta_url: fd.get('cta_url'),
            target_country: fd.get('target_country'),
            target_city: fd.get('target_city'),
            ends_at: fd.get('ends_at') || null,
            impressions_allocated: Number(fd.get('impressions_allocated') || 5000),
          };
          const res = await app.api('/api/v1/studio/campaigns', { method: 'POST', body: payload });
          state.creatorOpen = false;
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast(res.requires_approval ? 'Enviada a Cola de Aprobación' : 'Campaña lanzada en el feed');
        } catch (err) {
          if (errBox) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          }
          if (btn) btn.disabled = false;
        }
      });
    }

    // Team subtabs, invite, upgrade lock, approvals, audit logs
    root.querySelectorAll('[data-team-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.teamSubtab = btn.dataset.teamTab;
        renderStudio();
      });
    });
    root.querySelector('#studioSeatUpgradeBtn')?.addEventListener('click', () =>
      app.openCredoOne({ audience: 'business' })
    );
    root.querySelector('#auditUpgradeBtn')?.addEventListener('click', () =>
      app.openCredoOne({ audience: 'business', planSku: 'biz_one_enterprise' })
    );

    root.querySelector('#studioInviteBtn')?.addEventListener('click', () => {
      const dlg = app.openModal(
        'Invitar miembro al equipo',
        `
        <form id="inviteMemForm" style="display:flex;flex-direction:column;gap:12px">
          <div class="field">
            <label for="invEmail">Correo electrónico</label>
            <input id="invEmail" name="email" type="email" required placeholder="colaborador@iglesia.org" />
          </div>
          <div class="field">
            <label for="invRole">Rol RBAC</label>
            <select id="invRole" name="role">
              ${org.my_role === 'owner' ? '<option value="admin">Admin</option>' : ''}
              <option value="editor" selected>Editor</option>
              <option value="moderator">Moderator</option>
              <option value="analyst">Analyst</option>
            </select>
          </div>
          <button type="submit" class="btn btn-gold btn-block">Enviar invitación</button>
        </form>
        `
      );
      dlg.querySelector('#inviteMemForm')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        try {
          await app.api('/api/v1/studio/team/invite', {
            method: 'POST',
            body: { org_id: org.id, email: fd.get('email'), role: fd.get('role') },
          });
          app.closeModal();
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast('Miembro agregado al equipo');
        } catch (err) {
          app.closeModal();
          if (String(err.message || '').includes('límite') || String(err.message || '').includes('SEAT')) {
            app.openCredoOne({ audience: 'business' });
          }
          app.toast(err.message);
        }
      });
    });

    root.querySelectorAll('[data-remove-member]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await app.api(`/api/v1/studio/team/${btn.dataset.removeMember}?org_id=${org.id}`, { method: 'DELETE' });
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast('Acceso revocado');
        } catch (err) {
          app.toast(err.message);
        }
      });
    });

    root.querySelectorAll('[data-approve-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await app.api(`/api/v1/studio/approvals/${btn.dataset.approveId}/decide`, {
            method: 'POST',
            body: { org_id: org.id, decision: 'approve' },
          });
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast('Campaña aprobada y publicada');
        } catch (err) {
          app.toast(err.message);
        }
      });
    });

    root.querySelectorAll('[data-return-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const note = window.prompt('Nota para el Editor (motivo de devolución):') || 'Por favor revisar el texto antes de publicar.';
        try {
          await app.api(`/api/v1/studio/approvals/${btn.dataset.returnId}/decide`, {
            method: 'POST',
            body: { org_id: org.id, decision: 'return', note },
          });
          await loadContext();
          await loadSectionData();
          renderStudio();
          app.toast('Campaña devuelta con nota');
        } catch (err) {
          app.toast(err.message);
        }
      });
    });

    // Billing actions
    root.querySelector('#studioChangePlanBtn')?.addEventListener('click', () =>
      app.openCredoOne({ audience: org.plan?.audience || 'business' })
    );
    root.querySelector('#studioExportCsvBtn')?.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/v1/studio/export.csv?org_id=${org.id}`, {
          headers: app.token ? { Authorization: `Bearer ${app.token}` } : {},
        });
        if (!res.ok) throw new Error('No se pudo exportar CSV');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `credo-one-studio-org-${org.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        app.toast(err.message);
      }
    });
    root.querySelector('#studioCancelSubBtn')?.addEventListener('click', async () => {
      if (!window.confirm('¿Deseas cancelar la renovación automática? Tus campañas activas se pausarán sin perder historial.')) return;
      try {
        await app.api('/api/v1/credo-one/subscriptions/cancel', {
          method: 'POST',
          body: { subscription_id: org.plan?.subscription_id },
        });
        await app.refreshSession?.();
        await loadContext();
        await loadSectionData();
        renderStudio();
        app.toast('Renovación cancelada');
      } catch (err) {
        app.toast(err.message);
      }
    });
  }

  try {
    await loadContext();
    if (state.orgs.length === 0) {
      renderUpgradeGate();
    } else {
      await loadSectionData();
      renderStudio();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      root.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  return {
    cleanup() {
      document.body.classList.remove('is-studio-mode');
    },
  };
}
