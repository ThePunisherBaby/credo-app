// app.js — Credo Apple-Grade Core Router, Persistent Player, Liquid Glass & On-Demand View Loader
// STRICTLY mounts ONLY the active route's ES module and DOM into #appView.

import { detectLocale, getDict } from './i18n.js';
import { attachDismissableSheet, createSpringPill, attachSpringPress } from './springs.mjs';
import { enhanceLiquidGlass } from './glass.js';
import { audioEngine } from './audio-engine.js';

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

const NAV_TABS = [
  {
    id: 'feed',
    hash: '#/feed',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10.5 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/></svg>',
  },
  {
    id: 'live',
    hash: '#/live',
    livePip: true,
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>',
  },
  {
    id: 'prayer',
    hash: '#/prayer',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 8h10"/></svg>',
  },
  {
    id: 'profile',
    hash: '#/profile',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5"/></svg>',
  },
];

// Top-layer discrete display transition feature probe (per animate-to-from-top-layer guide)
let _supportsDisplayTransition;
function canTransitionDisplay() {
  if (_supportsDisplayTransition !== undefined) return _supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  _supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return _supportsDisplayTransition;
}
function supportsTopLayerExit() {
  return window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();
}

async function closeTopLayer(dialog) {
  if (!dialog || !dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const anims = dialog.getAnimations ? dialog.getAnimations({ subtree: true }) : [];
    if (anims.length > 0) {
      await Promise.race([
        Promise.allSettled(anims.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 450)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

function wireDialogAccessibility(dialog) {
  if (!dialog) return;
  // Safari fallback for closedby="any" (per light-dismiss-a-dialog guide)
  if (dialog.getAttribute('closedby') === 'any' && !('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) closeTopLayer(dialog);
    });
  }
  // Route Esc / native cancel through top-layer exit helper
  dialog.addEventListener('cancel', (event) => {
    if (dialog.getAttribute('closedby') === 'none') {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    closeTopLayer(dialog);
  });
}

class CredoApp {
  constructor() {
    this.locale = detectLocale();
    this.token = '';
    this.user = null;
    this.guestPlus = false;
    this.linkedParishId = null;
    this.liveQueue = [];

    this._activeCleanup = null;
    this._activeAbort = null;
    this._routeSeq = 0;
    this._toastTimer = 0;
    this._storyTimer = 0;
    this._sheetCtrl = null;
    this._fullPlayerOpen = false;

    try {
      this.token = localStorage.getItem('credo-token') || '';
      this.guestPlus = localStorage.getItem('credo-guest-plus') === '1';
      const lp = localStorage.getItem('credo-parish-id');
      if (lp) this.linkedParishId = Number(lp);
    } catch {}
  }

  dict() {
    return getDict(this.locale);
  }

  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  initials(name) {
    const parts = String(name || 'C').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || 'C') + (parts[1]?.[0] || '')).toUpperCase();
  }

  relTime(iso) {
    if (!iso) return '';
    const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'ahora';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  getDeviceKey() {
    try {
      let key = localStorage.getItem('credo-device-key');
      if (!key) {
        key = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('credo-device-key', key);
      }
      return key;
    } catch {
      return 'dev_session';
    }
  }

  isCredoPlus() {
    return Boolean(this.user?.is_credo_plus || this.guestPlus);
  }

  async setCredoPlus(active, plan = 'annual') {
    this.guestPlus = Boolean(active);
    try {
      localStorage.setItem('credo-guest-plus', active ? '1' : '0');
    } catch {}
    if (this.user && this.token) {
      try {
        const res = await this.api('/api/v1/users/me/credo-plus', {
          method: 'POST',
          body: { active, plan },
        });
        if (res.user) this.user = res.user;
      } catch (err) {
        this.toast(err.message);
      }
    }
    this.toast(active ? '✦ Credo Plus activado: 0 anuncios y 0 esperas Pre-Roll' : 'Plan Gratuito activado (modo demo)');
  }

  setLinkedParish(unitId, { silent = false } = {}) {
    this.linkedParishId = Number(unitId) || null;
    try {
      if (this.linkedParishId) localStorage.setItem('credo-parish-id', String(this.linkedParishId));
    } catch {}
    if (!silent) this.toast('Parroquia vinculada actualizada');
  }

  setColorScheme(mode) {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) return;
    if (mode === 'dark' || mode === 'light') {
      meta.content = mode;
      try { localStorage.setItem('credo-color-scheme', mode); } catch {}
    } else {
      meta.content = 'light dark';
      try { localStorage.removeItem('credo-color-scheme'); } catch {}
    }
  }

  setLocale(lang) {
    this.locale = lang;
    try { localStorage.setItem('credo-locale', lang); } catch {}
    this.renderChrome();
    this.navigate();
  }

  toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async api(path, { method = 'GET', body, signal, noCache = false } = {}) {
    const isCacheableGet = method === 'GET' && !noCache && !this.token &&
      (path.startsWith('/api/v1/live') || path.startsWith('/api/v1/prayers/liturgy') || path.startsWith('/api/v1/stories'));
    if (!this._cache) this._cache = new Map();

    if (isCacheableGet) {
      const hit = this._cache.get(path);
      if (hit && Date.now() < hit.exp) {
        return hit.data;
      }
    }

    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.error;
      throw err;
    }

    if (isCacheableGet) {
      this._cache.set(path, { data, exp: Date.now() + 45_000 });
    }
    if (method !== 'GET' && this._cache) {
      this._cache.clear();
    }
    return data;
  }

  async bootstrap() {
    // Wire top-layer dialogs
    wireDialogAccessibility(document.getElementById('modalDialog'));
    wireDialogAccessibility(document.getElementById('storyDialog'));

    // Cross-tab color-scheme sync (per dark-mode-toggle guide)
    window.addEventListener('storage', (e) => {
      if (e.key === 'credo-color-scheme') {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.content = e.newValue || 'light dark';
      }
    });

    // Liquid Glass functional chrome + 120Hz Apple tactile spring press
    enhanceLiquidGlass(document.getElementById('mobileDockGlass'), 'lg-dock-refract');
    enhanceLiquidGlass(document.getElementById('miniPlayerGlass'), 'lg-mini-refract');
    enhanceLiquidGlass(document.getElementById('desktopRailGlass'));
    attachSpringPress(document.body);

    // Load current session if token exists
    if (this.token) {
      try {
        const me = await this.api('/api/v1/auth/me');
        this.user = me.user || null;
      } catch {
        this.token = '';
        try { localStorage.removeItem('credo-token'); } catch {}
      }
    }

    this.renderChrome(true);
    this.setupPersistentPlayer();

    window.addEventListener('resize', () => {
      const activeDock = document.querySelector('#mobileNav .dock-btn.is-active');
      if (activeDock && this._dockPill) this._dockPill.moveTo(activeDock, true);
    });
    window.addEventListener('hashchange', () => this.navigate());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._fullPlayerOpen) {
        this.closeFullPlayerImmediate();
      }
    });
    if (!location.hash || location.hash === '#') {
      location.replace('#/feed');
    } else {
      this.navigate();
    }
  }

  renderChrome(immediatePill = false) {
    const d = this.dict();
    const cur = this.parseRoute().tab;

    // Desktop Rail Nav
    const desktopNav = document.getElementById('desktopNav');
    if (desktopNav) {
      desktopNav.innerHTML = NAV_TABS.map(
        (t) => `
        <a href="${t.hash}" class="rail-link${cur === t.id ? ' is-active' : ''}" data-nav="${t.id}">
          ${t.icon}
          <span>${this.esc(d.nav[t.id])}</span>
        </a>`
      ).join('');
    }

    // Mobile Floating Dynamic Island Dock (preserve sliding #dockIndicator for continuous Apple spring flight!)
    const mobileNav = document.getElementById('mobileNav');
    if (mobileNav) {
      let indicator = document.getElementById('dockIndicator');
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.id = 'dockIndicator';
        indicator.className = 'dock-pill-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        mobileNav.prepend(indicator);
      }

      if (!mobileNav.querySelector('.dock-btn')) {
        const linksHtml = NAV_TABS.map(
          (t) => `
          <a href="${t.hash}" class="dock-btn" data-nav="${t.id}">
            ${t.icon}
            ${t.livePip ? '<span class="live-pip" aria-hidden="true"></span>' : ''}
            <span class="dock-label">${this.esc(d.nav[t.id])}</span>
          </a>`
        ).join('');
        mobileNav.insertAdjacentHTML('beforeend', linksHtml);
        this._dockPill = createSpringPill(mobileNav, indicator);
      }

      let activeBtn = null;
      mobileNav.querySelectorAll('.dock-btn').forEach((btn) => {
        const id = btn.dataset.nav;
        const isActive = cur === id;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        const lbl = btn.querySelector('.dock-label');
        if (lbl) lbl.textContent = d.nav[id];
        if (isActive) activeBtn = btn;
      });

      if (activeBtn && this._dockPill) {
        requestAnimationFrame(() => this._dockPill.moveTo(activeBtn, immediatePill));
      }
    }

    // Desktop Publish button (Clergy Only) & Account chip
    const pubBtn = document.getElementById('desktopPublishBtn');
    if (pubBtn) {
      pubBtn.hidden = !this.user?.can_publish;
      pubBtn.onclick = () => this.openComposer();
    }

    const accBtn = document.getElementById('desktopAccountBtn');
    if (accBtn) {
      const u = this.user;
      const avUrl = u?.avatar_url && u.avatar_url.includes('aire96fm.com.do')
        ? `/api/v1/media/proxy?url=${encodeURIComponent(u.avatar_url)}`
        : u?.avatar_url;
      accBtn.innerHTML = `
        <span class="avatar" style="--av-sz:36px;--av-bg:${this.esc(u?.avatar_color || '#0F1E36')}">
          ${avUrl ? `<img src="${this.esc(avUrl)}" alt="" />` : (u ? this.initials(u.full_name) : '✝')}
        </span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <strong style="font-size:0.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(u ? u.full_name : d.profile.signIn)}</strong>
          <small class="t-caption" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(u ? (u.is_ceo ? 'CEO · Credo' : d.ranks[u.ecclesiastical_rank] || '') : 'Invitado')}</small>
        </span>
      `;
      accBtn.onclick = () => {
        if (this.user) location.hash = '#/profile';
        else this.openAuthModal();
      };
    }
  }

  parseRoute() {
    const raw = (location.hash || '#/feed').replace(/^#\/?/, '');
    const [seg, arg] = raw.split('/');
    if (seg === 'live') return { route: 'live', tab: 'live', params: {} };
    if (seg === 'prayer') return { route: 'prayer', tab: 'prayer', params: {} };
    if (seg === 'parishes') return { route: 'parishes', tab: 'parishes', params: {} };
    if (seg === 'unit' && arg) return { route: 'unit', tab: 'parishes', params: { id: arg } };
    if (seg === 'user' && arg) return { route: 'user', tab: 'parishes', params: { id: arg } };
    if (seg === 'messages') return { route: 'messages', tab: 'parishes', params: { id: arg || null } };
    if (seg === 'profile') return { route: 'profile', tab: 'profile', params: {} };
    return { route: 'feed', tab: 'feed', params: {} };
  }

  // Strictly view-based on-demand mounting & lazy ES module loading
  async navigate() {
    const seq = ++this._routeSeq;

    // 1. Clean up previous view & abort all pending network requests
    if (this._activeAbort) {
      this._activeAbort.abort();
      this._activeAbort = null;
    }
    if (this._activeCleanup) {
      try { this._activeCleanup(); } catch {}
      this._activeCleanup = null;
    }

    const { route, tab, params } = this.parseRoute();
    this.renderChrome();

    const root = document.getElementById('appView');
    if (!root) return;
    // Clear previous DOM completely so ONLY the active screen exists in memory/DOM
    root.innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'instant' });

    const controller = new AbortController();
    this._activeAbort = controller;

    // Lazy-import ONLY the required view module
    let mod;
    try {
      if (route === 'feed') mod = await import('./views/feed.js');
      else if (route === 'live') mod = await import('./views/live.js');
      else if (route === 'prayer') mod = await import('./views/prayer.js');
      else if (route === 'parishes' || route === 'unit' || route === 'user') mod = await import('./views/parishes.js');
      else if (route === 'messages') mod = await import('./views/messages.js');
      else if (route === 'profile') mod = await import('./views/profile.js');
      else mod = await import('./views/feed.js');
    } catch (err) {
      root.innerHTML = `<div class="empty-box">Error cargando vista: ${this.esc(err.message)}</div>`;
      return;
    }

    if (seq !== this._routeSeq || controller.signal.aborted) return;

    // Trigger subtle view entry transition
    root.classList.remove('view-mount');
    void root.offsetWidth;
    root.classList.add('view-mount');

    const handle = await mod.mount({ root, app: this, signal: controller.signal, route, params });
    if (seq !== this._routeSeq) {
      handle?.cleanup?.();
      return;
    }
    this._activeCleanup = handle?.cleanup || null;
  }

  // =========================================================================
  // PERSISTENT MINI-PLAYER, FULL-SCREEN SPRING PLAYER & PRE-ROLL CONTROLLER
  // =========================================================================
  setLiveQueue(list) {
    if (Array.isArray(list) && list.length > 0) this.liveQueue = list;
  }

  setupPersistentPlayer() {
    const miniAnchor = document.getElementById('miniPlayerAnchor');
    const miniGlass = document.getElementById('miniPlayerGlass');
    const miniArt = document.getElementById('miniArt');
    const miniStation = document.getElementById('miniStationName');
    const miniProg = document.getElementById('miniProgramName');
    const miniPlayBtn = document.getElementById('miniPlayPauseBtn');
    const miniCloseBtn = document.getElementById('miniCloseBtn');
    const miniExpandBtn = document.getElementById('miniExpandBtn');

    const fpBackdrop = document.getElementById('fullPlayerBackdrop');
    const fpSheet = document.getElementById('fullPlayerSheet');
    const fpHandle = document.getElementById('fpDragHandle');
    const fpBgGlow = document.getElementById('fpBgGlow');
    const fpArtFrame = document.getElementById('fpArtFrame');
    const fpArt = document.getElementById('fpArt');
    const fpFreq = document.getElementById('fpFreq');
    const fpStation = document.getElementById('fpStation');
    const fpProgram = document.getElementById('fpProgram');
    const fpVis = document.getElementById('fpVisualizer');
    const fpPlayBtn = document.getElementById('fpPlayBtn');
    const fpCloseBtn = document.getElementById('fpCloseBtn');
    const fpSleepBtn = document.getElementById('fpSleepBtn');
    const fpSleepLabel = document.getElementById('fpSleepLabel');

    this._sheetCtrl = attachDismissableSheet(fpSheet, fpHandle, {
      onDismiss: () => this.closeFullPlayerImmediate(),
      onProgress: (p) => {
        fpBackdrop.style.opacity = String(1 - p);
      },
    });

    const syncUI = (st) => {
      const ch = st.channel;
      if (!ch) {
        miniAnchor.hidden = true;
        document.body.classList.remove('has-mini-player');
        if (this._fullPlayerOpen) this.closeFullPlayerImmediate();
        return;
      }

      miniAnchor.hidden = false;
      document.body.classList.add('has-mini-player');
      const artSrc = ch.cover_url && (ch.cover_url.includes('aire96fm.com.do') || ch.cover_url.includes('reflexionandolapalabra.com'))
        ? `/api/v1/media/proxy?url=${encodeURIComponent(ch.cover_url)}`
        : (ch.cover_url || '');
      miniGlass.style.setProperty('--mini-accent', ch.accent_color || '#C9A34E');
      miniArt.src = artSrc;
      miniStation.textContent = ch.name;
      miniProg.textContent = ch.current_program || ch.tagline || 'En vivo';
      miniPlayBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;

      fpBgGlow.style.setProperty('--fp-accent', ch.accent_color || '#C9A34E');
      fpArt.src = artSrc;
      fpArtFrame.classList.toggle('is-playing', st.playing);
      fpVis.classList.toggle('is-playing', st.playing);
      fpFreq.textContent = `${ch.frequency || 'EN VIVO'}${ch.city ? ` · ${ch.city}` : ''}`;
      fpStation.textContent = ch.name;
      fpProgram.textContent = ch.current_program || ch.tagline || '';
      fpPlayBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;

      fpSleepBtn.classList.toggle('is-active', st.sleepMinutes > 0);
      fpSleepLabel.textContent = st.sleepMinutes > 0 ? `${st.sleepMinutes} min` : this.dict().live.sleepTimer;
    };

    audioEngine.subscribe(syncUI);

    miniPlayBtn.onclick = () => audioEngine.togglePlay();
    miniCloseBtn.onclick = () => audioEngine.stop();
    miniExpandBtn.onclick = () => this.openFullPlayer();

    fpPlayBtn.onclick = () => audioEngine.togglePlay();
    fpCloseBtn.onclick = () => this._sheetCtrl.close();
    fpBackdrop.onclick = () => this._sheetCtrl.close();

    const stepStation = (dir) => {
      const cur = audioEngine.getState().channel;
      if (!cur || this.liveQueue.length < 2) return;
      const idx = this.liveQueue.findIndex((c) => c.id === cur.id);
      const next = this.liveQueue[(idx + dir + this.liveQueue.length) % this.liveQueue.length];
      if (next) audioEngine.playChannel(next);
    };
    document.getElementById('fpPrevStationBtn').onclick = () => stepStation(-1);
    document.getElementById('fpNextStationBtn').onclick = () => stepStation(1);

    fpSleepBtn.onclick = () => {
      const opts = [0, 15, 30, 60];
      const cur = audioEngine.getState().sleepMinutes;
      const next = opts[(opts.indexOf(cur) + 1) % opts.length];
      audioEngine.setSleepTimer(next);
      this.toast(next ? `Temporizador: ${next} minutos` : 'Temporizador desactivado');
    };

    document.getElementById('fpAirplayBtn').onclick = () => {
      this.toast('Audio listo para AirPlay / Chromecast desde el Centro de Control');
    };
    document.getElementById('fpShareBtn').onclick = async () => {
      const ch = audioEngine.getState().channel;
      const url = `${location.origin}/#/live`;
      try {
        if (navigator.share) await navigator.share({ title: ch?.name || 'Credo En Vivo', url });
        else await navigator.clipboard.writeText(url);
        this.toast('Enlace de señal en vivo copiado');
      } catch {}
    };
  }

  openFullPlayer() {
    if (!audioEngine.getState().channel) return;
    const fpBackdrop = document.getElementById('fullPlayerBackdrop');
    const fpSheet = document.getElementById('fullPlayerSheet');
    fpBackdrop.hidden = false;
    fpBackdrop.style.opacity = '1';
    fpSheet.hidden = false;
    document.body.classList.add('sheet-locked');
    this._fullPlayerOpen = true;
    this._sheetCtrl.open();
  }

  closeFullPlayerImmediate() {
    const fpBackdrop = document.getElementById('fullPlayerBackdrop');
    const fpSheet = document.getElementById('fullPlayerSheet');
    fpBackdrop.hidden = true;
    fpSheet.hidden = true;
    document.body.classList.remove('sheet-locked');
    this._fullPlayerOpen = false;
    this._sheetCtrl?.reset();
  }

  async playLiveWithPreRoll(channel, { expandPlayer = false } = {}) {
    await this.runPreRollIfNeeded(() => {
      audioEngine.playChannel(channel);
      if (expandPlayer) this.openFullPlayer();
    });
  }

  runPreRollIfNeeded(onComplete) {
    onComplete();
    return Promise.resolve();
  }

  // =========================================================================
  // MODALS: GENERIC, STORY VIEWER, AUTH (LOGIN / REGISTER), COMPOSER, ONBOARDING
  // =========================================================================
  openModal(title, bodyHTML) {
    const dlg = document.getElementById('modalDialog');
    dlg.removeAttribute('data-closing');
    dlg.innerHTML = `
      <div class="dialog-head">
        <h2 id="modalTitle">${this.esc(title)}</h2>
        <button type="button" class="icon-btn-44" id="modalCloseBtn" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="dialog-body">${bodyHTML}</div>
    `;
    dlg.querySelector('#modalCloseBtn').onclick = () => closeTopLayer(dlg);
    if (!dlg.open) dlg.showModal();
    return dlg;
  }

  closeModal() {
    closeTopLayer(document.getElementById('modalDialog'));
  }

  openStoryViewer(stories, startIdx = 0) {
    if (!stories || stories.length === 0) return;
    const dlg = document.getElementById('storyDialog');
    let idx = startIdx;

    const show = () => {
      clearTimeout(this._storyTimer);
      const st = stories[idx];
      if (!st) return dlg.close();
      dlg.innerHTML = `
        <div class="story-stage" style="background:${this.esc(st.bg_gradient || '#0F1E36')}">
          ${st.image_url ? `<img class="story-stage-bg" src="${this.esc(st.image_url)}" alt="" />` : ''}
          <div class="story-stage-scrim"></div>
          <div>
            <div class="story-bars">
              ${stories.map((_, i) => `<div class="story-bar ${i < idx ? 'is-done' : i === idx ? 'is-active' : ''}"><div class="story-bar-fill"></div></div>`).join('')}
            </div>
            <div class="story-top">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="avatar" style="--av-sz:36px;--av-bg:${this.esc(st.author?.avatar_color || '#0F1E36')}">${this.initials(st.author?.full_name)}</span>
                <div>
                  <strong style="font-size:0.9rem">${this.esc(st.author?.full_name || 'Clero Oficial')}</strong>
                  <div style="font-size:0.72rem;opacity:0.75">${this.relTime(st.created_at)}</div>
                </div>
              </div>
              <button type="button" class="icon-btn-44" id="stClose" style="color:#fff" aria-label="Cerrar">✕</button>
            </div>
          </div>
          <div class="story-tap-zones">
            <div id="stPrev"></div>
            <div id="stNext"></div>
          </div>
          <div class="story-bottom">
            ${st.scripture_ref ? `<span style="color:#FFE07D;font-family:var(--font-serif);font-style:italic">📖 ${this.esc(st.scripture_ref)}</span>` : ''}
            <p style="margin:0;font-size:1rem;line-height:1.45">${this.esc(st.caption || '')}</p>
          </div>
        </div>
      `;
      dlg.querySelector('#stClose').onclick = () => {
        clearTimeout(this._storyTimer);
        dlg.close();
      };
      dlg.querySelector('#stPrev').onclick = () => {
        idx = Math.max(0, idx - 1);
        show();
      };
      dlg.querySelector('#stNext').onclick = () => {
        if (idx + 1 < stories.length) { idx += 1; show(); }
        else { clearTimeout(this._storyTimer); dlg.close(); }
      };
      this._storyTimer = setTimeout(() => {
        if (!dlg.open) return;
        if (idx + 1 < stories.length) { idx += 1; show(); }
        else dlg.close();
      }, 5500);
    };

    if (!dlg.open) dlg.showModal();
    show();
  }

  openAuthModal() {
    const d = this.dict();
    let mode = 'login';

    const renderAuth = () => {
      const dlg = this.openModal(
        mode === 'login' ? d.profile.signIn : 'Crear cuenta',
        `
        <div class="segmented" id="authModeSeg">
          <button type="button" class="seg-btn${mode === 'login' ? ' is-active' : ''}" data-amode="login">${this.esc(d.profile.signIn)}</button>
          <button type="button" class="seg-btn${mode === 'register' ? ' is-active' : ''}" data-amode="register">Crear cuenta</button>
        </div>
        ${mode === 'login' ? `
          <form id="authLoginForm" style="display:flex;flex-direction:column;gap:12px">
            <div class="field">
              <label for="authEmail">Correo o usuario</label>
              <input id="authEmail" name="identifier" type="text" placeholder="correo@ejemplo.com" required autocomplete="username" />
            </div>
            <div class="field">
              <label for="authPass">Contraseña</label>
              <input id="authPass" name="password" type="password" placeholder="••••••••" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn btn-gold btn-block">${this.esc(d.profile.signIn)}</button>
          </form>
        ` : `
          <form id="authRegisterForm" style="display:flex;flex-direction:column;gap:12px">
            <div class="field">
              <label for="regName">Nombre completo</label>
              <input id="regName" name="full_name" type="text" placeholder="Tu nombre y apellido" required />
            </div>
            <div class="field">
              <label for="regEmail">Correo electrónico</label>
              <input id="regEmail" name="email" type="email" placeholder="correo@ejemplo.com" required autocomplete="email" />
            </div>
            <div class="field">
              <label for="regPass">Contraseña (mín. 6 caracteres)</label>
              <input id="regPass" name="password" type="password" minlength="6" required autocomplete="new-password" />
            </div>
            <div class="field">
              <label for="regRank">Estado en la Iglesia</label>
              <select id="regRank" name="ecclesiastical_rank">
                <option value="lay">Fiel Laico</option>
                <option value="catechist">Catequista</option>
                <option value="seminarian">Seminarista</option>
                <option value="religious">Religioso/a</option>
                <option value="deacon">Diácono (requiere verificación)</option>
                <option value="priest">Sacerdote (requiere verificación)</option>
                <option value="bishop">Obispo (requiere verificación)</option>
              </select>
            </div>
            <button type="submit" class="btn btn-gold btn-block">Crear cuenta en Credo</button>
          </form>
        `}
        `
      );

      dlg.querySelector('#authModeSeg').onclick = (e) => {
        const b = e.target.closest('[data-amode]');
        if (!b || b.dataset.amode === mode) return;
        mode = b.dataset.amode;
        renderAuth();
      };

      dlg.querySelector('#authLoginForm')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          const res = await this.api('/api/v1/auth/login', {
            method: 'POST',
            body: { identifier: fd.get('identifier'), password: fd.get('password') },
          });
          this._applySession(res);
          this.closeModal();
        } catch (err) {
          this.toast(err.message);
        }
      });

      dlg.querySelector('#authRegisterForm')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          const res = await this.api('/api/v1/auth/register', {
            method: 'POST',
            body: {
              full_name: fd.get('full_name'),
              email: fd.get('email'),
              password: fd.get('password'),
              ecclesiastical_rank: fd.get('ecclesiastical_rank'),
              preferred_locale: this.locale,
            },
          });
          this._applySession(res);
          this.closeModal();
        } catch (err) {
          this.toast(err.message);
        }
      });
    };

    renderAuth();
  }

  _applySession({ token, user }) {
    this.token = token;
    this.user = user;
    try { localStorage.setItem('credo-token', token); } catch {}
    this.toast(`Bienvenido, ${user.title_prefix ? user.title_prefix + ' ' : ''}${user.full_name}`);
    this.renderChrome();
    this.navigate();
  }

  logout() {
    this.token = '';
    this.user = null;
    try { localStorage.removeItem('credo-token'); } catch {}
    this.toast('Sesión cerrada');
    this.renderChrome();
  }

  openComposer() {
    const d = this.dict();
    if (!this.user) {
      this.openAuthModal();
      return;
    }
    if (!this.user.can_publish) {
      this.openModal(
        d.feed.clergyOnlyTitle,
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          <p style="margin:0;line-height:1.55">${this.esc(d.feed.clergyOnlyDesc)}</p>
          <a href="#/prayer" class="btn btn-gold btn-block" id="goPrayerFromLock">🕯️ Ir al Muro de Oración</a>
        </div>
        `
      );
      document.getElementById('goPrayerFromLock')?.addEventListener('click', () => this.closeModal());
      return;
    }

    const dlg = this.openModal(
      'Nueva Publicación Oficial',
      `
      <form id="composeForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="field">
          <label for="cType">Tipo de publicación</label>
          <select id="cType" name="post_type">
            <option value="homily">Homilía</option>
            <option value="reflection">Reflexión</option>
            <option value="pastoral_letter">Carta Pastoral</option>
            <option value="announcement">Aviso Oficial</option>
            <option value="event">Evento</option>
          </select>
        </div>
        <div class="field">
          <label for="cTitle">Título</label>
          <input id="cTitle" name="title" type="text" placeholder="Ej. Homilía dominical · Permanezcan en mi amor" />
        </div>
        <div class="field">
          <label for="cBody">Contenido</label>
          <textarea id="cBody" name="content" required placeholder="Comparte tu mensaje pastoral con la comunidad…"></textarea>
        </div>
        <div class="field">
          <label for="cScripture">Cita bíblica (opcional)</label>
          <input id="cScripture" name="scripture_ref" type="text" placeholder="Ej. Jn 15, 9–17" />
        </div>
        <div class="field">
          <label for="cImage">Fotografía (opcional)</label>
          <input id="cImage" type="file" accept="image/*" />
        </div>
        <button type="submit" class="btn btn-gold btn-block">Publicar oficialmente</button>
      </form>
      `
    );

    dlg.querySelector('#composeForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const fd = new FormData(form);
      let image_url = '';
      const file = form.querySelector('#cImage').files?.[0];
      if (file) {
        try {
          const dataUrl = await compressImageToDataUrl(file);
          const up = await this.api('/api/v1/media', { method: 'POST', body: { data_url: dataUrl } });
          image_url = up.url;
        } catch (err) {
          this.toast(err.message);
          return;
        }
      }
      try {
        await this.api('/api/v1/posts', {
          method: 'POST',
          body: {
            post_type: fd.get('post_type'),
            title: fd.get('title'),
            content: fd.get('content'),
            scripture_ref: fd.get('scripture_ref'),
            image_url,
          },
        });
        this.closeModal();
        this.toast('Publicación oficial enviada');
        if (this.parseRoute().route === 'feed') this.navigate();
      } catch (err) {
        this.toast(err.message);
      }
    });
  }

  openOnboarding(force = false) {
    const d = this.dict();
    const slides = d.onboarding.slides;
    let idx = 0;

    const renderSlide = () => {
      const s = slides[idx];
      const isLast = idx === slides.length - 1;
      const dlg = this.openModal(
        'Bienvenido a Credo',
        `
        <div style="display:flex;flex-direction:column;gap:14px;text-align:center;padding:6px 4px">
          <div style="width:60px;height:60px;border-radius:18px;margin:0 auto;background:linear-gradient(145deg,#0F1E36,#1E355C);color:#D4AF37;display:grid;place-items:center;border:1px solid rgba(212,175,55,0.4);font-size:1.6rem">✝</div>
          <span class="t-caption" style="letter-spacing:0.1em;font-weight:700;color:var(--gold-text)">${this.esc(s.eyebrow)}</span>
          <h3 class="t-serif" style="margin:0;font-size:1.38rem;line-height:1.25">${this.esc(s.title)}</h3>
          <p class="t-subhead">${this.esc(s.body)}</p>
          <div style="display:flex;justify-content:center;gap:6px;margin:4px 0">
            ${slides.map((_, i) => `<span style="width:${i === idx ? 22 : 7}px;height:7px;border-radius:99px;background:${i === idx ? 'var(--gold-bright)' : 'var(--sep-strong)'};transition:width 260ms"></span>`).join('')}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
            <button type="button" class="btn btn-gold btn-block" id="onbNextBtn">${this.esc(isLast ? d.onboarding.start : d.onboarding.next)}</button>
            <button type="button" class="btn btn-soft btn-sm btn-block" id="onbSkipBtn">${this.esc(d.onboarding.skip)}</button>
          </div>
        </div>
        `
      );

      const done = () => {
        try { localStorage.setItem('credo-onboarded', '1'); } catch {}
        this.closeModal();
      };
      dlg.querySelector('#onbSkipBtn').onclick = done;
      dlg.querySelector('#onbNextBtn').onclick = () => {
        if (isLast) done();
        else { idx += 1; renderSlide(); }
      };
    };

    if (force || !localStorage.getItem('credo-onboarded')) renderSlide();
  }
}

function compressImageToDataUrl(file, maxSide = 1440, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        if (width >= height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo procesar la imagen'));
    };
    img.src = url;
  });
}

const app = new CredoApp();
window.__CREDO__ = app;
app.bootstrap();
