/* Credo Core OS — Master Super-Admin Command Console SPA
 * Standalone ES Module · 100% live PostgreSQL + SSE Telemetry · Zero Mocks
 */

const TOKEN_KEY = 'credo-core-token';
const MAIN_TOKEN_KEY = 'credo-token';
const BASE_PATH = '/diosesmiguia';

const state = {
  token: '',
  admin: null,
  route: BASE_PATH,
  sse: null,
  snapshot: null,
  activeTabs: {
    network: 'sessions',
    users: 'directory',
    dossier: 'profile',
    content: 'posts',
    finance: 'overview',
  },
  userFilters: { q: '', plan: '', status: '' },
  contentFilters: { kind: 'all', q: '' },
  auditFilter: '',
  dossierUserId: null,
};

const ROUTE_TITLES = {
  '/diosesmiguia': 'Resumen Vivo',
  '/diosesmiguia/network': 'Tráfico & IPs',
  '/diosesmiguia/system-health': 'Salud del Servidor',
  '/diosesmiguia/ads': 'Publicidad Web / App',
  '/diosesmiguia/users': 'Usuarios God Mode',
  '/diosesmiguia/content': 'Contenido & Media',
  '/diosesmiguia/live': 'Transmisiones En Vivo',
  '/diosesmiguia/moderation': 'Moderación & Reportes',
  '/diosesmiguia/finance': 'Contabilidad & PayPal',
  '/diosesmiguia/broadcast': 'Broadcasts Push',
  '/diosesmiguia/settings': 'Kill Switches',
  '/diosesmiguia/audit': 'Audit Logs',
};

const PLAN_LABELS = {
  '': 'Free',
  user_one_plus: 'Credo One+',
  user_one_pro: 'Credo One Pro',
  biz_one_plus: 'Business One+',
  biz_one_pro: 'Business One Pro',
  biz_one_enterprise: 'Enterprise',
  campaign_reach: 'Campaña Studio',
};

const AD_FORMATS = {
  feed_injection: 'Inyección en Feed',
  sticky_top: 'Banner Superior Fijo',
  sticky_bottom: 'Banner Inferior Fijo',
  section_gospel: 'Sección Evangelio / Feed',
  section_prayer: 'Sección Oración',
  interstitial: 'Modal Intersticial',
  explore_pinned: 'Destacado en Explorar',
};

const ENFORCEMENT_LABELS = {
  total_imposition: 'Imposición Total (Todos incl. One)',
  non_premium: 'Todos excepto Pro / Enterprise',
  free_only: 'Solo Usuarios Free',
};

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-DO');
}

function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-DO', {
    year: '2-digit',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(sec) {
  const s = Math.max(0, Number(sec || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 48) return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = $('coreToast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor =
    kind === 'err' ? 'var(--c-red)' : kind === 'ok' ? 'var(--c-green)' : 'var(--c-border-hover)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.body) };
  }
  const res = await fetch(`/api/admin${path}`, { ...opts, headers });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (res.status === 401 || res.status === 403) {
    const isPreAuth =
      path === '/auth/login' ||
      path === '/auth/register-invite' ||
      path.startsWith('/auth/invite/');
    if (!isPreAuth) {
      handleUnauthorized();
    }
    throw new Error(data.error || 'Sesión expirada o sin privilegios Super-Admin.');
  }
  if (!res.ok) {
    throw new Error(data.error || `Error HTTP ${res.status}`);
  }
  return data;
}

function openModal(title, bodyHtml, onBind) {
  const dlg = $('coreModalDlg');
  if (!dlg) return;
  dlg.innerHTML = `
    <div class="core-dlg-head">
      <h3 id="coreModalTitle">${esc(title)}</h3>
      <button type="button" class="action-pill" id="coreModalCloseBtn">Cerrar</button>
    </div>
    <div class="core-dlg-body" id="coreModalBody">${bodyHtml}</div>
  `;
  const closeBtn = $('coreModalCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
  if (typeof onBind === 'function') onBind($('coreModalBody'), dlg);
}

function closeModal() {
  const dlg = $('coreModalDlg');
  if (dlg && dlg.open) dlg.close();
}

function statusBadge(status) {
  const s = String(status || 'active').toLowerCase();
  if (['active', 'approved', 'completed', 'succeeded', 'processed', 'verified', 'live'].includes(s)) {
    return `<span class="led-badge led-badge--green"><i class="led led--green"></i>${esc(s)}</span>`;
  }
  if (['pending', 'pending_payment', 'muted', 'shadowbanned', 'paused', 'manual_review', 'contacted', 'new'].includes(s)) {
    return `<span class="led-badge led-badge--amber"><i class="led led--amber"></i>${esc(s)}</span>`;
  }
  if (['banned', 'suspended', 'rejected', 'error', 'failed', 'cancelled', 'expired', 'hidden'].includes(s)) {
    return `<span class="led-badge led-badge--red"><i class="led led--red"></i>${esc(s)}</span>`;
  }
  return `<span class="led-badge"><i class="led led--muted"></i>${esc(s)}</span>`;
}

function planBadge(sku) {
  const label = PLAN_LABELS[sku || ''] || sku || 'Free';
  if (!sku) return `<span class="led-badge"><i class="led led--muted"></i>Free</span>`;
  if (String(sku).includes('enterprise') || String(sku).includes('pro')) {
    return `<span class="led-badge led-badge--gold"><i class="led led--gold"></i>${esc(label)}</span>`;
  }
  return `<span class="led-badge led-badge--blue"><i class="led led--green"></i>${esc(label)}</span>`;
}

function meterClass(pct) {
  const n = Number(pct || 0);
  if (n >= 85) return 'core-meter-fill core-meter-fill--red';
  if (n >= 65) return 'core-meter-fill core-meter-fill--amber';
  return 'core-meter-fill';
}

/* ==================== AUTH & SSE TELEMETRY ==================== */

function showLoginGate(msg = '') {
  stopSse();
  $('coreApp').hidden = true;
  if ($('coreInviteGate')) $('coreInviteGate').hidden = true;
  $('coreLoginGate').hidden = false;
  const errEl = $('coreLoginErr');
  if (msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  } else {
    errEl.hidden = true;
  }
}

function handleUnauthorized() {
  state.token = '';
  state.admin = null;
  localStorage.removeItem(TOKEN_KEY);
  showLoginGate('Tu sesión Super-Admin expiró. Vuelve a iniciar sesión.');
}

function showAppShell() {
  $('coreLoginGate').hidden = true;
  if ($('coreInviteGate')) $('coreInviteGate').hidden = true;
  $('coreApp').hidden = false;
  window.scrollTo(0, 0);
  const chip = $('coreAdminChip');
  if (chip && state.admin) {
    chip.innerHTML = `
      <strong>${esc(state.admin.full_name || state.admin.username)}</strong>
      <span class="mono">@${esc(state.admin.username)} · ${esc((state.admin.role || 'super_admin').toUpperCase())}</span>
    `;
  }
  startSse();
  navigate(window.location.pathname || BASE_PATH, false);
}

function stopSse() {
  if (state.sse) {
    try { state.sse.close(); } catch {}
    state.sse = null;
  }
}

function startSse() {
  stopSse();
  if (!state.token) return;
  const url = `/api/admin/telemetry/stream?token=${encodeURIComponent(state.token)}`;
  const es = new EventSource(url);
  state.sse = es;
  const led = $('coreSseLed');

  es.onopen = () => {
    if (led) {
      led.className = 'led led--green led--pulse';
    }
  };

  es.onmessage = (ev) => {
    try {
      const snap = JSON.parse(ev.data);
      state.snapshot = snap;
      applySnapshotToChrome(snap);
      applyLivePatchToViewport(snap);
    } catch {}
  };

  es.onerror = () => {
    if (led) {
      led.className = 'led led--amber';
    }
  };
}

function applySnapshotToChrome(snap) {
  if (!snap) return;
  const on = $('topOnlineCount');
  const ip = $('topIpCount');
  if (on) on.textContent = fmtNum(snap.online?.total || 0);
  if (ip) ip.textContent = fmtNum(snap.network?.unique_ips_now || 0);

  const reqs = Number(snap.inventory?.pending_requests || 0);
  const reps = Number(snap.inventory?.pending_reports || 0);
  const bReq = $('navBadgeReqs');
  const bRep = $('navBadgeReps');
  if (bReq) {
    bReq.textContent = String(reqs);
    bReq.hidden = reqs <= 0;
  }
  if (bRep) {
    bRep.textContent = String(reps);
    bRep.hidden = reps <= 0;
  }
}

function applyLivePatchToViewport(snap) {
  const setTxt = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val;
  };
  setTxt('liveOnlineTotal', fmtNum(snap.online?.total || 0));
  setTxt(
    'liveOnlineBreak',
    `${fmtNum(snap.online?.registered || 0)} reg · ${fmtNum(snap.online?.anonymous || 0)} anón`
  );
  setTxt('liveIpsNow', fmtNum(snap.network?.unique_ips_now || 0));
  setTxt(
    'liveIps24h',
    `24h: ${fmtNum(snap.inventory?.unique_ips_24h || 0)} · Total: ${fmtNum(snap.inventory?.total_unique_ips_all_time || 0)}`
  );
  setTxt('livePeak24h', fmtNum(snap.network?.peak_24h_online || 0));
  setTxt('livePeakIps', `Pico IPs 24h: ${fmtNum(snap.network?.peak_24h_ips || 0)}`);
  setTxt('liveStreamsNow', fmtNum(snap.inventory?.active_streams || 0));
  setTxt('liveListenersNow', `${fmtNum(snap.inventory?.live_listeners || 0)} oyentes activos`);
  setTxt('liveCpuPct', `${snap.health?.cpu_pct ?? 0}%`);
  setTxt('liveRamPct', `${snap.health?.ram_pct ?? 0}%`);
  setTxt('liveDbPing', `${snap.health?.db_ping_ms ?? 0} ms`);

  const sessionsTbody = $('liveSessionsTbody');
  if (sessionsTbody && Array.isArray(snap.sessions)) {
    const isNetwork = state.route === '/diosesmiguia/network';
    const list = isNetwork ? snap.sessions : snap.sessions.slice(0, 12);
    sessionsTbody.innerHTML = renderSessionRowsHtml(list);
  }
}

/* ==================== ROUTER & CHROME EVENTS ==================== */

function normalizeRoute(path) {
  let p = String(path || BASE_PATH).replace(/\/+$/, '');
  if (!p.startsWith(BASE_PATH)) p = BASE_PATH;
  return p;
}

function closeMobileDrawer() {
  $('coreSidebar')?.classList.remove('is-open');
  if ($('coreMobileScrim')) $('coreMobileScrim').hidden = true;
}

function navigate(path, push = true) {
  const clean = normalizeRoute(path);
  state.route = clean;
  if (push && window.location.pathname !== clean) {
    window.history.pushState({}, '', clean);
  }
  closeMobileDrawer();

  const userMatch = clean.match(/^\/diosesmiguia\/users\/(\d+)$/);
  const baseForNav = userMatch ? '/diosesmiguia/users' : clean;

  document.querySelectorAll('#coreNav .core-nav-item').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.route === baseForNav);
  });

  const titleEl = $('corePageTitle');
  if (titleEl) {
    titleEl.textContent = userMatch
      ? `Expediente Usuario #${userMatch[1]}`
      : ROUTE_TITLES[clean] || 'Resumen Vivo';
  }

  renderCurrentView();
}

async function renderCurrentView() {
  const vp = $('coreViewport');
  if (!vp) return;
  vp.innerHTML = `<div class="core-panel"><p class="mono" style="color:var(--c-muted);margin:0">Cargando telemetría y registros en tiempo real…</p></div>`;

  try {
    const userMatch = state.route.match(/^\/diosesmiguia\/users\/(\d+)$/);
    if (userMatch) {
      state.dossierUserId = Number(userMatch[1]);
      await renderUserDossierView(vp, state.dossierUserId);
      return;
    }

    switch (state.route) {
      case '/diosesmiguia':
        await renderOverviewView(vp);
        break;
      case '/diosesmiguia/network':
        await renderNetworkView(vp);
        break;
      case '/diosesmiguia/system-health':
        await renderSystemHealthView(vp);
        break;
      case '/diosesmiguia/ads':
        await renderAdsView(vp);
        break;
      case '/diosesmiguia/users':
        await renderUsersView(vp);
        break;
      case '/diosesmiguia/content':
        await renderContentView(vp);
        break;
      case '/diosesmiguia/live':
        await renderLiveView(vp);
        break;
      case '/diosesmiguia/moderation':
        await renderModerationView(vp);
        break;
      case '/diosesmiguia/finance':
        await renderFinanceView(vp);
        break;
      case '/diosesmiguia/broadcast':
        await renderBroadcastView(vp);
        break;
      case '/diosesmiguia/settings':
        await renderSettingsView(vp);
        break;
      case '/diosesmiguia/audit':
        await renderAuditView(vp);
        break;
      default:
        await renderOverviewView(vp);
        break;
    }
  } catch (err) {
    vp.innerHTML = `
      <div class="core-panel">
        <div class="core-alert core-alert--err">Error cargando vista: ${esc(err.message)}</div>
        <div><button type="button" class="btn-ghost" id="retryViewBtn">Reintentar</button></div>
      </div>
    `;
    $('retryViewBtn')?.addEventListener('click', () => renderCurrentView());
  }
}

/* ==================== GLOBAL COMMAND PALETTE (CTRL+K / CMD+K) ==================== */

let cmdDebounce = null;
function openCmdPalette() {
  const dlg = $('cmdPaletteDlg');
  const inp = $('cmdPaletteInput');
  if (!dlg || !inp) return;
  if (!dlg.open) dlg.showModal();
  inp.value = '';
  $('cmdPaletteResults').innerHTML =
    `<div class="core-cmd-empty">Escribe al menos 2 caracteres para buscar usuarios, sesiones IP activas, publicaciones, campañas o anuncios.</div>`;
  setTimeout(() => inp.focus(), 20);
}

async function runCmdSearch(q) {
  const box = $('cmdPaletteResults');
  if (!box) return;
  if (q.trim().length < 2) {
    box.innerHTML = `<div class="core-cmd-empty">Escribe al menos 2 caracteres…</div>`;
    return;
  }
  box.innerHTML = `<div class="core-cmd-empty mono">Buscando "${esc(q)}"…</div>`;
  try {
    const res = await api(`/search?q=${encodeURIComponent(q.trim())}`);
    let html = '';

    if (res.users?.length) {
      html += `<div class="core-cmd-group">Usuarios (${res.users.length})</div>`;
      html += res.users
        .map(
          (u) => `
        <button type="button" class="core-cmd-item" data-cmd="user" data-id="${u.id}">
          <span><strong>${esc(u.full_name)}</strong> <span class="mono" style="color:var(--c-muted)">@${esc(u.username)} · ${esc(u.email)}</span></span>
          ${planBadge(u.active_plan_sku)}
        </button>`
        )
        .join('');
    }
    if (res.sessions?.length) {
      html += `<div class="core-cmd-group">Sesiones IP en Vivo (${res.sessions.length})</div>`;
      html += res.sessions
        .map(
          (s) => `
        <button type="button" class="core-cmd-item" data-cmd="ip" data-ip="${esc(s.ip)}">
          <span class="mono"><strong>${esc(s.ip)}</strong> · ${esc(s.username ? `@${s.username}` : 'Visitante anónimo')}</span>
          <span class="mono" style="color:var(--c-muted)">${esc(s.route || '/')}</span>
        </button>`
        )
        .join('');
    }
    if (res.campaigns?.length) {
      html += `<div class="core-cmd-group">Campañas Studio (${res.campaigns.length})</div>`;
      html += res.campaigns
        .map(
          (c) => `
        <button type="button" class="core-cmd-item" data-cmd="campaign" data-id="${c.id}">
          <span><strong>#${c.id} ${esc(c.title || '(Sin título)')}</strong></span>
          ${statusBadge(c.status)}
        </button>`
        )
        .join('');
    }
    if (res.ads?.length) {
      html += `<div class="core-cmd-group">Anuncios Plataforma (${res.ads.length})</div>`;
      html += res.ads
        .map(
          (a) => `
        <button type="button" class="core-cmd-item" data-cmd="ad" data-id="${a.id}">
          <span><strong>#${a.id} ${esc(a.title)}</strong> <span class="mono" style="color:var(--c-muted)">${esc(a.format)}</span></span>
          ${statusBadge(a.is_active ? 'active' : 'paused')}
        </button>`
        )
        .join('');
    }
    if (res.posts?.length) {
      html += `<div class="core-cmd-group">Publicaciones (${res.posts.length})</div>`;
      html += res.posts
        .map(
          (p) => `
        <button type="button" class="core-cmd-item" data-cmd="post" data-q="${esc(p.title || '')}">
          <span><strong>#${p.id} ${esc(p.title || '(Sin título)')}</strong></span>
          <span class="mono" style="color:var(--c-muted)">${esc(p.media_kind || 'post')}</span>
        </button>`
        )
        .join('');
    }

    if (!html) {
      html = `<div class="core-cmd-empty">Sin resultados para "${esc(q)}".</div>`;
    }
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = `<div class="core-cmd-empty" style="color:var(--c-red)">${esc(err.message)}</div>`;
  }
}

/* ==================== SHARED SESSION TABLE RENDERER & ACTIONS ==================== */

function renderSessionRowsHtml(sessions) {
  if (!sessions || !sessions.length) {
    return `<tr><td colspan="8" style="text-align:center;color:var(--c-muted);padding:20px">Sin sesiones activas en la ventana actual.</td></tr>`;
  }
  return sessions
    .map((s) => {
      const userCell = s.user_id
        ? `<a href="/diosesmiguia/users/${s.user_id}" data-route="/diosesmiguia/users/${s.user_id}" style="color:var(--c-blue-hi);font-weight:600;text-decoration:none">@${esc(s.username || `uid_${s.user_id}`)}</a><div style="font-size:11px;color:var(--c-muted)">${esc(s.full_name || '')}</div>`
        : `<span style="color:var(--c-muted)">Anónimo</span>`;
      return `
      <tr>
        <th scope="row" class="mono">${esc(s.ip)}</th>
        <td data-label="Geo" class="mono">${esc([s.country, s.city].filter(Boolean).join(' · ') || '—')}</td>
        <td data-label="Cuenta">${userCell}</td>
        <td data-label="Equipo"><span class="mono">${esc(s.device || 'web')} · ${esc(s.os || '—')}</span></td>
        <td data-label="Ruta" class="mono">${esc(s.route || '/')}</td>
        <td data-label="RPM / Lat" class="mono">${fmtNum(s.rpm)} rpm · ${fmtNum(s.avg_latency_ms)}ms</td>
        <td data-label="Conectado" class="mono">${fmtDuration(s.connected_sec)}</td>
        <td data-label="Acciones">
          <div class="core-table-actions">
            <button type="button" class="action-pill" data-ip-history="${esc(s.ip)}">Historial</button>
            <button type="button" class="action-pill action-pill--danger" data-force-logout-ip="${esc(s.ip)}" data-force-logout-uid="${s.user_id || ''}">Expulsar</button>
            <button type="button" class="action-pill action-pill--danger" data-quick-ban-ip="${esc(s.ip)}">Ban IP</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

async function openIpHistoryModal(ip) {
  openModal(`Historial Forense IP · ${ip}`, `<p class="mono" style="color:var(--c-muted)">Consultando registros…</p>`);
  try {
    const data = await api(`/network/ip/${encodeURIComponent(ip)}/history`);
    const accountsHtml = data.accounts?.length
      ? data.accounts
          .map(
            (a) =>
              `<a href="/diosesmiguia/users/${a.id}" data-route="/diosesmiguia/users/${a.id}" class="action-pill action-pill--primary">@${esc(a.username)} (${esc(a.full_name)})</a>`
          )
          .join(' ')
      : `<span style="color:var(--c-muted)">Sin cuentas registradas asociadas.</span>`;

    const histRows = data.history?.length
      ? data.history
          .map(
            (h) => `
          <tr>
            <th scope="row" class="mono">${esc(fmtDate(h.last_seen_at))}</th>
            <td data-label="Usuario">${h.username ? `@${esc(h.username)}` : 'Anónimo'}</td>
            <td data-label="Geo" class="mono">${esc([h.country_code, h.city].filter(Boolean).join(' · ') || '—')}</td>
            <td data-label="Equipo" class="mono">${esc(h.device_type || 'web')}</td>
            <td data-label="Hits" class="mono">${fmtNum(h.hits_count)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted)">Sin historial persistido todavía.</td></tr>`;

    openModal(
      `Historial Forense IP · ${ip}`,
      `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--c-muted);margin-bottom:6px">Cuentas detectadas en esta IP</div>
        <div class="core-actions-row">${accountsHtml}</div>
      </div>
      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Última vez</th><th>Cuenta</th><th>Geo</th><th>Equipo</th><th>Hits</th></tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>
      <div class="core-actions-row" style="justify-content:flex-end">
        <button type="button" class="btn-danger" id="modalBanIpBtn">Bloquear IP ${esc(ip)}</button>
      </div>
    `,
      (body) => {
        body.querySelectorAll('a[data-route]').forEach((a) =>
          a.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal();
            navigate(a.dataset.route);
          })
        );
        body.querySelector('#modalBanIpBtn')?.addEventListener('click', () => {
          openBanIpModal(ip);
        });
      }
    );
  } catch (err) {
    toast(err.message, 'err');
  }
}

function openBanIpModal(prefillIp = '') {
  openModal(
    'Bloquear IP o Rango CIDR en Firewall',
    `
    <form id="banIpForm" class="core-form">
      <div class="core-field">
        <label for="banIpInput">Dirección IP o CIDR</label>
        <input id="banIpInput" name="ip_or_cidr" required value="${esc(prefillIp)}" placeholder="Ej. 190.166.12.45 o 45.33.0.0/16" class="mono" />
      </div>
      <div class="core-field">
        <label for="banIpReason">Motivo del bloqueo</label>
        <input id="banIpReason" name="reason" required placeholder="Ataque automatizado, spam, evasión de baneo…" />
      </div>
      <div class="core-field">
        <label for="banIpHours">Duración en horas (vacío = Permanente)</label>
        <input id="banIpHours" name="hours" type="number" min="1" placeholder="Permanente" class="mono" />
      </div>
      <div class="core-actions-row" style="justify-content:flex-end">
        <button type="submit" class="btn-danger">Aplicar Bloqueo Inmediato</button>
      </div>
    </form>
  `,
    (body) => {
      body.querySelector('#banIpForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await api('/network/ip-bans', {
            method: 'POST',
            body: {
              ip_or_cidr: fd.get('ip_or_cidr'),
              reason: fd.get('reason'),
              hours: fd.get('hours') ? Number(fd.get('hours')) : null,
            },
          });
          toast('IP bloqueada y sesiones expulsadas', 'ok');
          closeModal();
          if (state.route === '/diosesmiguia/network') renderCurrentView();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    }
  );
}

/* ==================== MODULE 1: OVERVIEW, NETWORK, SYSTEM HEALTH ==================== */

async function renderOverviewView(vp) {
  const snap = await api('/telemetry/snapshot');
  state.snapshot = snap;
  applySnapshotToChrome(snap);

  const on = snap.online || {};
  const net = snap.network || {};
  const inv = snap.inventory || {};
  const h = snap.health || {};
  const dev = on.by_device || {};

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Centro de Mando en Vivo</h2>
        <p>Telemetría real de usuarios conectados, IPs activas, inventario global e infraestructura cada 3 segundos.</p>
      </div>
      <div class="core-actions-row">
        <a href="/diosesmiguia/ads" data-route="/diosesmiguia/ads" class="btn-gold">Publicidad Global</a>
        <a href="/diosesmiguia/users" data-route="/diosesmiguia/users" class="btn-primary">Usuarios God Mode</a>
        <a href="/diosesmiguia/settings" data-route="/diosesmiguia/settings" class="btn-danger">Kill Switches</a>
      </div>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Usuarios Online</span><i class="led led--green led--pulse"></i></div>
        <div class="core-kpi-val mono" id="liveOnlineTotal">${fmtNum(on.total)}</div>
        <div class="core-kpi-sub mono" id="liveOnlineBreak">${fmtNum(on.registered)} reg · ${fmtNum(on.anonymous)} anón</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>IPs Únicas Ahora</span><i class="led led--green"></i></div>
        <div class="core-kpi-val mono" id="liveIpsNow">${fmtNum(net.unique_ips_now)}</div>
        <div class="core-kpi-sub mono" id="liveIps24h">24h: ${fmtNum(inv.unique_ips_24h)} · Total: ${fmtNum(inv.total_unique_ips_all_time)}</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Pico 24 Horas</span><i class="led led--gold"></i></div>
        <div class="core-kpi-val mono" id="livePeak24h">${fmtNum(net.peak_24h_online)}</div>
        <div class="core-kpi-sub mono" id="livePeakIps">Pico IPs 24h: ${fmtNum(net.peak_24h_ips)}</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>En Vivo / Radio</span><i class="led led--red led--pulse"></i></div>
        <div class="core-kpi-val mono" id="liveStreamsNow">${fmtNum(inv.active_streams)}</div>
        <div class="core-kpi-sub mono" id="liveListenersNow">${fmtNum(inv.live_listeners)} oyentes activos</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Dispositivos Activos</span></div>
        <div class="core-kpi-val mono">${fmtNum(dev.web)}W / ${fmtNum(dev.android)}A / ${fmtNum(dev.ios)}i</div>
        <div class="core-kpi-sub">Web · Android · iOS</div>
      </div>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Padrón Total Usuarios</span></div>
        <div class="core-kpi-val mono">${fmtNum(inv.total_users)}</div>
        <div class="core-kpi-sub mono">+${fmtNum(inv.new_users_24h)} en últimas 24h</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Publicaciones &amp; Media</span></div>
        <div class="core-kpi-val mono">${fmtNum(inv.total_posts)}</div>
        <div class="core-kpi-sub mono">${fmtNum(inv.total_videos)} videos · ${fmtNum(inv.total_photos)} fotos · ${fmtNum(inv.total_prayers)} oraciones</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Storage 4 TB Edge</span></div>
        <div class="core-kpi-val mono">${esc(inv.storage_gb ?? '0.00')} GB</div>
        <div class="core-kpi-sub mono">${fmtNum(inv.media_objects)} objetos multimedia</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Colas Pendientes</span><i class="led ${inv.pending_requests || inv.pending_reports ? 'led--amber' : 'led--green'}"></i></div>
        <div class="core-kpi-val mono">${fmtNum(inv.pending_requests)} / ${fmtNum(inv.pending_reports)}</div>
        <div class="core-kpi-sub">Solicitudes Cédula / Reportes</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Salud VPS &amp; PG</span><i class="led led--green"></i></div>
        <div class="core-kpi-val mono"><span id="liveCpuPct">${h.cpu_pct ?? 0}%</span> · <span id="liveRamPct">${h.ram_pct ?? 0}%</span></div>
        <div class="core-kpi-sub mono">CPU · RAM · PG <span id="liveDbPing">${h.db_ping_ms ?? 0} ms</span></div>
      </div>
    </div>

    <div class="core-panel">
      <div class="core-panel-head">
        <div>
          <h3 class="core-panel-title">Sesiones e IPs Conectadas en Tiempo Real</h3>
          <p class="core-panel-sub">Top 12 conexiones activas. Haz clic en cualquier IP para historial o bloqueo instantáneo.</p>
        </div>
        <div class="core-actions-row">
          <a href="/diosesmiguia/network" data-route="/diosesmiguia/network" class="btn-ghost">Ver consola de red completa →</a>
        </div>
      </div>
      <div class="core-table-wrap">
        <table class="core-table">
          <thead>
            <tr>
              <th>IP</th><th>Geo</th><th>Cuenta</th><th>Equipo</th><th>Ruta</th><th>RPM / Latencia</th><th>Tiempo</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody id="liveSessionsTbody">${renderSessionRowsHtml((snap.sessions || []).slice(0, 12))}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderNetworkView(vp) {
  const data = await api('/network/sessions');
  const tab = state.activeTabs.network || 'sessions';

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Tráfico en Vivo, IPs &amp; Firewall</h2>
        <p>Monitoreo por IP en tiempo real, historial histórico de visitantes y bloqueo inmediato por IP o CIDR.</p>
      </div>
      <div class="core-actions-row">
        <button type="button" class="btn-danger" id="netNewBanBtn">+ Bloquear IP / CIDR</button>
        <button type="button" class="btn-ghost" id="netRefreshBtn">Actualizar</button>
      </div>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Sesiones Activas</span><i class="led led--green led--pulse"></i></div>
        <div class="core-kpi-val mono" id="liveOnlineTotal">${fmtNum(data.online?.total)}</div>
        <div class="core-kpi-sub mono" id="liveOnlineBreak">${fmtNum(data.online?.registered)} reg · ${fmtNum(data.online?.anonymous)} anón</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>IPs Únicas Ahora</span></div>
        <div class="core-kpi-val mono" id="liveIpsNow">${fmtNum(data.network?.unique_ips_now)}</div>
        <div class="core-kpi-sub mono">24h: ${fmtNum(data.inventory?.unique_ips_24h)}</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>IPs Históricas Únicas</span></div>
        <div class="core-kpi-val mono">${fmtNum(data.inventory?.total_unique_ips_all_time)}</div>
        <div class="core-kpi-sub">Visitantes registrados en PostgreSQL</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Escudo WAF / Firewall</span><i class="led led--red"></i></div>
        <div class="core-kpi-val mono">${fmtNum((data.ip_bans || []).length)}</div>
        <div class="core-kpi-sub mono">${fmtNum((data.waf_events || []).length)} ataques interceptados</div>
      </div>
    </div>

    <div class="core-panel">
      <div class="core-tabs">
        <button type="button" class="core-tab ${tab === 'sessions' ? 'is-active' : ''}" data-net-tab="sessions">Sesiones Activas (${(data.sessions || []).length})</button>
        <button type="button" class="core-tab ${tab === 'waf' ? 'is-active' : ''}" data-net-tab="waf">Escudo WAF / Amenazas (${(data.waf_events || []).length})</button>
        <button type="button" class="core-tab ${tab === 'bans' ? 'is-active' : ''}" data-net-tab="bans">Firewall / IPs Bloqueadas (${(data.ip_bans || []).length})</button>
        <button type="button" class="core-tab ${tab === 'history' ? 'is-active' : ''}" data-net-tab="history">Historial de IPs (${(data.ip_history || []).length})</button>
      </div>

      ${
        tab === 'sessions'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>IP</th><th>Geo</th><th>Cuenta</th><th>Equipo</th><th>Ruta</th><th>RPM / Latencia</th><th>Tiempo</th><th>Acciones</th></tr></thead>
            <tbody id="liveSessionsTbody">${renderSessionRowsHtml(data.sessions || [])}</tbody>
          </table>
        </div>`
          : tab === 'waf'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Fecha</th><th>IP Atacante</th><th>Geo</th><th>Regla WAF</th><th>Ruta Bloqueada</th><th>User-Agent</th><th>Estado</th></tr></thead>
            <tbody>
              ${
                (data.waf_events || []).length
                  ? data.waf_events
                      .map(
                        (w) => `
                  <tr>
                    <td data-label="Fecha" class="mono">${esc(fmtDate(w.last_seen_at || w.created_at))}</td>
                    <th scope="row" class="mono">${esc(w.ip_address)}</th>
                    <td data-label="Geo" class="mono">${esc(w.country_code || '—')}</td>
                    <td data-label="Regla"><span class="led-badge led-badge--red"><i class="led led--red"></i>${esc(w.rule_code)}</span></td>
                    <td data-label="Ruta" class="mono">${esc(w.request_path || '/')}</td>
                    <td data-label="UA" class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(w.user_agent || '')}">${esc(w.user_agent || '—')}</td>
                    <td data-label="Estado"><span class="led-badge led-badge--green"><i class="led led--green"></i>403 + BANEADO</span></td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="7" style="text-align:center;color:var(--c-muted);padding:20px">Escudo WAF activo (403 + Auto-Ban). Sin nuevos intentos de intrusión registrados.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : tab === 'history'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>IP</th><th>Geo</th><th>Equipo</th><th>Cuentas</th><th>Hits</th><th>Primera vez</th><th>Última vez</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (data.ip_history || []).length
                  ? data.ip_history
                      .map(
                        (h) => `
                  <tr>
                    <th scope="row" class="mono">${esc(h.ip_address)}</th>
                    <td data-label="Geo" class="mono">${esc([h.country_code, h.city].filter(Boolean).join(' · ') || '—')}</td>
                    <td data-label="Equipo" class="mono">${esc(h.device_type || 'web')}</td>
                    <td data-label="Cuentas" class="mono">${fmtNum(h.linked_accounts)}</td>
                    <td data-label="Hits" class="mono">${fmtNum(h.total_hits)}</td>
                    <td data-label="Primera vez" class="mono">${esc(fmtDate(h.first_seen_at))}</td>
                    <td data-label="Última vez" class="mono">${esc(fmtDate(h.last_seen_at))}</td>
                    <td data-label="Acciones">
                      <div class="core-table-actions">
                        <button type="button" class="action-pill" data-ip-history="${esc(h.ip_address)}">Detalle</button>
                        <button type="button" class="action-pill action-pill--danger" data-quick-ban-ip="${esc(h.ip_address)}">Ban IP</button>
                      </div>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="8" style="text-align:center;color:var(--c-muted);padding:20px">Sin historial todavía.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>IP / CIDR</th><th>Motivo</th><th>Expira</th><th>Bloqueado por</th><th>Fecha</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (data.ip_bans || []).length
                  ? data.ip_bans
                      .map(
                        (b) => `
                  <tr>
                    <th scope="row" class="mono">${esc(b.ip_or_cidr)}</th>
                    <td data-label="Motivo">${esc(b.reason || '—')}</td>
                    <td data-label="Expira" class="mono">${b.expires_at ? esc(fmtDate(b.expires_at)) : 'Permanente'}</td>
                    <td data-label="Admin" class="mono">${esc(b.banned_by_name ? `@${b.banned_by_name}` : 'Super-Admin')}</td>
                    <td data-label="Fecha" class="mono">${esc(fmtDate(b.created_at))}</td>
                    <td data-label="Acciones">
                      <button type="button" class="action-pill action-pill--green" data-unban-ip-id="${b.id}">Desbloquear</button>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">No hay IPs bloqueadas actualmente.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  $('netNewBanBtn')?.addEventListener('click', () => openBanIpModal(''));
  $('netRefreshBtn')?.addEventListener('click', () => renderNetworkView(vp));
  vp.querySelectorAll('[data-net-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.activeTabs.network = btn.dataset.netTab;
      renderNetworkView(vp);
    })
  );
  vp.querySelectorAll('[data-unban-ip-id]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api(`/network/ip-bans/${btn.dataset.unbanIpId}`, { method: 'DELETE' });
        toast('Bloqueo de IP eliminado', 'ok');
        renderNetworkView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

async function renderSystemHealthView(vp) {
  const data = await api('/system-health');
  const h = data.health || {};
  const net = data.network || {};
  const inv = data.inventory || {};
  const disk = h.disk || {};

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Salud del Servidor &amp; Base de Datos</h2>
        <p>Estado en tiempo real de CPU, RAM, almacenamiento 4 TB Edge, PostgreSQL y errores HTTP en la última hora.</p>
      </div>
      <button type="button" class="btn-ghost" id="healthRefreshBtn">Actualizar</button>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>CPU (${h.cpu_cores || 1} cores)</span></div>
        <div class="core-kpi-val mono" id="liveCpuPct">${h.cpu_pct ?? 0}%</div>
        <div class="core-meter"><div class="${meterClass(h.cpu_pct)}" style="width:${Math.min(100, h.cpu_pct || 0)}%"></div></div>
        <div class="core-kpi-sub mono">Load 1m: ${h.load_1m ?? 0}</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Memoria RAM</span></div>
        <div class="core-kpi-val mono" id="liveRamPct">${h.ram_pct ?? 0}%</div>
        <div class="core-meter"><div class="${meterClass(h.ram_pct)}" style="width:${Math.min(100, h.ram_pct || 0)}%"></div></div>
        <div class="core-kpi-sub mono">${fmtNum(h.ram_used_mb)} / ${fmtNum(h.ram_total_mb)} MB · Node RSS ${fmtNum(h.process_rss_mb)} MB</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>Disco Contenedor</span></div>
        <div class="core-kpi-val mono">${disk.pct ?? 0}%</div>
        <div class="core-meter"><div class="${meterClass(disk.pct)}" style="width:${Math.min(100, disk.pct || 0)}%"></div></div>
        <div class="core-kpi-sub mono">${disk.used_gb ?? 0} / ${disk.total_gb ?? 0} GB</div>
      </div>
      <div class="core-kpi">
        <div class="core-kpi-lbl"><span>PostgreSQL 18</span><i class="led led--green"></i></div>
        <div class="core-kpi-val mono" id="liveDbPing">${h.db_ping_ms ?? 0} ms</div>
        <div class="core-kpi-sub mono">${fmtNum(h.db_active_connections)} conexiones activas</div>
      </div>
    </div>

    <div class="core-grid-2">
      <div class="core-panel">
        <h3 class="core-panel-title">HTTP Última Hora &amp; Runtime</h3>
        <div class="core-kpi-grid">
          <div class="core-kpi">
            <div class="core-kpi-lbl"><span>Requests 1h</span></div>
            <div class="core-kpi-val mono">${fmtNum(net.http_total_1h)}</div>
          </div>
          <div class="core-kpi">
            <div class="core-kpi-lbl"><span>4xx Client</span></div>
            <div class="core-kpi-val mono" style="color:var(--c-amber)">${fmtNum(net.http_4xx_1h)}</div>
          </div>
          <div class="core-kpi">
            <div class="core-kpi-lbl"><span>5xx Server</span></div>
            <div class="core-kpi-val mono" style="color:var(--c-red)">${fmtNum(net.http_5xx_1h)}</div>
          </div>
        </div>
        <div class="core-alert mono">Node.js ${esc(h.node_version || '—')} · Uptime: ${fmtDuration(h.uptime_sec)} · Storage media: ${esc(inv.storage_gb ?? '0')} GB (${fmtNum(inv.media_objects)} archivos)</div>
      </div>

      <div class="core-panel">
        <h3 class="core-panel-title">Nodos de Almacenamiento Edge (4 TB)</h3>
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Nodo</th><th>Host / URL</th><th>Estado</th><th>Primario</th></tr></thead>
            <tbody>
              ${
                (data.storage_nodes || []).length
                  ? data.storage_nodes
                      .map(
                        (n) => `
                  <tr>
                    <th scope="row">${esc(n.name || n.code || `Node #${n.id}`)}</th>
                    <td data-label="Host" class="mono">${esc(n.public_base_url || n.endpoint_url || '—')}</td>
                    <td data-label="Estado">${statusBadge(n.status || 'active')}</td>
                    <td data-label="Primario" class="mono">${n.is_primary ? 'PRIMARIO' : 'Secundario'}</td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="4" style="color:var(--c-muted);text-align:center">Usando configuración directa EDGE_STORAGE_URL (4 TB).</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  $('healthRefreshBtn')?.addEventListener('click', () => renderSystemHealthView(vp));
}

/* ==================== MODULE 2: PLATFORM-IMPOSED AD SERVER ==================== */

function openAdEditorModal(ad = null, onSaved) {
  const isEdit = Boolean(ad?.id);
  openModal(
    isEdit ? `Editar Anuncio Plataforma #${ad.id}` : 'Crear Anuncio de Plataforma Impuesto',
    `
    <form id="platAdForm" class="core-form">
      <div class="core-form-grid">
        <div class="core-field">
          <label>Título del Anuncio *</label>
          <input name="title" required value="${esc(ad?.title || '')}" placeholder="Ej. Únete a la Misa Especial o Promoción Credo" />
        </div>
        <div class="core-field">
          <label>Formato / Posición *</label>
          <select name="format">
            ${Object.entries(AD_FORMATS)
              .map(([k, v]) => `<option value="${k}" ${ad?.format === k ? 'selected' : ''}>${esc(v)}</option>`)
              .join('')}
          </select>
        </div>
      </div>

      <div class="core-field">
        <label>Texto / Copy Principal</label>
        <textarea name="body" rows="3" placeholder="Mensaje claro que verán los usuarios en web y app…">${esc(ad?.body || '')}</textarea>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>URL de Imagen / Banner (opcional)</label>
          <input name="media_url" value="${esc(ad?.media_url || '')}" placeholder="https://media.credoapp.tech/…" />
        </div>
        <div class="core-field">
          <label>Nivel de Imposición *</label>
          <select name="enforcement_level">
            ${Object.entries(ENFORCEMENT_LABELS)
              .map(([k, v]) => `<option value="${k}" ${(ad?.enforcement_level || 'total_imposition') === k ? 'selected' : ''}>${esc(v)}</option>`)
              .join('')}
          </select>
        </div>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>Texto Botón CTA</label>
          <input name="cta_text" value="${esc(ad?.cta_text || 'Ver más')}" />
        </div>
        <div class="core-field">
          <label>Tipo de Enlace CTA</label>
          <select name="cta_type">
            <option value="external" ${ad?.cta_type === 'external' ? 'selected' : ''}>URL Externa</option>
            <option value="internal" ${ad?.cta_type === 'internal' ? 'selected' : ''}>Ruta Interna (#/feed, #/studio…)</option>
            <option value="whatsapp" ${ad?.cta_type === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
          </select>
        </div>
        <div class="core-field">
          <label>URL Destino CTA</label>
          <input name="cta_url" value="${esc(ad?.cta_url || '')}" placeholder="https://… o #/explore" />
        </div>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>Frecuencia (cada N posts / hrs)</label>
          <input name="frequency_every_n" type="number" min="1" max="50" value="${esc(ad?.frequency_every_n ?? 6)}" class="mono" />
        </div>
        <div class="core-field">
          <label>Prioridad (1-100)</label>
          <input name="priority" type="number" min="1" max="100" value="${esc(ad?.priority ?? 50)}" class="mono" />
        </div>
        <div class="core-field">
          <label>Tope Impresiones (0 = ilimitado)</label>
          <input name="max_impressions" type="number" min="0" value="${esc(ad?.max_impressions ?? 0)}" class="mono" />
        </div>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>País (ALL o código ISO: DO, MX, US)</label>
          <input name="target_country" value="${esc(ad?.target_country || 'ALL')}" class="mono" />
        </div>
        <div class="core-field">
          <label>Ciudad (opcional)</label>
          <input name="target_city" value="${esc(ad?.target_city || '')}" placeholder="Todas" />
        </div>
        <div class="core-field">
          <label>Plataforma</label>
          <select name="target_platform">
            <option value="all" ${(ad?.target_platform || 'all') === 'all' ? 'selected' : ''}>Todas (Web + App)</option>
            <option value="web" ${ad?.target_platform === 'web' ? 'selected' : ''}>Solo Web</option>
            <option value="android" ${ad?.target_platform === 'android' ? 'selected' : ''}>Solo Android</option>
            <option value="ios" ${ad?.target_platform === 'ios' ? 'selected' : ''}>Solo iOS</option>
          </select>
        </div>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>Inicio programado (opcional)</label>
          <input name="starts_at" type="datetime-local" value="${ad?.starts_at ? new Date(ad.starts_at).toISOString().slice(0, 16) : ''}" />
        </div>
        <div class="core-field">
          <label>Fin programado (opcional)</label>
          <input name="ends_at" type="datetime-local" value="${ad?.ends_at ? new Date(ad.ends_at).toISOString().slice(0, 16) : ''}" />
        </div>
        <div class="core-field">
          <label>Estado Inicial</label>
          <select name="is_active">
            <option value="true" ${ad?.is_active !== false ? 'selected' : ''}>Activo inmediatamente</option>
            <option value="false" ${ad?.is_active === false ? 'selected' : ''}>Pausado (Borrador)</option>
          </select>
        </div>
      </div>

      <div class="core-actions-row" style="justify-content:flex-end">
        <button type="submit" class="btn-gold">${isEdit ? 'Guardar Cambios' : 'Lanzar Anuncio Global'}</button>
      </div>
    </form>
  `,
    (body) => {
      body.querySelector('#platAdForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const payload = {
          title: fd.get('title'),
          body: fd.get('body'),
          format: fd.get('format'),
          media_url: fd.get('media_url'),
          cta_text: fd.get('cta_text'),
          cta_type: fd.get('cta_type'),
          cta_url: fd.get('cta_url'),
          enforcement_level: fd.get('enforcement_level'),
          frequency_every_n: Number(fd.get('frequency_every_n') || 6),
          priority: Number(fd.get('priority') || 50),
          max_impressions: Number(fd.get('max_impressions') || 0),
          target_country: String(fd.get('target_country') || 'ALL').toUpperCase(),
          target_city: fd.get('target_city'),
          target_platform: fd.get('target_platform'),
          starts_at: fd.get('starts_at') ? new Date(String(fd.get('starts_at'))).toISOString() : null,
          ends_at: fd.get('ends_at') ? new Date(String(fd.get('ends_at'))).toISOString() : null,
          is_active: fd.get('is_active') === 'true',
        };
        try {
          if (isEdit) {
            await api(`/ads/${ad.id}`, { method: 'PUT', body: payload });
            toast('Anuncio actualizado en tiempo real', 'ok');
          } else {
            await api('/ads', { method: 'POST', body: payload });
            toast('Anuncio de plataforma publicado', 'ok');
          }
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    }
  );
}

async function openAdAnalyticsModal(adId) {
  openModal(`Analítica de Anuncio #${adId}`, `<p class="mono" style="color:var(--c-muted)">Cargando métricas…</p>`);
  try {
    const data = await api(`/ads/${adId}/analytics`);
    const a = data.ad || {};
    const ctr = a.impressions_count > 0 ? ((a.clicks_count / a.impressions_count) * 100).toFixed(2) : '0.00';
    const rows = (data.daily || []).length
      ? data.daily
          .map(
            (d) => `
        <tr>
          <th scope="row" class="mono">${esc(String(d.day || '').slice(0, 10))}</th>
          <td data-label="Impresiones" class="mono">${fmtNum(d.impressions)}</td>
          <td data-label="Clics" class="mono">${fmtNum(d.clicks)}</td>
          <td data-label="CTR" class="mono">${d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(2) : '0.00'}%</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="4" style="text-align:center;color:var(--c-muted)">Aún sin eventos registrados por día.</td></tr>`;

    openModal(
      `Analítica · ${a.title || `#${adId}`}`,
      `
      <div class="core-kpi-grid">
        <div class="core-kpi"><div class="core-kpi-lbl">Impresiones</div><div class="core-kpi-val mono">${fmtNum(a.impressions_count)}</div></div>
        <div class="core-kpi"><div class="core-kpi-lbl">Clics</div><div class="core-kpi-val mono">${fmtNum(a.clicks_count)}</div></div>
        <div class="core-kpi"><div class="core-kpi-lbl">CTR</div><div class="core-kpi-val mono">${ctr}%</div></div>
      </div>
      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Día</th><th>Impresiones</th><th>Clics</th><th>CTR</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
    );
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function renderAdsView(vp) {
  const data = await api('/ads');
  const ads = data.ads || [];
  const totalImps = ads.reduce((s, a) => s + Number(a.impressions_count || 0), 0);
  const totalClicks = ads.reduce((s, a) => s + Number(a.clicks_count || 0), 0);
  const activeCount = ads.filter((a) => a.is_active).length;

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Motor de Publicidad Impuesta (Web &amp; App)</h2>
        <p>Inyecta anuncios oficiales en Feed, Banners Fijos, Intersticiales o Secciones con control de imposición total.</p>
      </div>
      <button type="button" class="btn-gold" id="newPlatAdBtn">+ Crear Anuncio Plataforma</button>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Anuncios Activos</span><i class="led led--green"></i></div><div class="core-kpi-val mono">${fmtNum(activeCount)} / ${fmtNum(ads.length)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Impresiones Globales</span></div><div class="core-kpi-val mono">${fmtNum(totalImps)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Clics Totales</span></div><div class="core-kpi-val mono">${fmtNum(totalClicks)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>CTR Promedio</span></div><div class="core-kpi-val mono">${totalImps > 0 ? ((totalClicks / totalImps) * 100).toFixed(2) : '0.00'}%</div></div>
    </div>

    <div class="core-panel">
      <div class="core-table-wrap">
        <table class="core-table">
          <thead>
            <tr>
              <th>Anuncio</th><th>Formato</th><th>Imposición</th><th>Segmento</th><th>Entrega (Imp / Clics / CTR)</th><th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${
              ads.length
                ? ads
                    .map(
                      (a) => `
                <tr>
                  <th scope="row">
                    <div>${esc(a.title)}</div>
                    <div style="font-size:11px;color:var(--c-muted);font-weight:400">${esc((a.body || '').slice(0, 80))}</div>
                  </th>
                  <td data-label="Formato"><span class="led-badge">${esc(AD_FORMATS[a.format] || a.format)}</span></td>
                  <td data-label="Imposición">
                    <span class="led-badge ${
                      a.enforcement_level === 'total_imposition'
                        ? 'led-badge--red'
                        : a.enforcement_level === 'non_premium'
                        ? 'led-badge--amber'
                        : 'led-badge--green'
                    }">${esc(a.enforcement_level)}</span>
                  </td>
                  <td data-label="Segmento" class="mono">${esc(a.target_country || 'ALL')} · ${esc(a.target_platform || 'all')} · P${a.priority}</td>
                  <td data-label="Entrega" class="mono">${fmtNum(a.impressions_count)} / ${fmtNum(a.clicks_count)} / <strong>${esc(a.ctr)}%</strong></td>
                  <td data-label="Activo">
                    <button type="button" class="tactical-toggle tactical-toggle--ok" role="switch" aria-checked="${a.is_active ? 'true' : 'false'}" data-toggle-ad="${a.id}" title="Activar / Pausar"></button>
                  </td>
                  <td data-label="Acciones">
                    <div class="core-table-actions">
                      <button type="button" class="action-pill" data-analytics-ad="${a.id}">Métricas</button>
                      <button type="button" class="action-pill action-pill--primary" data-edit-ad="${a.id}">Editar</button>
                      <button type="button" class="action-pill action-pill--danger" data-delete-ad="${a.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>`
                    )
                    .join('')
                : `<tr><td colspan="7" style="text-align:center;color:var(--c-muted);padding:24px">No hay anuncios de plataforma creados aún. Pulsa "+ Crear Anuncio Plataforma".</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('newPlatAdBtn')?.addEventListener('click', () => openAdEditorModal(null, () => renderAdsView(vp)));
  vp.querySelectorAll('[data-edit-ad]').forEach((b) =>
    b.addEventListener('click', () => {
      const ad = ads.find((x) => x.id === Number(b.dataset.editAd));
      if (ad) openAdEditorModal(ad, () => renderAdsView(vp));
    })
  );
  vp.querySelectorAll('[data-toggle-ad]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/ads/${b.dataset.toggleAd}/toggle`, { method: 'PATCH' });
        toast('Estado del anuncio actualizado', 'ok');
        renderAdsView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-analytics-ad]').forEach((b) =>
    b.addEventListener('click', () => openAdAnalyticsModal(Number(b.dataset.analyticsAd)))
  );
  vp.querySelectorAll('[data-delete-ad]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar permanentemente este anuncio de plataforma?')) return;
      try {
        await api(`/ads/${b.dataset.deleteAd}`, { method: 'DELETE' });
        toast('Anuncio eliminado', 'ok');
        renderAdsView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

/* ==================== MODULE 3: USERS GOD MODE + PLAN BYPASS + CÉDULA REQUESTS ==================== */

function openQuickPlanModal(user, onSaved) {
  openModal(
    `Credo One & Insignias · @${user.username}`,
    `
    <form id="quickPlanForm" class="core-form">
      <div class="core-alert">Bypass Manual Super-Admin: otorga o revoca cualquier suscripción de Credo One sin cobro PayPal y queda auditado.</div>
      <div class="core-form-grid">
        <div class="core-field">
          <label>Plan Activo</label>
          <select name="plan_sku">
            <option value="" ${!user.active_plan_sku ? 'selected' : ''}>Free (Revocar Credo One)</option>
            <option value="user_one_plus" ${user.active_plan_sku === 'user_one_plus' ? 'selected' : ''}>Credo One+ (Personal)</option>
            <option value="user_one_pro" ${user.active_plan_sku === 'user_one_pro' ? 'selected' : ''}>Credo One Pro (Personal)</option>
            <option value="biz_one_plus" ${user.active_plan_sku === 'biz_one_plus' ? 'selected' : ''}>Business One+</option>
            <option value="biz_one_pro" ${user.active_plan_sku === 'biz_one_pro' ? 'selected' : ''}>Business One Pro</option>
            <option value="biz_one_enterprise" ${user.active_plan_sku === 'biz_one_enterprise' ? 'selected' : ''}>Business One Enterprise</option>
          </select>
        </div>
        <div class="core-field">
          <label>Vence el (vacío = Vitalicio / Perpetuo)</label>
          <input name="expires_at" type="date" value="${user.plan_expires_at ? new Date(user.plan_expires_at).toISOString().slice(0, 10) : ''}" />
        </div>
      </div>

      <div class="core-form-grid">
        <div class="core-field">
          <label>Estilo de Avatar</label>
          <select name="avatar_style">
            <option value="circle" ${(user.avatar_style || 'circle') === 'circle' ? 'selected' : ''}>Círculo Estándar</option>
            <option value="squircle_blue" ${user.avatar_style === 'squircle_blue' ? 'selected' : ''}>Squircle Zafiro</option>
            <option value="squircle_gold" ${user.avatar_style === 'squircle_gold' ? 'selected' : ''}>Squircle Dorado</option>
          </select>
        </div>
        <div class="core-field">
          <label>Delta Impresiones Studio (+/-)</label>
          <input name="impressions_delta" type="number" value="0" class="mono" />
        </div>
      </div>

      <div class="core-form-grid">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="verified_badge" ${user.verification_status === 'verified' ? 'checked' : ''} /> Insignia Verificado
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="one_badge" ${user.one_badge ? 'checked' : ''} /> Insignia Credo One
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="is_cto" ${user.is_cto ? 'checked' : ''} /> Insignia Exclusiva CTO
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="is_ceo" ${user.is_ceo ? 'checked' : ''} /> Insignia Exclusiva CEO
        </label>
      </div>

      <div class="core-field">
        <label>Motivo / Nota de Auditoría</label>
        <input name="note" placeholder="Cortesía ejecutiva, alianza parroquial, patrocinador…" />
      </div>

      <div class="core-actions-row" style="justify-content:flex-end">
        <button type="submit" class="btn-gold">Aplicar Credo One / Insignias</button>
      </div>
    </form>
  `,
    (body) => {
      body.querySelector('#quickPlanForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await api(`/users/${user.id}/plan`, {
            method: 'POST',
            body: {
              plan_sku: String(fd.get('plan_sku') || ''),
              expires_at: fd.get('expires_at') ? new Date(`${fd.get('expires_at')}T23:59:59Z`).toISOString() : null,
              avatar_style: fd.get('avatar_style'),
              impressions_delta: Number(fd.get('impressions_delta') || 0),
              verified_badge: fd.get('verified_badge') === 'on',
              one_badge: fd.get('one_badge') === 'on',
              is_cto: fd.get('is_cto') === 'on',
              is_ceo: fd.get('is_ceo') === 'on',
              note: fd.get('note'),
            },
          });
          toast('Plan e insignias actualizados con éxito', 'ok');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    }
  );
}

function openModerateModal(user, onSaved) {
  openModal(
    `Sancionar / Moderar · @${user.username}`,
    `
    <form id="modUserForm" class="core-form">
      <div class="core-field">
        <label>Acción disciplinaria</label>
        <select name="action">
          <option value="warn">Enviar Advertencia Oficial (Push/In-App)</option>
          <option value="mute">Silenciar (No puede publicar ni comentar)</option>
          <option value="shadowban">Shadowban (Sus posts solo los ve él)</option>
          <option value="suspend">Suspensión Temporal (Bloquea acceso)</option>
          <option value="ban">Baneo Permanente</option>
          <option value="restore">Restaurar Cuenta (Quitar sanciones)</option>
        </select>
      </div>
      <div class="core-form-grid">
        <div class="core-field">
          <label>Duración (horas, para Mute / Suspensión)</label>
          <input name="hours" type="number" min="1" value="24" class="mono" />
        </div>
        <div class="core-field">
          <label>Opciones Adicionales</label>
          <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
            <label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:500;color:var(--c-ink-2)">
              <input type="checkbox" name="ban_ip" /> Bloquear también su última IP (${esc(user.last_ip || 'N/A')})
            </label>
            <label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:500;color:var(--c-ink-2)">
              <input type="checkbox" name="hide_content" /> Ocultar todas sus publicaciones
            </label>
          </div>
        </div>
      </div>
      <div class="core-field">
        <label>Motivo (visible para advertencias y auditoría)</label>
        <textarea name="reason" rows="2" required placeholder="Describe el motivo de la medida…"></textarea>
      </div>
      <div class="core-actions-row" style="justify-content:flex-end">
        <button type="submit" class="btn-danger">Ejecutar Acción</button>
      </div>
    </form>
  `,
    (body) => {
      body.querySelector('#modUserForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await api(`/users/${user.id}/moderate`, {
            method: 'POST',
            body: {
              action: fd.get('action'),
              hours: Number(fd.get('hours') || 24),
              reason: fd.get('reason'),
              ban_ip: fd.get('ban_ip') === 'on',
              hide_content: fd.get('hide_content') === 'on',
            },
          });
          toast('Acción de moderación ejecutada', 'ok');
          closeModal();
          if (onSaved) onSaved();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    }
  );
}

async function impersonateUser(userId) {
  try {
    const res = await api(`/users/${userId}/impersonate`, { method: 'POST' });
    if (res.url) {
      window.open(res.url, '_blank', 'noopener');
      toast(`Sesión fantasma abierta como @${res.username}`, 'ok');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function renderUsersView(vp) {
  const tab = state.activeTabs.users || 'directory';
  const f = state.userFilters;
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  if (f.plan) qs.set('plan', f.plan);
  if (f.status) qs.set('status', f.status);

  const [usersRes, reqsRes] = await Promise.all([
    api(`/users?${qs.toString()}`),
    api('/registration-requests'),
  ]);
  const users = usersRes.users || [];
  const requests = reqsRes.requests || [];
  const pendingReqs = requests.filter((r) => r.status === 'pending').length;

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Usuarios God Mode &amp; Solicitudes de Cédula</h2>
        <p>Control total sobre cuentas, cédulas descifradas, planes Credo One, insignias, sanciones e impersonación.</p>
      </div>
    </div>

    <div class="core-panel">
      <div class="core-tabs">
        <button type="button" class="core-tab ${tab === 'directory' ? 'is-active' : ''}" data-u-tab="directory">Padrón de Usuarios (${users.length})</button>
        <button type="button" class="core-tab ${tab === 'requests' ? 'is-active' : ''}" data-u-tab="requests">Solicitudes Cédula / Clero (${pendingReqs} pendientes)</button>
      </div>

      ${
        tab === 'directory'
          ? `
        <form id="usersFilterForm" class="core-filter-bar">
          <input name="q" type="search" value="${esc(f.q)}" placeholder="Nombre, @usuario, email, teléfono, cédula o IP…" style="flex:1;min-width:220px" />
          <select name="plan">
            <option value="">Todos los planes</option>
            <option value="free" ${f.plan === 'free' ? 'selected' : ''}>Solo Free</option>
            <option value="credo_one" ${f.plan === 'credo_one' ? 'selected' : ''}>Cualquier Credo One</option>
            <option value="user_one_plus" ${f.plan === 'user_one_plus' ? 'selected' : ''}>Credo One+</option>
            <option value="user_one_pro" ${f.plan === 'user_one_pro' ? 'selected' : ''}>Credo One Pro</option>
            <option value="biz_one_plus" ${f.plan === 'biz_one_plus' ? 'selected' : ''}>Business One+</option>
            <option value="biz_one_pro" ${f.plan === 'biz_one_pro' ? 'selected' : ''}>Business One Pro</option>
            <option value="biz_one_enterprise" ${f.plan === 'biz_one_enterprise' ? 'selected' : ''}>Enterprise</option>
          </select>
          <select name="status">
            <option value="">Todos los estados</option>
            <option value="active" ${f.status === 'active' ? 'selected' : ''}>Activos</option>
            <option value="muted" ${f.status === 'muted' ? 'selected' : ''}>Silenciados</option>
            <option value="shadowbanned" ${f.status === 'shadowbanned' ? 'selected' : ''}>Shadowbanned</option>
            <option value="suspended" ${f.status === 'suspended' ? 'selected' : ''}>Suspendidos</option>
            <option value="banned" ${f.status === 'banned' ? 'selected' : ''}>Baneados</option>
          </select>
          <button type="submit" class="btn-primary">Filtrar</button>
        </form>

        <div class="core-table-wrap">
          <table class="core-table">
            <thead>
              <tr><th>Usuario</th><th>Cédula / Contacto</th><th>Plan</th><th>Estado</th><th>Última IP</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              ${
                users.length
                  ? users
                      .map((u) => {
                        const modSt = u.moderation_status && u.moderation_status !== 'active' ? u.moderation_status : u.account_status || 'active';
                        const badges = [
                          u.is_cto ? '<span class="led-badge led-badge--gold">CTO</span>' : '',
                          u.is_ceo ? '<span class="led-badge led-badge--gold">CEO</span>' : '',
                          u.role === 'super_admin' ? '<span class="led-badge led-badge--red">SUPER</span>' : '',
                        ].join(' ');
                        return `
                  <tr>
                    <th scope="row">
                      <a href="/diosesmiguia/users/${u.id}" data-route="/diosesmiguia/users/${u.id}" style="text-decoration:none;color:var(--c-ink)">
                        <strong>${esc(u.full_name)}</strong>
                        <div class="mono" style="font-size:11px;color:var(--c-muted)">@${esc(u.username)} · #${u.id} · ${esc(u.ecclesiastical_rank || 'laico')}</div>
                      </a>
                      <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${badges}</div>
                    </th>
                    <td data-label="Cédula">
                      <div class="mono">${esc(u.cedula || 'Sin cédula')}</div>
                      <div style="font-size:11px;color:var(--c-muted)">${esc(u.email)} ${u.phone ? `· ${esc(u.phone)}` : ''}</div>
                    </td>
                    <td data-label="Plan">${planBadge(u.active_plan_sku)}</td>
                    <td data-label="Estado">${statusBadge(modSt)}</td>
                    <td data-label="IP" class="mono">${esc(u.last_ip || '—')}</td>
                    <td data-label="Acciones">
                      <div class="core-table-actions">
                        <a href="/diosesmiguia/users/${u.id}" data-route="/diosesmiguia/users/${u.id}" class="action-pill action-pill--primary">Expediente</a>
                        <button type="button" class="action-pill action-pill--gold" data-u-plan="${u.id}">Plan/Credo</button>
                        <button type="button" class="action-pill action-pill--danger" data-u-mod="${u.id}">Sanción</button>
                        <button type="button" class="action-pill" data-u-imp="${u.id}">Impersonar</button>
                      </div>
                    </td>
                  </tr>`;
                      })
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:24px">No se encontraron usuarios con esos filtros.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead>
              <tr><th>Solicitante</th><th>Cédula vs Padrón Oficial</th><th>Rango / Cargo</th><th>Estado</th><th>Fecha / IP</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              ${
                requests.length
                  ? requests
                      .map(
                        (r) => `
                  <tr>
                    <th scope="row">
                      <div>${esc(r.title_prefix ? `${r.title_prefix} ` : '')}${esc(r.full_name)}</div>
                      <div class="mono" style="font-size:11px;color:var(--c-muted)">${esc(r.email)} · ${esc(r.phone || 'Sin tel')}</div>
                    </th>
                    <td data-label="Cédula">
                      <div class="mono"><strong>${esc(r.cedula || '—')}</strong> ${r.cedula_verified_source ? `<span class="led-badge">${esc(r.cedula_verified_source)}</span>` : ''}</div>
                      <div style="font-size:11px;color:${r.cedula_name_matched ? 'var(--c-green)' : 'var(--c-amber)'}">
                        ${r.cedula_official_name ? `Padrón: ${esc(r.cedula_official_name)}` : 'Sin coincidencia automática — Revisión manual'}
                      </div>
                      ${
                        r.cedula_photo_id
                          ? `<button type="button" class="action-pill action-pill--gold" style="margin-top:4px" data-view-ced-photo="${r.cedula_photo_id}" data-view-ced-name="${esc(r.full_name)}" data-view-ced-ocr="${esc(r.cedula_ocr_text || '')}">Ver Foto Cédula</button>`
                          : ''
                      }
                    </td>
                    <td data-label="Rango">
                      <div>${esc(r.ecclesiastical_rank || r.request_kind)}</div>
                      <div style="font-size:11px;color:var(--c-muted)">${esc(r.current_office_title || '')}</div>
                    </td>
                    <td data-label="Estado">${statusBadge(r.status)}</td>
                    <td data-label="Fecha / IP" class="mono">${esc(fmtDate(r.created_at))}<div style="font-size:11px;color:var(--c-muted)">${esc(r.ip_address || '—')}</div></td>
                    <td data-label="Acciones">
                      ${
                        r.status === 'pending'
                          ? `<div class="core-table-actions">
                              <button type="button" class="action-pill action-pill--green" data-req-approve="${r.id}">Aprobar</button>
                              <button type="button" class="action-pill action-pill--danger" data-req-reject="${r.id}">Rechazar</button>
                            </div>`
                          : `<span class="mono" style="font-size:11px;color:var(--c-muted)">${esc(r.review_note || r.status)}</span>`
                      }
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:24px">Sin solicitudes de registro.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  vp.querySelectorAll('[data-view-ced-photo]').forEach((b) =>
    b.addEventListener('click', () => {
      const pid = b.dataset.viewCedPhoto;
      const nm = b.dataset.viewCedName || 'Solicitante';
      const ocr = b.dataset.viewCedOcr || '';
      openModal(
        `Foto Privada de Cédula · ${nm}`,
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          <img src="/api/admin/cedula-photo/${encodeURIComponent(pid)}?token=${encodeURIComponent(state.token)}" alt="Cédula de ${esc(nm)}" style="width:100%;max-height:420px;object-fit:contain;border-radius:8px;border:1px solid var(--c-border);background:#000" />
          ${ocr ? `<div><div style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:4px">TEXTO DETECTADO POR OCR</div><pre class="core-pre">${esc(ocr)}</pre></div>` : ''}
        </div>
      `
      );
    })
  );

  vp.querySelectorAll('[data-u-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.activeTabs.users = b.dataset.uTab;
      renderUsersView(vp);
    })
  );

  $('usersFilterForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.userFilters = {
      q: String(fd.get('q') || '').trim(),
      plan: String(fd.get('plan') || ''),
      status: String(fd.get('status') || ''),
    };
    renderUsersView(vp);
  });

  vp.querySelectorAll('[data-u-plan]').forEach((b) =>
    b.addEventListener('click', () => {
      const u = users.find((x) => x.id === Number(b.dataset.uPlan));
      if (u) openQuickPlanModal(u, () => renderUsersView(vp));
    })
  );
  vp.querySelectorAll('[data-u-mod]').forEach((b) =>
    b.addEventListener('click', () => {
      const u = users.find((x) => x.id === Number(b.dataset.uMod));
      if (u) openModerateModal(u, () => renderUsersView(vp));
    })
  );
  vp.querySelectorAll('[data-u-imp]').forEach((b) =>
    b.addEventListener('click', () => impersonateUser(Number(b.dataset.uImp)))
  );
  vp.querySelectorAll('[data-req-approve]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/registration-requests/${b.dataset.reqApprove}/approve`, { method: 'POST', body: {} });
        toast('Solicitud aprobada y cuenta activada', 'ok');
        renderUsersView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-req-reject]').forEach((b) =>
    b.addEventListener('click', async () => {
      const note = prompt('Motivo del rechazo (opcional):', 'Datos o cédula no verificables');
      if (note === null) return;
      try {
        await api(`/registration-requests/${b.dataset.reqReject}/reject`, { method: 'POST', body: { note } });
        toast('Solicitud rechazada', 'ok');
        renderUsersView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

/* ==================== USER 360° DOSSIER (/diosesmiguia/users/:id) ==================== */

async function renderUserDossierView(vp, userId) {
  const data = await api(`/users/${userId}`);
  const u = data.user;
  const tab = state.activeTabs.dossier || 'profile';
  const modSt = u.moderation_status && u.moderation_status !== 'active' ? u.moderation_status : u.account_status || 'active';

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <a href="/diosesmiguia/users" data-route="/diosesmiguia/users" class="action-pill">← Volver al Padrón</a>
          <h2>${esc(u.full_name)} <span class="mono" style="font-size:14px;color:var(--c-muted)">@${esc(u.username)} · #${u.id}</span></h2>
          ${planBadge(u.active_plan_sku)}
          ${statusBadge(modSt)}
        </div>
        <p class="mono">Cédula: ${esc(u.cedula || 'Sin cédula')} ${u.cedula_official_name ? `(${esc(u.cedula_official_name)})` : ''} ${u.cedula_verified_source ? `· Fuente: ${esc(u.cedula_verified_source)}` : ''} · Última IP: ${esc(u.last_ip || '—')} · Registro: ${esc(fmtDate(u.created_at))}</p>
      </div>
      <div class="core-actions-row">
        ${u.cedula_photo_id ? `<button type="button" class="btn-ghost" id="dosCedPhotoBtn">Ver Foto Cédula</button>` : ''}
        <button type="button" class="btn-gold" id="dosPlanBtn">Otorgar Credo One / Insignias</button>
        <button type="button" class="btn-primary" id="dosImpBtn">Impersonar Cuenta ↗</button>
        <button type="button" class="btn-ghost" id="dosLogoutBtn">Forzar Logout</button>
        <button type="button" class="btn-danger" id="dosModBtn">Sancionar</button>
      </div>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi"><div class="core-kpi-lbl">Publicaciones</div><div class="core-kpi-val mono">${fmtNum(data.posts?.length)}</div><div class="core-kpi-sub mono">${fmtNum(data.videos?.length)} videos</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl">Seguidores</div><div class="core-kpi-val mono">${fmtNum(u.followers_count)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl">IPs Registradas</div><div class="core-kpi-val mono">${fmtNum(data.ip_history?.length)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl">Pagos / Reportes</div><div class="core-kpi-val mono">${fmtNum(data.transactions?.length)} / ${fmtNum(data.reports?.length)}</div></div>
    </div>

    <div class="core-panel">
      <div class="core-tabs">
        <button type="button" class="core-tab ${tab === 'profile' ? 'is-active' : ''}" data-d-tab="profile">Editor Total de Perfil</button>
        <button type="button" class="core-tab ${tab === 'posts' ? 'is-active' : ''}" data-d-tab="posts">Posts &amp; Media (${data.posts?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'ips' ? 'is-active' : ''}" data-d-tab="ips">Historial IPs (${data.ip_history?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'billing' ? 'is-active' : ''}" data-d-tab="billing">Suscripciones &amp; Pagos (${data.transactions?.length || 0})</button>
      </div>

      ${
        tab === 'profile'
          ? `
        <form id="dosProfileForm" class="core-form">
          <div class="core-form-grid">
            <div class="core-field"><label>Nombre Completo</label><input name="full_name" value="${esc(u.full_name || '')}" required /></div>
            <div class="core-field"><label>Username (@)</label><input name="username" value="${esc(u.username || '')}" required class="mono" /></div>
            <div class="core-field"><label>Correo Electrónico</label><input name="email" type="email" value="${esc(u.email || '')}" required /></div>
            <div class="core-field"><label>Teléfono</label><input name="phone" value="${esc(u.phone || '')}" class="mono" /></div>
          </div>
          <div class="core-form-grid">
            <div class="core-field"><label>Rango Eclesiástico</label><input name="ecclesiastical_rank" value="${esc(u.ecclesiastical_rank || '')}" /></div>
            <div class="core-field"><label>Cargo / Parroquia</label><input name="current_office_title" value="${esc(u.current_office_title || '')}" /></div>
            <div class="core-field"><label>País (ISO)</label><input name="country_code" value="${esc(u.country_code || 'DO')}" class="mono" /></div>
            <div class="core-field">
              <label>Rol en Plataforma</label>
              <select name="role">
                <option value="user" ${(u.role || 'user') === 'user' ? 'selected' : ''}>Usuario</option>
                <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Moderador</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
              </select>
            </div>
          </div>
          <div class="core-form-grid">
            <div class="core-field"><label>URL Avatar</label><input name="avatar_url" value="${esc(u.avatar_url || '')}" /></div>
            <div class="core-field"><label>URL Portada</label><input name="cover_url" value="${esc(u.cover_url || '')}" /></div>
            <div class="core-field"><label>Sitio Web</label><input name="website_url" value="${esc(u.website_url || '')}" /></div>
            <div class="core-field"><label>Nueva Contraseña (opcional, mín 8 car.)</label><input name="new_password" type="password" placeholder="Dejar vacío para no cambiar" /></div>
          </div>
          <div class="core-field"><label>Biografía</label><textarea name="bio" rows="3">${esc(u.bio || '')}</textarea></div>
          <div class="core-field"><label>Lema / Motto</label><input name="motto" value="${esc(u.motto || '')}" /></div>
          <div class="core-actions-row" style="justify-content:space-between">
            <button type="button" class="btn-danger" id="dosDeleteUserBtn">Eliminar Cuenta Definitivamente</button>
            <button type="submit" class="btn-primary">Guardar Cambios del Perfil</button>
          </div>
        </form>`
          : tab === 'posts'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>ID / Título</th><th>Tipo</th><th>Interacciones</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (data.posts || []).length
                  ? data.posts
                      .map(
                        (p) => `
                  <tr>
                    <th scope="row">#${p.id} ${esc(p.title || (p.content || '').slice(0, 70))}</th>
                    <td data-label="Tipo" class="mono">${esc(p.media_kind || 'post')}</td>
                    <td data-label="Stats" class="mono">${fmtNum(p.amen_count)} amén · ${fmtNum(p.comments_count)} com</td>
                    <td data-label="Estado">${p.is_hidden ? statusBadge('hidden') : p.is_pinned ? '<span class="led-badge led-badge--gold">FIJADO</span>' : statusBadge('active')}</td>
                    <td data-label="Fecha" class="mono">${esc(fmtDate(p.created_at))}</td>
                    <td data-label="Acciones">
                      <button type="button" class="action-pill action-pill--danger" data-del-post="${p.id}">Eliminar</button>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Este usuario no tiene publicaciones.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : tab === 'ips'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>IP</th><th>Geo</th><th>Dispositivo</th><th>Hits</th><th>Última vez</th><th>Acción</th></tr></thead>
            <tbody>
              ${
                (data.ip_history || []).length
                  ? data.ip_history
                      .map(
                        (h) => `
                  <tr>
                    <th scope="row" class="mono">${esc(h.ip_address)}</th>
                    <td data-label="Geo" class="mono">${esc([h.country_code, h.city].filter(Boolean).join(' · ') || '—')}</td>
                    <td data-label="Equipo" class="mono">${esc(h.device_type || 'web')}</td>
                    <td data-label="Hits" class="mono">${fmtNum(h.hits_count)}</td>
                    <td data-label="Última vez" class="mono">${esc(fmtDate(h.last_seen_at))}</td>
                    <td data-label="Acción"><button type="button" class="action-pill action-pill--danger" data-quick-ban-ip="${esc(h.ip_address)}">Ban IP</button></td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Sin IPs registradas.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Fecha</th><th>Plan / Concepto</th><th>Monto</th><th>Estado</th><th>PayPal ID</th></tr></thead>
            <tbody>
              ${
                (data.transactions || []).length
                  ? data.transactions
                      .map(
                        (t) => `
                  <tr>
                    <th scope="row" class="mono">${esc(fmtDate(t.created_at))}</th>
                    <td data-label="Concepto">${esc(t.description || t.plan_sku || '—')}</td>
                    <td data-label="Monto" class="mono">${fmtUsd(Number(t.amount_cents || 0) / 100)}</td>
                    <td data-label="Estado">${statusBadge(t.status)}</td>
                    <td data-label="PayPal" class="mono">${esc(t.paypal_sale_id || '—')}</td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Sin transacciones de pago.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  $('dosCedPhotoBtn')?.addEventListener('click', () => {
    openModal(
      `Foto Privada de Cédula · ${u.full_name}`,
      `
      <div style="display:flex;flex-direction:column;gap:12px">
        <img src="/api/admin/cedula-photo/${encodeURIComponent(u.cedula_photo_id)}?token=${encodeURIComponent(state.token)}" alt="Cédula de ${esc(u.full_name)}" style="width:100%;max-height:420px;object-fit:contain;border-radius:8px;border:1px solid var(--c-border);background:#000" />
        ${u.cedula_ocr_text ? `<div><div style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:4px">TEXTO OCR (${esc(u.cedula_verified_source || 'photo_ocr')})</div><pre class="core-pre">${esc(u.cedula_ocr_text)}</pre></div>` : ''}
      </div>
    `
    );
  });
  $('dosPlanBtn')?.addEventListener('click', () => openQuickPlanModal(u, () => renderUserDossierView(vp, userId)));
  $('dosModBtn')?.addEventListener('click', () => openModerateModal(u, () => renderUserDossierView(vp, userId)));
  $('dosImpBtn')?.addEventListener('click', () => impersonateUser(u.id));
  $('dosLogoutBtn')?.addEventListener('click', async () => {
    try {
      await api(`/users/${u.id}/force-logout`, { method: 'POST' });
      toast('Sesiones revocadas instantáneamente', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  vp.querySelectorAll('[data-d-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.activeTabs.dossier = b.dataset.dTab;
      renderUserDossierView(vp, userId);
    })
  );

  $('dosProfileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    if (!body.new_password) delete body.new_password;
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body });
      toast('Perfil actualizado correctamente', 'ok');
      renderUserDossierView(vp, userId);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('dosDeleteUserBtn')?.addEventListener('click', async () => {
    if (!confirm(`¿ELIMINAR PERMANENTEMENTE a @${u.username}? Esta acción no se puede deshacer.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast('Cuenta eliminada', 'ok');
      navigate('/diosesmiguia/users');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  vp.querySelectorAll('[data-del-post]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta publicación y borrar su media del 4 TB Edge?')) return;
      try {
        await api(`/content/${b.dataset.delPost}`, { method: 'DELETE' });
        toast('Publicación eliminada', 'ok');
        renderUserDossierView(vp, userId);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

/* ==================== MODULE 4: CONTENT, LIVE, MODERATION & EDITORIAL ==================== */

async function renderContentView(vp) {
  const tab = state.activeTabs.content || 'posts';
  const cf = state.contentFilters;
  const qs = new URLSearchParams({ kind: cf.kind || 'all', q: cf.q || '' });
  const [contentRes, editRes] = await Promise.all([
    api(`/content?${qs.toString()}`),
    api('/editorial'),
  ]);

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Contenido, Media 4 TB &amp; Editorial Oficial</h2>
        <p>Fija, oculta, bloquea comentarios o elimina publicaciones borrando el archivo físico del servidor de 4 TB.</p>
      </div>
    </div>

    <div class="core-panel">
      <div class="core-tabs">
        <button type="button" class="core-tab ${tab === 'posts' ? 'is-active' : ''}" data-c-tab="posts">Publicaciones &amp; Videos (${contentRes.posts?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'prayers' ? 'is-active' : ''}" data-c-tab="prayers">Muro de Oración (${contentRes.prayers?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'editorial' ? 'is-active' : ''}" data-c-tab="editorial">Editorial Oficial (${editRes.posts?.length || 0})</button>
      </div>

      ${
        tab === 'posts'
          ? `
        <form id="contentFilterForm" class="core-filter-bar">
          <input name="q" type="search" value="${esc(cf.q)}" placeholder="Buscar por título, texto o autor…" style="flex:1;min-width:220px" />
          <select name="kind">
            <option value="all" ${cf.kind === 'all' ? 'selected' : ''}>Todo el contenido</option>
            <option value="video" ${cf.kind === 'video' ? 'selected' : ''}>Solo Videos</option>
            <option value="photo" ${cf.kind === 'photo' ? 'selected' : ''}>Solo Fotos</option>
            <option value="article" ${cf.kind === 'article' ? 'selected' : ''}>Solo Texto</option>
            <option value="hidden" ${cf.kind === 'hidden' ? 'selected' : ''}>Ocultos por Moderación</option>
          </select>
          <button type="submit" class="btn-primary">Filtrar</button>
        </form>
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Publicación</th><th>Autor</th><th>Media / Peso</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (contentRes.posts || []).length
                  ? contentRes.posts
                      .map(
                        (p) => `
                  <tr>
                    <th scope="row">
                      <div>#${p.id} ${esc(p.title || (p.content || '').slice(0, 72))}</div>
                      <div class="mono" style="font-size:11px;color:var(--c-muted)">${esc(fmtDate(p.created_at))} · ${fmtNum(p.amen_count)} amén · ${fmtNum(p.comments_count)} com</div>
                    </th>
                    <td data-label="Autor">
                      <a href="/diosesmiguia/users/${p.author_id}" data-route="/diosesmiguia/users/${p.author_id}" style="color:var(--c-blue-hi);text-decoration:none">@${esc(p.author_username)}</a>
                    </td>
                    <td data-label="Media" class="mono">${esc(p.media_kind || 'post')} ${p.media_bytes > 0 ? `· ${fmtBytes(p.media_bytes)}` : ''}</td>
                    <td data-label="Estado">
                      <div class="core-table-actions">
                        ${p.is_pinned ? '<span class="led-badge led-badge--gold">FIJADO</span>' : ''}
                        ${p.is_hidden ? '<span class="led-badge led-badge--red">OCULTO</span>' : ''}
                        ${p.comments_disabled ? '<span class="led-badge led-badge--amber">SIN COMENT.</span>' : ''}
                        ${!p.is_pinned && !p.is_hidden && !p.comments_disabled ? statusBadge('active') : ''}
                      </div>
                    </td>
                    <td data-label="Acciones">
                      <div class="core-table-actions">
                        <button type="button" class="action-pill action-pill--gold" data-post-patch="${p.id}" data-field="is_pinned" data-val="${!p.is_pinned}">${p.is_pinned ? 'Desfijar' : 'Fijar'}</button>
                        <button type="button" class="action-pill" data-post-patch="${p.id}" data-field="is_hidden" data-val="${!p.is_hidden}">${p.is_hidden ? 'Mostrar' : 'Ocultar'}</button>
                        <button type="button" class="action-pill" data-post-patch="${p.id}" data-field="comments_disabled" data-val="${!p.comments_disabled}">${p.comments_disabled ? 'Abrir Com.' : 'Cerrar Com.'}</button>
                        <button type="button" class="action-pill action-pill--danger" data-post-del="${p.id}">Eliminar + 4TB</button>
                      </div>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Sin publicaciones encontradas.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : tab === 'prayers'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Autor</th><th>Categoría</th><th>Intención</th><th>Rezos</th><th>Fecha</th><th>Acción</th></tr></thead>
            <tbody>
              ${
                (contentRes.prayers || []).length
                  ? contentRes.prayers
                      .map(
                        (pr) => `
                  <tr>
                    <th scope="row">${esc(pr.author_display || 'Anónimo')}</th>
                    <td data-label="Categoría">${esc(pr.category || 'general')} ${pr.is_urgent ? '<span class="led-badge led-badge--red">URGENTE</span>' : ''}</td>
                    <td data-label="Intención">${esc((pr.content || '').slice(0, 120))}</td>
                    <td data-label="Rezos" class="mono">${fmtNum(pr.prayers_count)}</td>
                    <td data-label="Fecha" class="mono">${esc(fmtDate(pr.created_at))}</td>
                    <td data-label="Acción"><button type="button" class="action-pill action-pill--danger" data-prayer-del="${pr.id}">Eliminar</button></td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Sin intenciones de oración.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : `
        <form id="editorialForm" class="core-form">
          <div class="core-form-grid">
            <div class="core-field"><label>Título Editorial / Anuncio *</label><input name="title" required placeholder="Ej. Evangelio del Día o Comunicado Oficial Credo" /></div>
            <div class="core-field">
              <label>Tipo</label>
              <select name="post_type">
                <option value="announcement">Comunicado Oficial</option>
                <option value="reflection">Reflexión / Evangelio</option>
                <option value="homily">Homilía</option>
              </select>
            </div>
            <div class="core-field"><label>Cita Bíblica (opcional)</label><input name="scripture_ref" placeholder="Jn 3, 16" /></div>
          </div>
          <div class="core-field"><label>Contenido *</label><textarea name="content" rows="3" required placeholder="Escribe el anuncio o reflexión oficial…"></textarea></div>
          <div class="core-form-grid">
            <div class="core-field"><label>Imagen URL (opcional)</label><input name="image_url" placeholder="https://media.credoapp.tech/…" /></div>
            <label style="display:flex;align-items:center;gap:8px;padding-top:18px;cursor:pointer"><input type="checkbox" name="is_pinned" checked /> Fijar arriba en el Feed global</label>
          </div>
          <div><button type="submit" class="btn-gold">Publicar en Editorial Oficial</button></div>
        </form>
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Título</th><th>Tipo</th><th>Cita</th><th>Fecha</th><th>Acción</th></tr></thead>
            <tbody>
              ${(editRes.posts || [])
                .map(
                  (ep) => `
                <tr>
                  <th scope="row">${esc(ep.title)}</th>
                  <td data-label="Tipo" class="mono">${esc(ep.post_type)}</td>
                  <td data-label="Cita">${esc(ep.scripture_ref || '—')}</td>
                  <td data-label="Fecha" class="mono">${esc(fmtDate(ep.created_at))}</td>
                  <td data-label="Acción"><button type="button" class="action-pill action-pill--danger" data-post-del="${ep.id}">Eliminar</button></td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  vp.querySelectorAll('[data-c-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.activeTabs.content = b.dataset.cTab;
      renderContentView(vp);
    })
  );
  $('contentFilterForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.contentFilters = { kind: String(fd.get('kind') || 'all'), q: String(fd.get('q') || '').trim() };
    renderContentView(vp);
  });
  vp.querySelectorAll('[data-post-patch]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/content/${b.dataset.postPatch}`, {
          method: 'PATCH',
          body: { [b.dataset.field]: b.dataset.val === 'true' },
        });
        toast('Publicación actualizada', 'ok');
        renderContentView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-post-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar definitivamente esta publicación y borrar su archivo del 4 TB Edge?')) return;
      try {
        await api(`/content/${b.dataset.postDel}`, { method: 'DELETE' });
        toast('Eliminado de PostgreSQL y 4 TB Edge', 'ok');
        renderContentView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-prayer-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/prayers/${b.dataset.prayerDel}`, { method: 'DELETE' });
        toast('Intención eliminada', 'ok');
        renderContentView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  $('editorialForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api('/editorial', {
        method: 'POST',
        body: {
          title: fd.get('title'),
          post_type: fd.get('post_type'),
          scripture_ref: fd.get('scripture_ref'),
          content: fd.get('content'),
          image_url: fd.get('image_url'),
          is_pinned: fd.get('is_pinned') === 'on',
        },
      });
      toast('Editorial oficial publicada', 'ok');
      renderContentView(vp);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function renderLiveView(vp) {
  const data = await api('/live');
  const channels = data.channels || [];

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Consola de Transmisiones En Vivo &amp; Radio</h2>
        <p>Fija emisoras en posición #1, dispara notificaciones globales de transmisión o corta la señal de emergencia.</p>
      </div>
    </div>

    <div class="core-panel">
      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Canal / Emisora</th><th>Programa Actual</th><th>Oyentes</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${
              channels.length
                ? channels
                    .map(
                      (c) => `
                <tr>
                  <th scope="row">
                    <div>${esc(c.name)} ${c.is_hero ? '<span class="led-badge led-badge--gold">#1 HERO</span>' : ''}</div>
                    <div class="mono" style="font-size:11px;color:var(--c-muted)">${esc(c.frequency || c.city || '')}</div>
                  </th>
                  <td data-label="Programa">${esc(c.current_program || c.tagline || '—')}</td>
                  <td data-label="Oyentes" class="mono">${fmtNum(c.listeners_count)}</td>
                  <td data-label="Estado">${statusBadge(c.is_live ? 'live' : 'paused')}</td>
                  <td data-label="Acciones">
                    <div class="core-table-actions">
                      <button type="button" class="action-pill action-pill--gold" data-live-pin="${c.id}">Fijar #1</button>
                      <button type="button" class="action-pill action-pill--primary" data-live-push="${c.id}">Push Global</button>
                      <button type="button" class="action-pill ${c.is_live ? 'action-pill--danger' : 'action-pill--green'}" data-live-cut="${c.id}" data-next="${!c.is_live}">${c.is_live ? 'Cortar Señal' : 'Restaurar'}</button>
                    </div>
                  </td>
                </tr>`
                    )
                    .join('')
                : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Sin canales registrados.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  vp.querySelectorAll('[data-live-pin]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/live/${b.dataset.livePin}/pin`, { method: 'POST' });
        toast('Canal fijado como #1 Hero', 'ok');
        renderLiveView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-live-push]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Enviar notificación push global anunciando esta transmisión en vivo?')) return;
      try {
        const res = await api(`/live/${b.dataset.livePush}/highlight`, { method: 'POST' });
        toast(`Notificación enviada a ${fmtNum(res.sent)} usuarios`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
  vp.querySelectorAll('[data-live-cut]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/live/${b.dataset.liveCut}/cut`, {
          method: 'POST',
          body: { is_live: b.dataset.next === 'true' },
        });
        toast('Estado de señal actualizado', 'ok');
        renderLiveView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

async function renderModerationView(vp) {
  const data = await api('/moderation/reports');
  const reports = data.reports || [];
  const words = data.banned_words || [];

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Cola de Moderación &amp; Filtro de Palabras</h2>
        <p>Resuelve denuncias de la comunidad y gestiona el filtro automático de lenguaje prohibido.</p>
      </div>
    </div>

    <div class="core-panel">
      <h3 class="core-panel-title">Reportes Recibidos (${reports.length})</h3>
      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Objetivo</th><th>Motivo</th><th>Reportado por</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${
              reports.length
                ? reports
                    .map(
                      (r) => `
                <tr>
                  <th scope="row">
                    <span class="mono">${esc(r.target_type)} #${r.target_id}</span>
                    <div style="font-size:11px;color:var(--c-muted);font-weight:400">${esc(r.post_title || r.target_full_name || r.target_username || '')}</div>
                  </th>
                  <td data-label="Motivo">${esc(r.reason)} ${r.details ? `<div style="font-size:11px;color:var(--c-muted)">${esc(r.details)}</div>` : ''}</td>
                  <td data-label="Reportó" class="mono">${esc(r.reporter_username ? `@${r.reporter_username}` : 'Anónimo')}</td>
                  <td data-label="Estado">${statusBadge(r.status)}</td>
                  <td data-label="Acciones">
                    ${
                      r.status === 'pending'
                        ? `<div class="core-table-actions">
                            <button type="button" class="action-pill" data-rep-res="${r.id}" data-act="dismiss">Descartar</button>
                            <button type="button" class="action-pill action-pill--gold" data-rep-res="${r.id}" data-act="delete_warn">Borrar + Aviso</button>
                            <button type="button" class="action-pill action-pill--danger" data-rep-res="${r.id}" data-act="shadowban">Shadowban</button>
                            <button type="button" class="action-pill action-pill--danger" data-rep-res="${r.id}" data-act="ban">Ban</button>
                          </div>`
                        : `<span class="mono" style="font-size:11px;color:var(--c-muted)">${esc(r.resolution_note || r.status)}</span>`
                    }
                  </td>
                </tr>`
                    )
                    .join('')
                : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Cola de reportes limpia.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="core-panel">
      <h3 class="core-panel-title">Filtro Automático de Palabras Prohibidas</h3>
      <p class="core-panel-sub">Separa por comas o saltos de línea. Cualquier publicación o comentario que contenga estas palabras será bloqueado.</p>
      <form id="bannedWordsForm" class="core-form">
        <div class="core-field">
          <textarea name="words" rows="4" class="mono" placeholder="spam, estafa, insulto…">${esc(words.join(', '))}</textarea>
        </div>
        <div><button type="submit" class="btn-primary">Guardar Lista de Bloqueo (${words.length} palabras)</button></div>
      </form>
    </div>
  `;

  vp.querySelectorAll('[data-rep-res]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/moderation/reports/${b.dataset.repRes}/resolve`, {
          method: 'POST',
          body: { resolution: b.dataset.act },
        });
        toast('Reporte resuelto', 'ok');
        renderModerationView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );

  $('bannedWordsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api('/moderation/banned-words', {
        method: 'PUT',
        body: { words: String(fd.get('words') || '') },
      });
      toast(`Lista actualizada (${res.words.length} palabras)`, 'ok');
      renderModerationView(vp);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

/* ==================== MODULE 5: FINANCE, STUDIO CAMPAIGNS, PAYPAL WEBHOOKS, CRM ==================== */

async function renderFinanceView(vp) {
  const tab = state.activeTabs.finance || 'overview';
  const [fin, campsRes, whRes, leadsRes] = await Promise.all([
    api('/finance/overview'),
    api('/campaigns'),
    api('/webhooks/paypal'),
    api('/enterprise-leads'),
  ]);
  const k = fin.kpis || {};
  const maxMonth = Math.max(1, ...(fin.monthly_series || []).map((m) => Number(m.usd || 0)));

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Contabilidad, Campañas Studio &amp; PayPal</h2>
        <p>MRR/ARR en vivo, libro contable exportable, campañas pagas ($1/día = 500 alcance), webhooks PayPal y CRM Enterprise.</p>
      </div>
      <div class="core-actions-row">
        <a href="/api/admin/finance/export.csv?token=${encodeURIComponent(state.token)}" class="btn-gold" download>Exportar CSV Contable</a>
      </div>
    </div>

    <div class="core-kpi-grid">
      <div class="core-kpi"><div class="core-kpi-lbl"><span>MRR Recurrente</span><i class="led led--green"></i></div><div class="core-kpi-val mono">${fmtUsd(k.mrr_usd)}</div><div class="core-kpi-sub mono">ARR: ${fmtUsd(k.arr_usd)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Ingresos Hoy / Mes</span></div><div class="core-kpi-val mono">${fmtUsd(k.today_usd)}</div><div class="core-kpi-sub mono">Este mes: ${fmtUsd(k.month_usd)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Histórico Total</span><i class="led led--gold"></i></div><div class="core-kpi-val mono">${fmtUsd(k.all_time_usd)}</div><div class="core-kpi-sub mono">Campañas Studio: ${fmtUsd(k.campaigns_usd)}</div></div>
      <div class="core-kpi"><div class="core-kpi-lbl"><span>Suscripciones Activas</span></div><div class="core-kpi-val mono">${fmtNum(k.active_subs)}</div><div class="core-kpi-sub mono">+${fmtNum(k.new_subs_30d)} nuevas · ${fmtNum(k.churn_30d)} bajas (30d)</div></div>
    </div>

    <div class="core-panel">
      <div class="core-tabs">
        <button type="button" class="core-tab ${tab === 'overview' ? 'is-active' : ''}" data-f-tab="overview">Ingresos &amp; Transacciones</button>
        <button type="button" class="core-tab ${tab === 'campaigns' ? 'is-active' : ''}" data-f-tab="campaigns">Campañas Studio (${campsRes.campaigns?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'webhooks' ? 'is-active' : ''}" data-f-tab="webhooks">Webhooks PayPal (${whRes.events?.length || 0})</button>
        <button type="button" class="core-tab ${tab === 'leads' ? 'is-active' : ''}" data-f-tab="leads">Leads Enterprise CRM (${leadsRes.leads?.length || 0})</button>
      </div>

      ${
        tab === 'overview'
          ? `
        <div class="core-grid-2">
          <div class="core-panel" style="background:var(--c-card)">
            <h3 class="core-panel-title">Ingresos Mensuales (Últimos 6 Meses)</h3>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:140px;padding-top:12px">
              ${(fin.monthly_series || [])
                .map((m) => {
                  const pct = Math.max(4, Math.round((Number(m.usd || 0) / maxMonth) * 100));
                  return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
                  <span class="mono" style="font-size:10px;color:var(--c-ink-2)">${fmtUsd(m.usd)}</span>
                  <div style="width:100%;height:${pct}%;background:var(--c-gold);border-radius:4px 4px 0 0"></div>
                  <span class="mono" style="font-size:10px;color:var(--c-muted)">${esc(m.month)}</span>
                </div>`;
                })
                .join('')}
            </div>
          </div>

          <div class="core-panel" style="background:var(--c-card)">
            <h3 class="core-panel-title">Ingresos por Plan / Concepto</h3>
            <div class="core-table-wrap">
              <table class="core-table">
                <thead><tr><th>Plan</th><th>Tx</th><th>Total USD</th></tr></thead>
                <tbody>
                  ${
                    (fin.by_plan || []).length
                      ? fin.by_plan
                          .map(
                            (bp) => `
                      <tr>
                        <th scope="row">${planBadge(bp.plan_sku === 'other' ? '' : bp.plan_sku)}</th>
                        <td data-label="Tx" class="mono">${fmtNum(bp.tx_count)}</td>
                        <td data-label="Total" class="mono"><strong>${fmtUsd(bp.total_usd)}</strong></td>
                      </tr>`
                          )
                          .join('')
                      : `<tr><td colspan="3" style="text-align:center;color:var(--c-muted)">Aún sin cobros completados.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Plan / Descripción</th><th>Monto</th><th>Estado</th><th>PayPal Sale ID</th></tr></thead>
            <tbody>
              ${
                (fin.transactions || []).length
                  ? fin.transactions
                      .map(
                        (t) => `
                  <tr>
                    <th scope="row" class="mono">${esc(fmtDate(t.created_at))}</th>
                    <td data-label="Cliente">${t.username ? `@${esc(t.username)}` : esc(t.email || '—')}</td>
                    <td data-label="Concepto">${esc(t.description || PLAN_LABELS[t.plan_sku] || t.plan_sku || '—')}</td>
                    <td data-label="Monto" class="mono"><strong>${fmtUsd(Number(t.amount_cents || 0) / 100)}</strong></td>
                    <td data-label="Estado">${statusBadge(t.status)}</td>
                    <td data-label="PayPal ID" class="mono">${esc(t.paypal_sale_id || '—')}</td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Sin transacciones registradas.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : tab === 'campaigns'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Campaña</th><th>Organización / Creador</th><th>Presupuesto</th><th>Alcance (Servido / Meta)</th><th>Estado / Pago</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (campsRes.campaigns || []).length
                  ? campsRes.campaigns
                      .map(
                        (c) => `
                  <tr>
                    <th scope="row">
                      <div>#${c.id} ${esc(c.title || '(Sin título)')}</div>
                      <div style="font-size:11px;color:var(--c-muted);font-weight:400">${esc(String(c.body || '').slice(0, 90))}</div>
                    </th>
                    <td data-label="Cliente">${esc(c.org_name || '—')}<div class="mono" style="font-size:11px;color:var(--c-muted)">@${esc(c.creator_username || '—')}</div></td>
                    <td data-label="Presupuesto" class="mono"><strong>${fmtUsd(Number(c.total_budget_cents || 0) / 100)}</strong><div style="font-size:11px;color:var(--c-muted)">${fmtUsd(Number(c.daily_budget_cents || 0) / 100)}/d × ${c.duration_days || 1}d</div></td>
                    <td data-label="Alcance" class="mono">${fmtNum(c.impressions_served)} / ${fmtNum(c.impressions_allocated)} · CTR ${esc(c.ctr)}%</td>
                    <td data-label="Estado">${statusBadge(c.status)} ${statusBadge(c.payment_status || 'unpaid')}</td>
                    <td data-label="Acciones">
                      <button type="button" class="action-pill action-pill--gold" data-camp-edit="${c.id}">Administrar</button>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Sin campañas creadas en Credo One Studio.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : tab === 'webhooks'
          ? `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Fecha</th><th>Evento PayPal</th><th>Event ID</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (whRes.events || []).length
                  ? whRes.events
                      .map(
                        (w) => `
                  <tr>
                    <th scope="row" class="mono">${esc(fmtDate(w.created_at))}</th>
                    <td data-label="Tipo" class="mono">${esc(w.event_type)}</td>
                    <td data-label="Event ID" class="mono">${esc(w.paypal_event_id || `#${w.id}`)}</td>
                    <td data-label="Estado">${statusBadge(w.status)} ${w.error_message ? `<div style="font-size:11px;color:var(--c-red)">${esc(w.error_message)}</div>` : ''}</td>
                    <td data-label="Acciones">
                      <div class="core-table-actions">
                        <button type="button" class="action-pill" data-wh-view="${w.id}">Ver JSON</button>
                        <button type="button" class="action-pill action-pill--gold" data-wh-replay="${w.id}">Reprocesar</button>
                      </div>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Aún no se han recibido webhooks de PayPal.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
          : `
        <div class="core-table-wrap">
          <table class="core-table">
            <thead><tr><th>Organización</th><th>Contacto</th><th>Estado</th><th>Objetivo / Notas Internas</th><th>Acciones</th></tr></thead>
            <tbody>
              ${
                (leadsRes.leads || []).length
                  ? leadsRes.leads
                      .map(
                        (l) => `
                  <tr>
                    <th scope="row">${esc(l.company_name || 'Sin nombre')}<div class="mono" style="font-size:11px;color:var(--c-muted)">RNC: ${esc(l.tax_id || '—')} · ${esc(l.contact_role || '—')}</div></th>
                    <td data-label="Contacto">${esc(l.contact_name || '')}<div class="mono" style="font-size:11px;color:var(--c-muted)">${esc(l.corporate_email || '')} · ${esc(l.whatsapp_phone || '')}</div></td>
                    <td data-label="Estado">${statusBadge(l.status || 'new')}</td>
                    <td data-label="Notas">${esc(l.internal_notes || l.campaign_goal || '—')}</td>
                    <td data-label="Acciones">
                      <div class="core-table-actions">
                        <button type="button" class="action-pill" data-lead-note="${l.id}">Editar CRM</button>
                        <button type="button" class="action-pill action-pill--gold" data-lead-act="${l.id}">Activar Enterprise</button>
                      </div>
                    </td>
                  </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">No hay solicitudes Enterprise registradas.</td></tr>`
              }
            </tbody>
          </table>
        </div>`
      }
    </div>
  `;

  vp.querySelectorAll('[data-f-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.activeTabs.finance = b.dataset.fTab;
      renderFinanceView(vp);
    })
  );

  vp.querySelectorAll('[data-camp-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = (campsRes.campaigns || []).find((x) => x.id === Number(b.dataset.campEdit));
      if (!c) return;
      openModal(
        `Administrar Campaña #${c.id} · ${c.title || ''}`,
        `
        <form id="campAdminForm" class="core-form">
          <div class="core-form-grid">
            <div class="core-field">
              <label>Estado Campaña</label>
              <select name="status">
                ${['active', 'paused', 'pending_payment', 'completed', 'rejected']
                  .map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="core-field">
              <label>Estado Pago</label>
              <select name="payment_status">
                ${['paid', 'comped', 'unpaid', 'refunded']
                  .map((s) => `<option value="${s}" ${c.payment_status === s ? 'selected' : ''}>${s}</option>`)
                  .join('')}
              </select>
            </div>
          </div>
          <div class="core-field">
            <label>Alcance / Impresiones Asignadas</label>
            <input name="impressions_allocated" type="number" min="500" value="${Number(c.impressions_allocated || 500)}" class="mono" />
          </div>
          <div class="core-actions-row" style="justify-content:flex-end">
            <button type="submit" class="btn-gold">Guardar Cambios</button>
          </div>
        </form>
      `,
        (body) => {
          body.querySelector('#campAdminForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            try {
              await api(`/campaigns/${c.id}`, {
                method: 'PATCH',
                body: {
                  status: fd.get('status'),
                  payment_status: fd.get('payment_status'),
                  impressions_allocated: Number(fd.get('impressions_allocated') || 500),
                },
              });
              toast('Campaña actualizada', 'ok');
              closeModal();
              renderFinanceView(vp);
            } catch (err) {
              toast(err.message, 'err');
            }
          });
        }
      );
    })
  );

  vp.querySelectorAll('[data-wh-view]').forEach((b) =>
    b.addEventListener('click', () => {
      const w = (whRes.events || []).find((x) => x.id === Number(b.dataset.whView));
      if (!w) return;
      openModal(`Payload Webhook #${w.id} (${w.event_type})`, `<pre class="core-pre">${esc(JSON.stringify(w.payload_json || {}, null, 2))}</pre>`);
    })
  );

  vp.querySelectorAll('[data-wh-replay]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        const res = await api(`/webhooks/paypal/${b.dataset.whReplay}/reprocess`, { method: 'POST' });
        toast(res.ok ? 'Webhook reprocesado con éxito' : `Reproceso devolvió HTTP ${res.status}`, res.ok ? 'ok' : 'err');
        renderFinanceView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );

  vp.querySelectorAll('[data-lead-note]').forEach((b) =>
    b.addEventListener('click', () => {
      const l = (leadsRes.leads || []).find((x) => x.id === Number(b.dataset.leadNote));
      if (!l) return;
      openModal(
        `CRM Lead #${l.id} · ${l.company_name || ''}`,
        `
        <form id="leadCrmForm" class="core-form">
          <div class="core-field">
            <label>Estado del Lead</label>
            <select name="status">
              ${['new', 'contacted', 'proposal', 'active', 'closed']
                .map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
          <div class="core-field">
            <label>Notas Internas CRM</label>
            <textarea name="internal_notes" rows="4">${esc(l.internal_notes || '')}</textarea>
          </div>
          <div class="core-actions-row" style="justify-content:flex-end"><button type="submit" class="btn-primary">Guardar</button></div>
        </form>
      `,
        (body) => {
          body.querySelector('#leadCrmForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            try {
              await api(`/enterprise-leads/${l.id}`, {
                method: 'PATCH',
                body: { status: fd.get('status'), internal_notes: fd.get('internal_notes') },
              });
              toast('Lead CRM actualizado', 'ok');
              closeModal();
              renderFinanceView(vp);
            } catch (err) {
              toast(err.message, 'err');
            }
          });
        }
      );
    })
  );

  vp.querySelectorAll('[data-lead-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Activar instantáneamente el Plan Business One Enterprise para este cliente?')) return;
      try {
        await api(`/enterprise-leads/${b.dataset.leadAct}/activate`, { method: 'POST' });
        toast('Plan Enterprise activado', 'ok');
        renderFinanceView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

/* ==================== MODULE 6: BROADCASTS, KILL SWITCHES & AUDIT LOGS ==================== */

async function renderBroadcastView(vp) {
  const data = await api('/broadcasts');
  const broadcasts = data.broadcasts || [];

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Centro de Broadcasts &amp; Avisos Push</h2>
        <p>Envía notificaciones inmediatas in-app a toda la comunidad, por plan, por país o a un usuario específico.</p>
      </div>
    </div>

    <div class="core-panel">
      <h3 class="core-panel-title">Nuevo Broadcast Global / Segmentado</h3>
      <form id="broadcastForm" class="core-form">
        <div class="core-form-grid">
          <div class="core-field"><label>Título *</label><input name="title" required placeholder="Ej. Novedad importante en Credo" /></div>
          <div class="core-field">
            <label>Audiencia</label>
            <select name="audience" id="bcAudienceSelect">
              <option value="all">Todos los usuarios activos</option>
              <option value="free">Solo usuarios Free</option>
              <option value="credo_one">Solo miembros Credo One</option>
              <option value="country">Por País (ISO)</option>
              <option value="user">Usuario específico (ID)</option>
            </select>
          </div>
          <div class="core-field"><label>Deep Link (opcional)</label><input name="deep_link" value="#/feed" class="mono" /></div>
        </div>
        <div class="core-form-grid" id="bcExtraSeg" hidden>
          <div class="core-field"><label>Código País (ej. DO, MX, US)</label><input name="country" class="mono" placeholder="DO" /></div>
          <div class="core-field"><label>ID de Usuario</label><input name="user_id" type="number" class="mono" placeholder="123" /></div>
        </div>
        <div class="core-field"><label>Mensaje *</label><textarea name="body" rows="3" required placeholder="Escribe el mensaje que verán al abrir la app…"></textarea></div>
        <div><button type="submit" class="btn-gold">Disparar Broadcast Ahora</button></div>
      </form>
    </div>

    <div class="core-panel">
      <h3 class="core-panel-title">Historial de Broadcasts Enviados</h3>
      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Fecha</th><th>Título / Mensaje</th><th>Segmento</th><th>Entregados</th><th>Enviado por</th></tr></thead>
          <tbody>
            ${
              broadcasts.length
                ? broadcasts
                    .map(
                      (b) => `
                <tr>
                  <th scope="row" class="mono">${esc(fmtDate(b.created_at))}</th>
                  <td data-label="Mensaje"><strong>${esc(b.title)}</strong><div style="font-size:11px;color:var(--c-muted)">${esc((b.body || '').slice(0, 100))}</div></td>
                  <td data-label="Segmento" class="mono">${esc(JSON.stringify(b.segment_filter || {}))}</td>
                  <td data-label="Entregados" class="mono"><strong>${fmtNum(b.sent_count)}</strong></td>
                  <td data-label="Admin" class="mono">@${esc(b.created_by_name || 'admin')}</td>
                </tr>`
                    )
                    .join('')
                : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:20px">Sin broadcasts previos.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('bcAudienceSelect')?.addEventListener('change', (e) => {
    const val = e.target.value;
    $('bcExtraSeg').hidden = val !== 'country' && val !== 'user';
  });

  $('broadcastForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api('/broadcasts', {
        method: 'POST',
        body: {
          title: fd.get('title'),
          body: fd.get('body'),
          deep_link: fd.get('deep_link') || '#/feed',
          audience: fd.get('audience'),
          country: fd.get('country'),
          user_id: fd.get('user_id') ? Number(fd.get('user_id')) : null,
        },
      });
      toast(`Broadcast entregado a ${fmtNum(res.broadcast?.sent_count)} cuentas`, 'ok');
      renderBroadcastView(vp);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function renderSettingsView(vp) {
  const data = await api('/settings');
  const s = data.settings || {};

  const switches = [
    { key: 'maintenance_mode', title: 'Modo Mantenimiento Global', desc: 'Cierra la API pública (503) excepto Credo Core OS para emergencias.' },
    { key: 'block_registrations', title: 'Bloquear Nuevos Registros', desc: 'Impide nuevas altas de fieles o clero en toda la plataforma.' },
    { key: 'pause_media_uploads', title: 'Pausar Subidas de Media (4 TB Edge)', desc: 'Detiene uploads de fotos, videos y avatares temporalmente.' },
    { key: 'pause_live_streams', title: 'Pausar Transmisiones En Vivo', desc: 'Desactiva temporalmente los streams públicos de radio/video.' },
    { key: 'pause_global_ads', title: 'Pausar Publicidad Global', desc: 'Silencia temporalmente todos los anuncios impuestos y patrocinados.' },
    { key: 'pause_paypal_checkout', title: 'Pausar Pagos PayPal', desc: 'Bloquea nuevas órdenes PayPal de Credo One y Studio.' },
  ];

  const minVer = s.min_mobile_version || { android: '1.0.0', ios: '1.0.0', force_update: false };
  const cp = s.cedula_providers || { enable_dgii: true, enable_photo_ocr: true };

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Interruptores de Emergencia &amp; Motor de Cédula</h2>
        <p>Controles críticos en tiempo real y configuración de las 3 capas de verificación de identidad (JCE/Verifik, DGII y Foto OCR).</p>
      </div>
    </div>

    <div class="core-panel">
      <h3 class="core-panel-title">Interruptores Tácticos del Sistema</h3>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${switches
          .map((sw) => {
            const on = Boolean(s[sw.key]?.enabled);
            return `
          <div class="core-switch-row">
            <div>
              <strong>${esc(sw.title)}</strong>
              <small>${esc(sw.desc)}</small>
            </div>
            <button type="button" class="tactical-toggle" role="switch" aria-checked="${on ? 'true' : 'false'}" data-ks-key="${sw.key}"></button>
          </div>`;
          })
          .join('')}
      </div>

      <form id="ksMetaForm" class="core-form" style="margin-top:8px">
        <div class="core-field">
          <label>Mensaje de Modo Mantenimiento</label>
          <input name="maint_msg" value="${esc(s.maintenance_mode?.message || 'Credo está en mantenimiento programado. Volvemos en minutos.')}" />
        </div>
        <div class="core-form-grid">
          <div class="core-field"><label>Versión Mínima Android</label><input name="android" value="${esc(minVer.android || '1.0.0')}" class="mono" /></div>
          <div class="core-field"><label>Versión Mínima iOS</label><input name="ios" value="${esc(minVer.ios || '1.0.0')}" class="mono" /></div>
          <label style="display:flex;align-items:center;gap:8px;padding-top:18px;cursor:pointer">
            <input type="checkbox" name="force_update" ${minVer.force_update ? 'checked' : ''} /> Forzar actualización obligatoria
          </label>
        </div>
        <div><button type="submit" class="btn-primary">Guardar Configuración de Emergencia</button></div>
      </form>
    </div>

    <div class="core-panel">
      <div class="core-panel-head">
        <div>
          <h3 class="core-panel-title">Verificación de Cédula · Cascada de 3 Capas</h3>
          <p class="core-panel-sub">Capa 1: API Oficial JCE/Verifik (100% padrón incl. 402-...) → Capa 2: DGII gratis → Capa 3: Foto de Cédula + OCR Tesseract en servidor → Cola Manual.</p>
        </div>
        <span class="led-badge ${cp.has_verifik_token ? 'led-badge--green' : 'led-badge--amber'}">
          <i class="led ${cp.has_verifik_token ? 'led--green' : 'led--amber'}"></i>
          ${cp.has_verifik_token ? 'JCE / Verifik ACTIVO' : 'DGII + Foto OCR ACTIVOS'}
        </span>
      </div>
      <form id="cedulaProvForm" class="core-form">
        <div class="core-form-grid">
          <div class="core-field">
            <label>Verifik API Token (Padrón JCE 100%) ${cp.has_verifik_token ? '· [CONFIGURADO]' : ''}</label>
            <input name="verifik_token" type="password" placeholder="${cp.has_verifik_token ? 'Token guardado · Deja vacío para mantener' : 'Pega aquí tu Bearer Token de Verifik…'}" class="mono" />
          </div>
          <div class="core-field">
            <label>API JCE / OGTIC Personalizada (URL con {cedula})</label>
            <input name="custom_api_url" value="${esc(cp.custom_api_url || '')}" placeholder="https://tu-proveedor.do/api/cedula/{cedula}" class="mono" />
          </div>
          <div class="core-field">
            <label>API Key Personalizada ${cp.has_custom_api_key ? '· [CONFIGURADA]' : ''}</label>
            <input name="custom_api_key" type="password" placeholder="${cp.has_custom_api_key ? 'Key guardada · Deja vacío para mantener' : 'Opcional'}" class="mono" />
          </div>
        </div>
        <div class="core-form-grid">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" name="enable_dgii" ${cp.enable_dgii !== false ? 'checked' : ''} /> Activar Capa 2: Padrón Público DGII
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" name="enable_photo_ocr" ${cp.enable_photo_ocr !== false ? 'checked' : ''} /> Activar Capa 3: Verificación Instantánea con Foto + OCR
          </label>
        </div>
        <div><button type="submit" class="btn-gold">Guardar Motor de Cédula</button></div>
      </form>
    </div>
  `;

  vp.querySelectorAll('[data-ks-key]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const key = btn.dataset.ksKey;
      const next = btn.getAttribute('aria-checked') !== 'true';
      if (key === 'maintenance_mode' && next && !confirm('¿ACTIVAR MODO MANTENIMIENTO GLOBAL? Los usuarios públicos verán 503.')) return;
      try {
        const cur = s[key] || {};
        await api('/settings', {
          method: 'PUT',
          body: { settings: { [key]: { ...cur, enabled: next } } },
        });
        toast(`${key}: ${next ? 'ACTIVADO' : 'DESACTIVADO'}`, next ? 'err' : 'ok');
        renderSettingsView(vp);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );

  $('ksMetaForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          settings: {
            maintenance_mode: { ...(s.maintenance_mode || {}), message: String(fd.get('maint_msg') || '') },
            min_mobile_version: {
              android: String(fd.get('android') || '1.0.0'),
              ios: String(fd.get('ios') || '1.0.0'),
              force_update: fd.get('force_update') === 'on',
            },
          },
        },
      });
      toast('Parámetros del sistema guardados', 'ok');
      renderSettingsView(vp);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('cedulaProvForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          settings: {
            cedula_providers: {
              verifik_token: String(fd.get('verifik_token') || '').trim(),
              custom_api_url: String(fd.get('custom_api_url') || '').trim(),
              custom_api_key: String(fd.get('custom_api_key') || '').trim(),
              enable_dgii: fd.get('enable_dgii') === 'on',
              enable_photo_ocr: fd.get('enable_photo_ocr') === 'on',
            },
          },
        },
      });
      toast('Motor de verificación de cédula actualizado', 'ok');
      renderSettingsView(vp);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function renderAuditView(vp) {
  const data = await api(`/audit?q=${encodeURIComponent(state.auditFilter || '')}&limit=150`);
  const logs = data.logs || [];

  vp.innerHTML = `
    <div class="core-page-head">
      <div>
        <h2>Audit Logs Forenses (Inmutables)</h2>
        <p>Registro completo de cada acción ejecutada en Credo Core OS con estado Antes/Después e IP de origen.</p>
      </div>
      <a href="/api/admin/audit/export.csv?token=${encodeURIComponent(state.token)}" class="btn-gold" download>Exportar Audit CSV</a>
    </div>

    <div class="core-panel">
      <form id="auditFilterForm" class="core-filter-bar">
        <input name="q" type="search" value="${esc(state.auditFilter)}" placeholder="Filtrar por acción, admin, entidad, ID o IP…" style="flex:1;min-width:240px" />
        <button type="submit" class="btn-primary">Buscar</button>
      </form>

      <div class="core-table-wrap">
        <table class="core-table">
          <thead><tr><th>Fecha</th><th>Admin</th><th>Acción</th><th>Entidad</th><th>IP</th><th>Diff</th></tr></thead>
          <tbody>
            ${
              logs.length
                ? logs
                    .map(
                      (l) => `
                <tr>
                  <th scope="row" class="mono">${esc(fmtDate(l.created_at))}</th>
                  <td data-label="Admin" class="mono">@${esc(l.admin_name || 'super_admin')}</td>
                  <td data-label="Acción"><span class="led-badge led-badge--blue">${esc(l.action)}</span></td>
                  <td data-label="Entidad" class="mono">${esc(l.target_type || '')} #${esc(l.target_id || '')}</td>
                  <td data-label="IP" class="mono">${esc(l.ip_address || '—')}</td>
                  <td data-label="Diff"><button type="button" class="action-pill" data-audit-diff="${l.id}">Inspeccionar</button></td>
                </tr>`
                    )
                    .join('')
                : `<tr><td colspan="6" style="text-align:center;color:var(--c-muted);padding:20px">Sin eventos de auditoría que coincidan.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('auditFilterForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.auditFilter = String(fd.get('q') || '').trim();
    renderAuditView(vp);
  });

  vp.querySelectorAll('[data-audit-diff]').forEach((b) =>
    b.addEventListener('click', () => {
      const log = logs.find((x) => x.id === Number(b.dataset.auditDiff));
      if (!log) return;
      openModal(
        `Auditoría #${log.id} · ${log.action}`,
        `
        <div class="core-grid-2">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:6px">ANTES (BEFORE)</div>
            <pre class="core-pre">${esc(JSON.stringify(log.before_json || {}, null, 2))}</pre>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--c-gold);margin-bottom:6px">DESPUÉS (AFTER)</div>
            <pre class="core-pre">${esc(JSON.stringify(log.after_json || {}, null, 2))}</pre>
          </div>
        </div>
      `
      );
    })
  );
}

/* ==================== GLOBAL EVENT DELEGATION & BOOT ==================== */

function bindGlobalEvents() {
  // SPA link clicks
  document.addEventListener('click', async (e) => {
    const routeLink = e.target.closest('a[data-route]');
    if (routeLink) {
      e.preventDefault();
      navigate(routeLink.dataset.route);
      return;
    }

    const histBtn = e.target.closest('[data-ip-history]');
    if (histBtn) {
      openIpHistoryModal(histBtn.dataset.ipHistory);
      return;
    }

    const banBtn = e.target.closest('[data-quick-ban-ip]');
    if (banBtn) {
      openBanIpModal(banBtn.dataset.quickBanIp);
      return;
    }

    const kickBtn = e.target.closest('[data-force-logout-ip]');
    if (kickBtn) {
      try {
        await api('/network/force-logout', {
          method: 'POST',
          body: {
            ip: kickBtn.dataset.forceLogoutIp || undefined,
            user_id: kickBtn.dataset.forceLogoutUid ? Number(kickBtn.dataset.forceLogoutUid) : undefined,
          },
        });
        toast('Sesión expulsada en tiempo real', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }

    const cmdBtn = e.target.closest('[data-cmd]');
    if (cmdBtn) {
      $('cmdPaletteDlg')?.close();
      const kind = cmdBtn.dataset.cmd;
      if (kind === 'user') navigate(`/diosesmiguia/users/${cmdBtn.dataset.id}`);
      else if (kind === 'ip') openIpHistoryModal(cmdBtn.dataset.ip);
      else if (kind === 'campaign') {
        state.activeTabs.finance = 'campaigns';
        navigate('/diosesmiguia/finance');
      } else if (kind === 'ad') {
        navigate('/diosesmiguia/ads');
      } else if (kind === 'post') {
        state.activeTabs.content = 'posts';
        state.contentFilters = { kind: 'all', q: cmdBtn.dataset.q || '' };
        navigate('/diosesmiguia/content');
      }
    }
  });

  window.addEventListener('popstate', () => {
    if (state.admin) navigate(window.location.pathname || BASE_PATH, false);
  });

  // Sidebar collapse & mobile drawer
  $('coreCollapseBtn')?.addEventListener('click', () => {
    const shell = $('coreApp');
    const collapsed = shell.classList.toggle('is-collapsed');
    $('coreCollapseBtn').textContent = collapsed ? '›' : '‹';
  });

  $('coreMobileMenuBtn')?.addEventListener('click', () => {
    $('coreSidebar')?.classList.add('is-open');
    if ($('coreMobileScrim')) $('coreMobileScrim').hidden = false;
  });
  $('coreMobileScrim')?.addEventListener('click', closeMobileDrawer);

  // Command palette trigger & Cmd/Ctrl+K shortcut
  $('coreCmdOpenBtn')?.addEventListener('click', openCmdPalette);
  $('cmdCloseBtn')?.addEventListener('click', () => $('cmdPaletteDlg')?.close());
  $('cmdPaletteInput')?.addEventListener('input', (e) => {
    clearTimeout(cmdDebounce);
    cmdDebounce = setTimeout(() => runCmdSearch(e.target.value), 180);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (!state.admin) return;
      e.preventDefault();
      openCmdPalette();
    }
  });

  // Logout
  $('coreLogoutBtn')?.addEventListener('click', () => {
    state.token = '';
    state.admin = null;
    localStorage.removeItem(TOKEN_KEY);
    showLoginGate('');
  });

  // Dedicated Super-Admin login
  $('coreLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('coreLoginErr');
    const btn = $('coreLoginSubmit');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Verificando credenciales…';
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: {
          identifier: $('coreLoginId').value.trim(),
          password: $('coreLoginPass').value,
        },
      });
      state.token = res.token;
      state.admin = res.admin;
      localStorage.setItem(TOKEN_KEY, res.token);
      $('coreLoginPass').value = '';
      showAppShell();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Desbloquear Consola Maestra';
    }
  });

  // Show/hide password toggle on single-use invite registration form
  $('invTogglePass')?.addEventListener('click', () => {
    const inp = $('invPassword');
    const btn = $('invTogglePass');
    if (!inp || !btn) return;
    const nextShow = inp.type === 'password';
    inp.type = nextShow ? 'text' : 'password';
    btn.textContent = nextShow ? 'Ocultar' : 'Mostrar';
    btn.setAttribute('aria-pressed', nextShow ? 'true' : 'false');
    inp.focus();
  });

  $('coreInviteGoLogin')?.addEventListener('click', () => {
    try {
      history.replaceState(null, '', BASE_PATH);
    } catch {}
    showLoginGate('');
  });
}

function initPostInteractionValidation(formEl) {
  if (!formEl || formEl.dataset.mwgBound === '1') return;
  formEl.dataset.mwgBound = '1';

  const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports?.('selector(:user-invalid)');
  const dirtyState = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  document.body.append(announcer);
  let announceTimer = null;
  let announcedField = null;

  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => n.replaceWith(`${n.getAttribute('aria-label')}: `));
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };

  const announceError = (el) => {
    const errEl = document.getElementById(el.dataset.error || '');
    if (!errEl) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(errEl);
    }, 500);
  };

  const syncAria = (el, announce = false) => {
    if (!el?.matches?.('input, select, textarea')) return;
    const invalid = supportsUserInvalid ? el.matches(':user-invalid') : el.classList.contains('user-invalid-fallback');
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  const updateFallback = (el, announce = false) => {
    if (supportsUserInvalid || !el?.validity) return;
    const isValid = el.validity.valid;
    el.classList.toggle('user-invalid-fallback', !isValid);
    el.classList.toggle('user-valid-fallback', isValid);
    syncAria(el, announce);
  };

  formEl.querySelectorAll('input, select, textarea').forEach((el) => {
    el.setAttribute('aria-invalid', 'false');
  });

  formEl.addEventListener(
    'blur',
    (e) => {
      const el = e.target;
      if (!supportsUserInvalid) {
        const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
        st.hasBlurred = true;
        dirtyState.set(el, st);
        if (st.hasInteracted) updateFallback(el, true);
      } else {
        syncAria(el, true);
      }
    },
    true
  );

  formEl.addEventListener('input', (e) => {
    const el = e.target;
    if (!supportsUserInvalid) {
      const st = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyState.set(el, st);
      if (st.hasBlurred) updateFallback(el, false);
    } else if (el.hasAttribute('aria-invalid')) {
      syncAria(el, false);
    }
  });

  formEl.addEventListener(
    'invalid',
    (e) => {
      const el = e.target;
      announced.add(el);
      if (!supportsUserInvalid) {
        dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
        updateFallback(el, false);
      } else {
        syncAria(el, false);
      }
    },
    true
  );
}

async function openInviteGate(inviteToken) {
  stopSse();
  $('coreApp').hidden = true;
  $('coreLoginGate').hidden = true;
  const gate = $('coreInviteGate');
  const checking = $('coreInviteChecking');
  const invalidBox = $('coreInviteInvalid');
  const invalidMsg = $('coreInviteInvalidMsg');
  const form = $('coreInviteForm');
  const metaEl = $('coreInviteMeta');
  if (!gate) {
    showLoginGate('');
    return;
  }

  gate.hidden = false;
  checking.hidden = false;
  invalidBox.hidden = true;
  form.hidden = true;

  try {
    const info = await api(`/auth/invite/${encodeURIComponent(inviteToken)}`);
    checking.hidden = true;
    if (!info?.valid) {
      invalidMsg.textContent = info?.error || 'Este enlace de un solo uso ya no es válido.';
      invalidBox.hidden = false;
      return;
    }
    if (metaEl && info.expires_at) {
      metaEl.textContent = `VÁLIDO HASTA ${fmtDate(info.expires_at).toUpperCase()}`;
    }
    form.hidden = false;
    initPostInteractionValidation(form);
    $('invFullName')?.focus();

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        const firstBad = form.querySelector(':invalid');
        firstBad?.focus();
        return;
      }
      const errEl = $('coreInviteErr');
      const btn = $('coreInviteSubmit');
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Creando acceso Super-Admin…';
      try {
        const res = await api('/auth/register-invite', {
          method: 'POST',
          body: {
            token: inviteToken,
            full_name: $('invFullName').value.trim(),
            username: $('invUsername').value.trim(),
            email: $('invEmail').value.trim(),
            password: $('invPassword').value,
          },
        });
        state.token = res.token;
        state.admin = res.admin;
        localStorage.setItem(TOKEN_KEY, res.token);
        $('invPassword').value = '';
        try {
          history.replaceState(null, '', BASE_PATH);
        } catch {}
        toast('Cuenta Super-Admin creada. Enlace consumido con éxito.', 'ok');
        showAppShell();
      } catch (err) {
        errEl.textContent = err.message || 'No se pudo completar el registro.';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Crear cuenta Super-Admin y entrar';
      }
    };
  } catch (err) {
    checking.hidden = true;
    invalidMsg.textContent = err?.message || 'Este enlace de un solo uso ya fue utilizado o expiró.';
    invalidBox.hidden = false;
  }
}

async function boot() {
  bindGlobalEvents();
  const inviteToken = new URLSearchParams(window.location.search).get('invite')?.trim() || '';
  if (inviteToken) {
    await openInviteGate(inviteToken);
    return;
  }

  const saved = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(MAIN_TOKEN_KEY) || '';
  if (!saved) {
    showLoginGate('');
    return;
  }
  state.token = saved;
  try {
    const me = await api('/auth/me');
    state.admin = me.admin;
    localStorage.setItem(TOKEN_KEY, saved);
    showAppShell();
  } catch {
    state.token = '';
    showLoginGate('');
  }
}

boot();
