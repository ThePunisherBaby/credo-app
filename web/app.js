// app.js — Credo Apple-Grade Core Router, Persistent Player, Liquid Glass & On-Demand View Loader
// STRICTLY mounts ONLY the active route's ES module and DOM into #appView.

import { detectLocale, getDict } from './i18n.js?v=23';
import { attachDismissableSheet, createSpringPill, attachSpringPress, attachSegSpringPills } from './springs.mjs?v=23';
import { enhanceLiquidGlass } from './glass.js?v=23';
import { audioEngine } from './audio-engine.js?v=23';
import { createCredoOneController } from './credo-one-sheet.js?v=49';

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

const NAV_TABS = [
  {
    id: 'feed',
    hash: '#/feed',
    icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10.5 9-7.5 9 7.5V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/></svg>',
  },
  {
    id: 'vids',
    hash: '#/vids',
    icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8.5 6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>',
  },
  {
    id: 'explore',
    hash: '#/explore',
    icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>',
  },
  {
    id: 'prayer',
    hash: '#/prayer',
    icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 8h10"/></svg>',
  },
  {
    id: 'profile',
    hash: '#/profile',
    icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5"/></svg>',
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
  // Pointer-bounds fallback for closedby="any" (per dialog guide: require press AND release outside so drag selection doesn't dismiss)
  if (dialog.getAttribute('closedby') === 'any' && !('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e)) closeTopLayer(dialog);
      pressedOutside = false;
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
    this.seenStories = new Set();

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
      const seenRaw = localStorage.getItem('credo-seen-stories');
      if (seenRaw) {
        JSON.parse(seenRaw).slice(-120).forEach((id) => this.seenStories.add(String(id)));
      }
    } catch {}
  }

  markStorySeen(id) {
    if (!id) return;
    this.seenStories.add(String(id));
    try {
      localStorage.setItem('credo-seen-stories', JSON.stringify([...this.seenStories].slice(-120)));
    } catch {}
  }

  isStorySeen(id) {
    return id ? this.seenStories.has(String(id)) : false;
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

  setLinkedParish(unitId, { silent = false } = {}) {
    this.linkedParishId = Number(unitId) || null;
    try {
      if (this.linkedParishId) localStorage.setItem('credo-parish-id', String(this.linkedParishId));
    } catch {}
    if (!silent) this.toast('Parroquia vinculada actualizada');
  }

  setColorScheme(mode) {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (mode === 'dark' || mode === 'light') {
      if (meta) meta.content = mode;
      document.documentElement.style.colorScheme = mode;
      document.documentElement.dataset.theme = mode;
      try { localStorage.setItem('credo-color-scheme', mode); } catch {}
    } else {
      if (meta) meta.content = 'light dark';
      document.documentElement.style.colorScheme = 'light dark';
      delete document.documentElement.dataset.theme;
      try { localStorage.removeItem('credo-color-scheme'); } catch {}
    }
    const osDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' ? true : mode === 'light' ? false : Boolean(osDark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = isDark ? '#000000' : '#FFFFFF';
    try { window.CredoNative?.setSystemTheme?.(isDark); } catch {}
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

  _cacheScope() {
    return this.token ? `u:${this.token.slice(-10)}` : 'anon';
  }

  _storageKey(path) {
    return `credo_c3:${this._cacheScope()}:${path}`;
  }

  getCached(path, maxStaleMs = 24 * 60 * 60 * 1000) {
    if (!this._cache) this._cache = new Map();
    const k = `${this._cacheScope()}:${path}`;
    const mem = this._cache.get(k);
    if (mem && Date.now() - mem.ts < maxStaleMs) {
      return mem.data;
    }
    try {
      const raw = localStorage.getItem(this._storageKey(path));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data !== undefined && Date.now() - (parsed.ts || 0) < maxStaleMs) {
        this._cache.set(k, parsed);
        return parsed.data;
      }
    } catch {}
    return null;
  }

  _isFresh(path, ttlMs = 25_000) {
    if (!this._cache) return false;
    const mem = this._cache.get(`${this._cacheScope()}:${path}`);
    return Boolean(mem && Date.now() - mem.ts < ttlMs);
  }

  _saveCache(path, data) {
    if (!this._cache) this._cache = new Map();
    const entry = { data, ts: Date.now() };
    const k = `${this._cacheScope()}:${path}`;
    this._cache.set(k, entry);
    if (this._cache.size > 60) {
      const oldest = this._cache.keys().next().value;
      if (oldest) this._cache.delete(oldest);
    }
    try {
      const serialized = JSON.stringify(entry);
      if (serialized.length < 180_000) {
        localStorage.setItem(this._storageKey(path), serialized);
      }
    } catch {
      // If quota exceeded, evict oldest credo_c3 keys and retry once
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const lk = localStorage.key(i);
          if (lk && lk.startsWith('credo_c3:')) keys.push(lk);
        }
        keys.slice(0, Math.ceil(keys.length / 2)).forEach((lk) => localStorage.removeItem(lk));
        localStorage.setItem(this._storageKey(path), JSON.stringify(entry));
      } catch {}
    }
  }

  clearLocalCache(prefix = '') {
    if (this._cache) {
      if (!prefix) this._cache.clear();
      else {
        for (const k of this._cache.keys()) {
          if (k.includes(prefix)) this._cache.delete(k);
        }
      }
    }
    try {
      const toDel = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const lk = localStorage.key(i);
        if (lk && lk.startsWith('credo_c3:') && (!prefix || lk.includes(prefix))) {
          toDel.push(lk);
        }
      }
      toDel.forEach((lk) => localStorage.removeItem(lk));
    } catch {}
  }

  async api(path, { method = 'GET', body, signal, noCache = false, ttlMs = 30_000 } = {}) {
    const isCacheableGet = method === 'GET' && !noCache && path.startsWith('/api/v1/');
    if (!this._cache) this._cache = new Map();
    if (!this._inFlight) this._inFlight = new Map();

    if (isCacheableGet && this._isFresh(path, ttlMs)) {
      return this._cache.get(`${this._cacheScope()}:${path}`).data;
    }

    const flightKey = isCacheableGet ? `${this._cacheScope()}:${path}` : '';
    if (flightKey && this._inFlight.has(flightKey)) {
      return this._inFlight.get(flightKey);
    }

    const doFetch = async () => {
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
        this._saveCache(path, data);
      }
      if (method !== 'GET') {
        if (path.includes('/posts')) this.clearLocalCache('/api/v1/posts');
        else if (path.includes('/prayers')) this.clearLocalCache('/api/v1/prayers');
        else if (path.includes('/users')) this.clearLocalCache('/api/v1/users');
        else if (path.includes('/stories')) this.clearLocalCache('/api/v1/stories');
        else this.clearLocalCache();
      }
      return data;
    };

    if (!flightKey) return doFetch();

    const p = doFetch().finally(() => {
      this._inFlight.delete(flightKey);
    });
    this._inFlight.set(flightKey, p);
    return p;
  }

  /**
   * Stale-While-Revalidate helper:
   * 1. Immediately invokes onData(cached, true) synchronously in 0ms if local cache exists.
   * 2. Silently fetches fresh data in the background and calls onData(fresh, false) if updated.
   */
  swr(path, onData, { signal, ttlMs = 20_000 } = {}) {
    const cached = this.getCached(path);
    if (cached !== null) {
      try { onData(cached, true); } catch {}
    }
    if (cached !== null && this._isFresh(path, ttlMs)) {
      return Promise.resolve(cached);
    }
    return this.api(path, { signal, noCache: true, ttlMs })
      .then((fresh) => {
        if (signal?.aborted) return fresh;
        try { onData(fresh, false); } catch {}
        return fresh;
      })
      .catch((err) => {
        if (cached !== null) return cached;
        throw err;
      });
  }

  prefetchCore() {
    if (this._prefetched) return;
    this._prefetched = true;
    const warm = () => {
      const urls = [
        '/api/v1/posts?scope=global&limit=6&offset=0',
        '/api/v1/stories',
        '/api/v1/live',
        '/api/v1/rosary/status',
        `/api/v1/prayers/liturgy?lang=${this.locale}`,
        '/api/v1/prayers/intentions?filter=recent',
        '/api/v1/users?clergy_only=true&limit=25',
      ];
      urls.forEach((u) => {
        if (!this._isFresh(u, 60_000)) {
          this.api(u, { ttlMs: 60_000 }).catch(() => {});
        }
      });
      // Preload core ES view modules silently so dock switching never waits for JS parsing
      import('./views/explore.js?v=25').catch(() => {});
      import('./views/prayer.js?v=23').catch(() => {});
      import('./views/profile.js?v=36').catch(() => {});
      import('./views/vids.js?v=42').catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 900 });
    } else {
      setTimeout(warm, 320);
    }
  }

  openCredoOne(opts = {}) {
    if (!this._credoOne) {
      this._credoOne = createCredoOneController(this);
    }
    return this._credoOne.open(opts);
  }

  closeDialogAnimated(dlg) {
    return closeTopLayer(dlg);
  }

  async refreshSession() {
    if (!this.token) return null;
    try {
      const me = await this.api('/api/v1/auth/me', { noCache: true });
      if (me?.user) {
        this.user = me.user;
        try { localStorage.setItem('credo-user-cache', JSON.stringify(me.user)); } catch {}
        this.renderChrome();
      }
      return this.user;
    } catch {
      return this.user;
    }
  }

  async bootstrap() {
    // Support Super-Admin Safe Impersonation (?impersonate=<jwt>)
    const bootParams = new URLSearchParams(location.search);
    const impToken = bootParams.get('impersonate');
    if (impToken) {
      try {
        const prevTok = localStorage.getItem('credo-token') || '';
        if (prevTok && !sessionStorage.getItem('credo-admin-backup')) {
          sessionStorage.setItem('credo-admin-backup', prevTok);
        }
        this.token = impToken.trim();
        this.user = null;
        localStorage.setItem('credo-token', this.token);
        localStorage.removeItem('credo-user-cache');
      } catch {}
      history.replaceState(null, '', `/${location.hash || '#/feed'}`);
    }

    // Extract VIP Profile Claim / Onboarding link (/bienvenida/<token>, ?bienvenida=<token>, ?claim=<token>)
    let initialClaimToken = '';
    const pathClaimMatch = location.pathname.match(/^\/(?:bienvenida|claim)\/([A-Za-z0-9_-]{8,120})\/?$/);
    if (pathClaimMatch) {
      initialClaimToken = pathClaimMatch[1];
      history.replaceState(null, '', '/#/feed');
    } else {
      const sp = new URLSearchParams(location.search);
      const qTok = sp.get('bienvenida') || sp.get('claim') || '';
      if (qTok) {
        initialClaimToken = qTok.trim();
        history.replaceState(null, '', '/#/feed');
      } else {
        const hashClaim = location.hash.match(/^#\/(?:bienvenida|claim)\/([A-Za-z0-9_-]{8,120})\/?$/);
        if (hashClaim) {
          initialClaimToken = hashClaim[1];
          history.replaceState(null, '', '/#/feed');
        }
      }
    }

    if (initialClaimToken) {
      this._claimPrefetch = this.api(`/api/v1/auth/claim/${encodeURIComponent(initialClaimToken)}`, {
        noCache: true,
      });
    }

    // Support clean /studio URL paths seamlessly in hash router
    if (location.pathname.startsWith('/studio') && !location.hash.startsWith('#/studio')) {
      const sub = location.pathname.replace(/^\/studio\/?/, '') || 'overview';
      history.replaceState(null, '', `/#/studio/${sub}`);
    }

    // Register Offline-First Service Worker (caches app shell & all feed/profile images locally in 0ms)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Wire top-layer dialogs (credoOneDialog uses non-top-layer backdrop so PayPal v6/v5 modals & 3DS sit cleanly above)
    wireDialogAccessibility(document.getElementById('modalDialog'));
    wireDialogAccessibility(document.getElementById('storyDialog'));
    this._credoOne = createCredoOneController(this);

    // Cross-tab color-scheme sync (per dark-mode-toggle guide)
    window.addEventListener('storage', (e) => {
      if (e.key === 'credo-color-scheme') {
        const val = e.newValue === 'dark' || e.newValue === 'light' ? e.newValue : 'light dark';
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.content = val;
        document.documentElement.style.colorScheme = val;
        if (e.newValue === 'dark' || e.newValue === 'light') {
          document.documentElement.dataset.theme = e.newValue;
        } else {
          delete document.documentElement.dataset.theme;
        }
      }
    });

    // Liquid Glass functional chrome + 120Hz Apple tactile spring press + predictive 0ms tab prefetch
    enhanceLiquidGlass(document.getElementById('mobileDockGlass'), 'lg-dock-refract');
    enhanceLiquidGlass(document.getElementById('miniPlayerGlass'), 'lg-mini-refract');
    enhanceLiquidGlass(document.getElementById('desktopRailGlass'));
    attachSpringPress(document.body);
    this.attachAvatarLongPress();
    this.attachInstantNavPrefetch();

    // Instant 0ms session hydration from localStorage (NEVER block first paint waiting on /auth/me!)
    if (this.token) {
      try {
        const cachedUser = localStorage.getItem('credo-user-cache');
        if (cachedUser) this.user = JSON.parse(cachedUser);
      } catch {}
    }

    this.renderChrome(true);
    this.renderImpersonationBar();
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

    // Revalidate session in background without blocking initial render
    if (this.token) {
      this.api('/api/v1/auth/me', { noCache: true })
        .then((me) => {
          this.user = me.user || null;
          try {
            if (this.user) localStorage.setItem('credo-user-cache', JSON.stringify(this.user));
            else localStorage.removeItem('credo-user-cache');
          } catch {}
          this.renderChrome();
          this.renderImpersonationBar();
          this._credoOne?.handlePayPalReturnIfPresent?.();
          this.loadPlatformAds();
          this.checkAdminNotifications();
        })
        .catch((err) => {
          if (err?.status === 401) {
            this.token = '';
            this.user = null;
            try {
              localStorage.removeItem('credo-token');
              localStorage.removeItem('credo-user-cache');
            } catch {}
            this.renderChrome();
            this.renderImpersonationBar();
          }
          this.loadPlatformAds();
        });
    } else {
      this._credoOne?.handlePayPalReturnIfPresent?.();
      this.loadPlatformAds();
    }

    this.prefetchCore();

    if (initialClaimToken) {
      this.openClaimProfileModal(initialClaimToken);
    }
  }

  trackPlatformAd(adId, eventType = 'impression') {
    const id = Number(adId);
    if (!id) return;
    fetch(`/api/v1/platform-ads/${id}/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        'X-Credo-Device': this.getDeviceKey(),
      },
      body: JSON.stringify({ event_type: eventType }),
      keepalive: true,
    }).catch(() => {});
  }

  renderImpersonationBar() {
    document.getElementById('credoImpersonateBar')?.remove();
    document.body.style.paddingTop = '';
    if (!this.user?.is_impersonating) return;

    const bar = document.createElement('div');
    bar.id = 'credoImpersonateBar';
    bar.className = 'credo-impersonate-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <span>👁 Viendo como <strong>@${this.esc(this.user.username || this.user.full_name)}</strong> (${this.esc(this.user.full_name || '')}) — Sesión de soporte</span>
      <button type="button" class="credo-impersonate-exit" id="credoImpExitBtn">Salir y volver a Core OS</button>
    `;
    document.body.prepend(bar);
    document.body.style.paddingTop = '42px';

    bar.querySelector('#credoImpExitBtn')?.addEventListener('click', () => {
      try {
        const backup = sessionStorage.getItem('credo-admin-backup');
        sessionStorage.removeItem('credo-admin-backup');
        localStorage.removeItem('credo-user-cache');
        if (backup) localStorage.setItem('credo-token', backup);
        else localStorage.removeItem('credo-token');
      } catch {}
      location.href = '/diosesmiguia/users';
    });
  }

  async loadPlatformAds() {
    try {
      const data = await this.api('/api/v1/platform-ads/active', { noCache: true });
      const ads = Array.isArray(data?.ads) ? data.ads : [];
      this.platformAds = ads;
      window.dispatchEvent(new CustomEvent('credo:platform-ads-ready', { detail: ads }));

      // 1. Sticky bottom banner (dismissible per session)
      document.getElementById('credoStickyBottomAd')?.remove();
      const bottomAd = ads.find((a) => a.format === 'sticky_bottom');
      if (bottomAd && !sessionStorage.getItem(`credo-ad-dismiss-${bottomAd.id}`)) {
        const el = document.createElement('aside');
        el.id = 'credoStickyBottomAd';
        el.className = 'credo-plat-banner credo-plat-banner--bottom';
        el.setAttribute('aria-label', 'Anuncio oficial');
        el.innerHTML = `
          <div class="credo-plat-banner-left">
            ${bottomAd.media_url ? `<img class="credo-plat-banner-img" src="${this.esc(bottomAd.media_url)}" alt="" />` : ''}
            <div style="min-width:0">
              <strong style="display:block;font-size:0.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(bottomAd.title)}</strong>
              ${bottomAd.body ? `<span style="display:block;font-size:0.74rem;opacity:0.76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(bottomAd.body)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${bottomAd.cta_url ? `<a href="${this.esc(bottomAd.cta_url)}" target="_blank" rel="noopener noreferrer" class="credo-plat-banner-cta" data-plat-click="${bottomAd.id}">${this.esc(bottomAd.cta_text || 'Ver más')} ↗</a>` : ''}
            <button type="button" class="credo-plat-banner-close" aria-label="Cerrar anuncio">✕</button>
          </div>
        `;
        document.body.appendChild(el);
        this.trackPlatformAd(bottomAd.id, 'impression');
        el.querySelector('[data-plat-click]')?.addEventListener('click', () => this.trackPlatformAd(bottomAd.id, 'click'));
        el.querySelector('.credo-plat-banner-close')?.addEventListener('click', () => {
          try { sessionStorage.setItem(`credo-ad-dismiss-${bottomAd.id}`, '1'); } catch {}
          el.remove();
        });
      }

      // 2. Interstitial splash modal (respects frequency_every_n hours cooldown)
      const interAd = ads.find((a) => a.format === 'interstitial');
      if (interAd) {
        const coolKey = `credo-interstitial-seen-${interAd.id}`;
        const lastSeen = Number(localStorage.getItem(coolKey) || 0);
        const coolHours = Math.max(1, Number(interAd.frequency_every_n || 6));
        if (Date.now() - lastSeen > coolHours * 3600 * 1000) {
          localStorage.setItem(coolKey, String(Date.now()));
          let dlg = document.getElementById('credoInterstitialDlg');
          if (!dlg) {
            dlg = document.createElement('dialog');
            dlg.id = 'credoInterstitialDlg';
            dlg.className = 'credo-interstitial-dlg';
            dlg.setAttribute('closedby', 'any');
            document.body.appendChild(dlg);
            wireDialogAccessibility(dlg);
          }
          dlg.innerHTML = `
            ${interAd.media_url ? `<img src="${this.esc(interAd.media_url)}" alt="" style="width:100%;max-height:240px;object-fit:cover;display:block" />` : ''}
            <div style="padding:18px;display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <span style="font-size:0.68rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#D4AF37">Mensaje Oficial · Credo</span>
                <button type="button" id="credoInterClose" style="background:transparent;border:1px solid #343440;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer" aria-label="Cerrar">✕</button>
              </div>
              <h2 style="margin:0;font-size:1.18rem;line-height:1.25">${this.esc(interAd.title)}</h2>
              ${interAd.body ? `<p style="margin:0;font-size:0.86rem;color:#A1A1AA;line-height:1.48">${this.esc(interAd.body)}</p>` : ''}
              <div style="display:flex;gap:8px;margin-top:6px">
                ${interAd.cta_url ? `<a href="${this.esc(interAd.cta_url)}" target="_blank" rel="noopener noreferrer" id="credoInterCta" style="flex:1;text-align:center;padding:11px 14px;border-radius:10px;background:#0A84FF;color:#fff;font-weight:700;text-decoration:none;font-size:0.88rem">${this.esc(interAd.cta_text || 'Abrir')} ↗</a>` : ''}
                <button type="button" id="credoInterSkip" style="padding:11px 14px;border-radius:10px;background:#1A1A22;border:1px solid #2E2E38;color:#E5E7EB;font-weight:700;cursor:pointer;font-size:0.84rem">Cerrar</button>
              </div>
            </div>
          `;
          if (!dlg.open) dlg.showModal();
          this.trackPlatformAd(interAd.id, 'impression');
          dlg.querySelector('#credoInterClose')?.addEventListener('click', () => dlg.close());
          dlg.querySelector('#credoInterSkip')?.addEventListener('click', () => dlg.close());
          dlg.querySelector('#credoInterCta')?.addEventListener('click', () => {
            this.trackPlatformAd(interAd.id, 'click');
            dlg.close();
          });
        }
      }
    } catch {}
  }

  async checkAdminNotifications() {
    if (!this.token || !this.user) return;
    try {
      const res = await this.api('/api/v1/platform-ads/notifications', { noCache: true });
      const unread = (res?.notifications || []).filter((n) => !n.is_read);
      if (unread.length === 0) return;
      const latest = unread[0];
      const shownKey = `credo-notif-seen-${latest.id}`;
      if (sessionStorage.getItem(shownKey)) return;
      sessionStorage.setItem(shownKey, '1');

      const dlg = this.openModal(
        latest.kind === 'warning' ? '⚠ Aviso Oficial de Moderación' : '📢 Comunicado de Credo',
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          <strong style="font-size:1.02rem">${this.esc(latest.title)}</strong>
          <p style="margin:0;font-size:0.88rem;line-height:1.5;color:var(--label-2);white-space:pre-line">${this.esc(latest.body)}</p>
          <div style="display:flex;gap:8px;margin-top:4px">
            ${latest.deep_link && latest.deep_link.startsWith('#/') ? `<a href="${this.esc(latest.deep_link)}" class="btn btn-gold btn-block" id="notifOpenLinkBtn">Ver ahora</a>` : ''}
            <button type="button" class="btn btn-soft btn-block" id="notifAckBtn">Entendido</button>
          </div>
        </div>
        `
      );
      const markRead = () => {
        this.api(`/api/v1/platform-ads/notifications/${latest.id}/read`, { method: 'POST' }).catch(() => {});
        this.closeModal();
      };
      dlg.querySelector('#notifAckBtn')?.addEventListener('click', markRead);
      dlg.querySelector('#notifOpenLinkBtn')?.addEventListener('click', markRead);
    } catch {}
  }

  attachInstantNavPrefetch() {
    if (this._navPrefetchBound) return;
    this._navPrefetchBound = true;

    const warmRoute = (navId) => {
      if (!navId) return;
      if (navId === 'feed') {
        import('./views/feed.js?v=46').catch(() => {});
        if (!this._isFresh('/api/v1/posts?scope=global&limit=6&offset=0', 15_000)) {
          this.api('/api/v1/posts?scope=global&limit=6&offset=0', { ttlMs: 20_000 }).catch(() => {});
        }
      } else if (navId === 'vids') {
        import('./views/vids.js?v=43').catch(() => {});
        if (!this._isFresh('/api/v1/vids', 20_000)) {
          this.api('/api/v1/vids', { ttlMs: 20_000 }).catch(() => {});
        }
      } else if (navId === 'explore') {
        import('./views/explore.js?v=44').catch(() => {});
        if (!this._isFresh('/api/v1/live', 30_000)) {
          this.api('/api/v1/live', { ttlMs: 30_000 }).catch(() => {});
        }
        if (!this._isFresh('/api/v1/users?limit=50', 25_000)) {
          this.api('/api/v1/users?limit=50', { ttlMs: 25_000 }).catch(() => {});
        }
      } else if (navId === 'prayer') {
        import('./views/prayer.js?v=23').catch(() => {});
        if (!this._isFresh('/api/v1/prayers/intentions?filter=recent', 20_000)) {
          this.api('/api/v1/prayers/intentions?filter=recent', { ttlMs: 20_000 }).catch(() => {});
        }
      } else if (navId === 'profile') {
        import('./views/profile.js?v=45').catch(() => {});
        if (this.user?.id) {
          const uPath = `/api/v1/posts?author_id=${this.user.id}&limit=24`;
          if (!this._isFresh(uPath, 20_000)) {
            this.api(uPath, { ttlMs: 20_000 }).catch(() => {});
          }
        }
      }
    };

    const handler = (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-nav], a[href^="#/user/"]') : null;
      if (!el) return;
      if (el.dataset?.nav) {
        warmRoute(el.dataset.nav);
        return;
      }
      const href = el.getAttribute('href') || '';
      const m = href.match(/^#\/user\/(\d+)/);
      if (m) {
        import('./views/parishes.js?v=43').catch(() => {});
        const p1 = `/api/v1/users/${m[1]}`;
        if (!this._isFresh(p1, 25_000)) this.api(p1, { ttlMs: 25_000 }).catch(() => {});
      }
    };

    document.addEventListener('pointerover', handler, { passive: true });
    document.addEventListener('touchstart', handler, { passive: true });
  }

  attachAvatarLongPress() {
    if (this._avatarZoomBound) return;
    this._avatarZoomBound = true;
    let pressTimer = 0;
    let suppressClick = false;
    let startPos = null;

    const clearHold = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
      startPos = null;
    };

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button && e.button !== 0) return;
        const avEl = e.target.closest('.avatar[data-zoomable], .ig-prof-avatar');
        if (!avEl) return;
        startPos = { x: e.clientX, y: e.clientY };
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          pressTimer = 0;
          suppressClick = true;
          const img = avEl.querySelector('img');
          const src = avEl.dataset.zoomSrc || img?.getAttribute('src') || '';
          const name = avEl.dataset.zoomName || img?.getAttribute('alt') || 'Perfil de Credo';
          const bg = avEl.dataset.zoomBg || getComputedStyle(avEl).getPropertyValue('--av-bg') || '#0F1E36';
          const initials = img ? '' : (avEl.textContent || 'C').trim().slice(0, 3);
          this.openAvatarLightbox({ src, name, bg, initials });
          setTimeout(() => { suppressClick = false; }, 450);
        }, 230);
      },
      { passive: true }
    );

    document.addEventListener(
      'contextmenu',
      (e) => {
        if (e.target.closest?.('.avatar[data-zoomable], .ig-prof-avatar')) {
          e.preventDefault();
        }
      }
    );

    document.addEventListener(
      'pointermove',
      (e) => {
        if (!pressTimer || !startPos) return;
        if (Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y) > 10) clearHold();
      },
      { passive: true }
    );
    document.addEventListener('pointerup', clearHold, { passive: true });
    document.addEventListener('pointercancel', clearHold, { passive: true });
    document.addEventListener(
      'click',
      (e) => {
        if (!suppressClick) return;
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  }

  openAvatarLightbox({ src, name, bg, initials }) {
    document.querySelector('.avatar-lightbox')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'avatar-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', name || 'Foto de perfil');
    overlay.innerHTML = `
      <div class="avatar-lightbox-inner">
        <div class="avatar-lightbox-ring" style="background:${this.esc(bg || '#0F1E36')}">
          ${src ? `<img src="${this.esc(src)}" alt="${this.esc(name)}" />` : `<span>${this.esc(initials || '✝')}</span>`}
        </div>
        ${name ? `<div class="avatar-lightbox-name">${this.esc(name)}</div>` : ''}
      </div>
    `;
    const dismiss = () => overlay.remove();
    overlay.addEventListener('click', dismiss);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
    document.body.appendChild(overlay);
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
          <button type="button" class="dock-btn" data-nav="${t.id}" data-hash="${t.hash}">
            ${t.icon}
            ${t.livePip ? '<span class="live-pip" aria-hidden="true"></span>' : ''}
            <span class="dock-label">${this.esc(d.nav[t.id])}</span>
          </button>`
        ).join('');
        mobileNav.insertAdjacentHTML('beforeend', linksHtml);
        this._dockPill = createSpringPill(mobileNav, indicator);
        mobileNav.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.dock-btn')) this._dockPill?.setPressed(true);
        }, { passive: true });
        const releaseDock = () => this._dockPill?.setPressed(false);
        mobileNav.addEventListener('pointerup', releaseDock, { passive: true });
        mobileNav.addEventListener('pointercancel', releaseDock, { passive: true });

        mobileNav.addEventListener('click', (e) => {
          const btn = e.target.closest('.dock-btn[data-nav]');
          if (!btn || !this._dockPill) return;
          const targetHash = btn.dataset.hash;
          mobileNav.querySelectorAll('.dock-btn').forEach((b) => {
            const on = b === btn;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-current', on ? 'page' : 'false');
          });
          this._dockPill.moveTo(btn, false);
          if (targetHash && location.hash !== targetHash) {
            location.hash = targetHash;
          }
        });
        if (typeof ResizeObserver === 'function') {
          let lastWidth = mobileNav.getBoundingClientRect().width;
          new ResizeObserver(() => {
            const wNow = mobileNav.getBoundingClientRect().width;
            if (Math.abs(wNow - lastWidth) < 1) return;
            lastWidth = wNow;
            const curActive = mobileNav.querySelector('.dock-btn.is-active');
            if (curActive && this._dockPill) {
              this._dockPill.moveTo(curActive, true);
            }
          }).observe(mobileNav);
        }
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
        const snapNow = Boolean(immediatePill || !this._dockPill.isReady?.());
        this._dockPill.moveTo(activeBtn, snapNow);
        if (!this._dockPill.isReady?.()) {
          requestAnimationFrame(() => this._dockPill?.moveTo(activeBtn, true));
          setTimeout(() => this._dockPill?.moveTo(activeBtn, true), 60);
        }
      }
    }

    const coBtn = document.getElementById('desktopCredoOneBtn');
    if (coBtn) {
      this.syncCredoOneButton(coBtn, this.user);
      coBtn.onclick = () => this.openCredoOne();
    }
    const feedCoBtn = document.getElementById('feedCredoOneBtn');
    if (feedCoBtn) this.syncCredoOneButton(feedCoBtn, this.user);
    const profCoBtn = document.getElementById('profCredoOneBtn');
    if (profCoBtn) this.syncCredoOneButton(profCoBtn, this.user);

    // Desktop & Mobile Publish buttons (Clergy or Credo One Pro/Business) & Account chip
    const pubBtn = document.getElementById('desktopPublishBtn');
    if (pubBtn) {
      pubBtn.hidden = !this.user?.can_publish;
      pubBtn.onclick = () => this.openComposer();
    }
    const feedPubBtn = document.getElementById('feedPublishBtn');
    if (feedPubBtn) {
      feedPubBtn.hidden = !this.user?.can_publish;
    }

    const accBtn = document.getElementById('desktopAccountBtn');
    if (accBtn) {
      const u = this.user;
      const planMeta = this.getPlanMeta(u);
      const avUrl = u?.avatar_url && u.avatar_url.includes('aire96fm.com.do')
        ? `/api/v1/media/proxy?url=${encodeURIComponent(u.avatar_url)}`
        : u?.avatar_url;
      accBtn.innerHTML = `
        <span class="avatar" style="--av-sz:36px;--av-bg:${this.esc(u?.avatar_color || '#0A84FF')}">
          ${avUrl ? `<img src="${this.esc(avUrl)}" alt="" />` : (u ? this.initials(u.full_name) : '✝')}
        </span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <strong style="font-size:0.86rem;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            <span style="overflow:hidden;text-overflow:ellipsis">${this.esc(u ? u.full_name : d.profile.signIn)}</span>
            ${u ? this.renderCtoInsignia(u) : ''}
            ${planMeta ? this.renderPlanInsignia(u) : ''}
          </strong>
          <small class="t-caption" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(u ? (u.is_ceo ? 'CEO · Credo' : (this.isCtoUser(u) ? 'CTO · Arquitectura Credo' : (planMeta ? planMeta.name : (d.ranks[u.ecclesiastical_rank] || 'Fiel')))) : 'Entrar a Credo')}</small>
        </span>
      `;
      accBtn.onclick = () => {
        location.hash = '#/profile';
      };
    }
  }

  isCtoUser(user) {
    if (!user) return false;
    return Boolean(
      user.is_cto ||
      user.author_is_cto ||
      String(user.username || '').trim().toLowerCase() === 'paulinosstudios'
    );
  }

  renderCtoInsignia(user, { variant = 'compact' } = {}) {
    if (!this.isCtoUser(user)) return '';
    const iconSvg =
      '<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 6.5-3.5 3.5L7 13.5"/><path d="m13 6.5 3.5 3.5-3.5 3.5"/><path d="m11.2 4.8-2.4 10.4"/></svg>';
    if (variant === 'executive') {
      return `<span class="cto-badge cto-badge--exec" title="Chief Technology Officer · Credo">${iconSvg}<span>CTO · CHIEF TECHNOLOGY OFFICER</span></span>`;
    }
    return `<span class="cto-badge" title="Chief Technology Officer · Credo" aria-label="CTO">${iconSvg}<span>CTO</span></span>`;
  }

  getPlanMeta(user) {
    const sku = String(user?.active_plan_sku || '').trim();
    if (!sku) return null;
    const map = {
      user_one_plus: {
        sku: 'user_one_plus',
        name: user?.active_plan_name || 'Credo One Plus',
        shortName: 'Credo One Plus',
        tier: 'plus',
        subtitle: 'Insignia gris · Sin anuncios · Audio continuo',
      },
      user_one_pro: {
        sku: 'user_one_pro',
        name: user?.active_plan_name || 'Credo One Pro',
        shortName: 'Credo One Pro',
        tier: 'pro',
        subtitle: 'Creador Verificado · Publicación habilitada · Sin anuncios',
      },
      biz_one_plus: {
        sku: 'biz_one_plus',
        name: user?.active_plan_name || 'Credo One Empresas Plus',
        shortName: 'Empresas Plus',
        tier: 'biz-plus',
        subtitle: 'Credo One Studio · 15,000 impresiones/mes',
      },
      biz_one_pro: {
        sku: 'biz_one_pro',
        name: user?.active_plan_name || 'Credo One Empresas Pro',
        shortName: 'Empresas Pro',
        tier: 'biz-pro',
        subtitle: 'Credo One Studio Pro · 50,000 impresiones/mes',
      },
      biz_one_enterprise: {
        sku: 'biz_one_enterprise',
        name: user?.active_plan_name || 'Credo One Enterprise',
        shortName: 'Enterprise',
        tier: 'enterprise',
        subtitle: 'Cuenta Corporativa · Patrocinio y SLA dedicado',
      },
    };
    return map[sku] || {
      sku,
      name: user?.active_plan_name || 'Credo One',
      shortName: user?.active_plan_name || 'Credo One',
      tier: 'plus',
      subtitle: 'Miembro activo Credo One',
    };
  }

  renderPlanInsignia(user, { showLabel = false } = {}) {
    const meta = this.getPlanMeta(user);
    if (!meta) return '';
    // CEO already has the dedicated CEO badge unless we explicitly ask for the full label pill
    if (user?.is_ceo && !showLabel) return '';
    const checkSvg =
      meta.tier === 'enterprise'
        ? '<svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M10 1.5l2.3 5.5L18 9.3l-5.7 2.2L10 17l-2.3-5.5L2 9.3l5.7-2.3z"/></svg>'
        : '<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.2 10.3 8.5 13.5 14.8 6.8"/></svg>';
    if (showLabel) {
      return `<span class="co-insignia co-insignia--pill co-insignia--${meta.tier}" title="${this.esc(meta.name)}">${checkSvg}<span>${this.esc(meta.shortName)}</span></span>`;
    }
    return `<span class="co-insignia co-insignia--icon co-insignia--${meta.tier}" title="${this.esc(meta.name)}" aria-label="${this.esc(meta.name)}">${checkSvg}</span>`;
  }

  syncCredoOneButton(btn, user = this.user) {
    if (!btn) return;
    const meta = this.getPlanMeta(user);
    btn.classList.remove(
      'credo-one-trigger--plus',
      'credo-one-trigger--pro',
      'credo-one-trigger--biz-plus',
      'credo-one-trigger--biz-pro',
      'credo-one-trigger--enterprise'
    );
    if (meta) {
      btn.classList.add(`credo-one-trigger--${meta.tier}`);
      btn.setAttribute('aria-label', `Tu plan activo: ${meta.name}`);
      btn.innerHTML = `
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke-opacity="0.45" stroke-width="1.6"/><path d="M6.3 10.2 8.8 12.6 13.7 7.4"/></svg>
        <span>${this.esc(meta.shortName)}</span>
      `;
    } else {
      btn.setAttribute('aria-label', 'Abrir Familia Credo One');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
        <span>Credo One</span>
      `;
    }
  }

  parseRoute() {
    const rawFull = (location.hash || '#/feed').replace(/^#\/?/, '');
    const [raw, qs = ''] = rawFull.split('?');
    const sp = new URLSearchParams(qs);
    const [seg, arg] = raw.split('/');
    if (seg === 'studio') return { route: 'studio', tab: 'profile', params: { section: arg || 'overview' } };
    if (seg === 'vids' || seg === 'reels') return { route: 'vids', tab: 'vids', params: {} };
    if (seg === 'explore') return { route: 'explore', tab: 'explore', params: { filter: arg || sp.get('filter') || 'all' } };
    if (seg === 'live') return { route: 'explore', tab: 'explore', params: { filter: 'live' } };
    if (seg === 'prayer') return { route: 'prayer', tab: 'prayer', params: {} };
    if (seg === 'parishes' || seg === 'unit') return { route: 'explore', tab: 'explore', params: { filter: 'all' } };
    if (seg === 'user' && arg) return { route: 'user', tab: 'explore', params: { id: arg } };
    if (seg === 'settings') return { route: 'settings', tab: 'profile', params: {} };
    if (seg === 'profile') return { route: 'profile', tab: 'profile', params: {} };
    return { route: 'feed', tab: 'feed', params: {} };
  }

  // Strictly view-based on-demand mounting & lazy ES module loading with Crisp Compositor Slide
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
    const newIdx = NAV_TABS.findIndex((t) => t.id === tab);
    const prevIdx = typeof this._prevTabIdx === 'number' ? this._prevTabIdx : newIdx;
    const dir = newIdx !== -1 && prevIdx !== -1 && newIdx !== prevIdx ? (newIdx > prevIdx ? 1 : -1) : 0;
    const prevRoute = this._prevRoute || '';
    this._prevTabIdx = newIdx !== -1 ? newIdx : prevIdx;
    this._prevRoute = route;

    document.body.classList.toggle('is-vids-mode', route === 'vids');
    try { window.CredoNative?.setImmersive?.(route === 'vids'); } catch {}
    this.renderChrome();

    const root = document.getElementById('appView');
    if (!root) return;
    const stage = root.parentElement;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const shouldSlide = dir !== 0 && !reduceMotion && route !== 'vids' && prevRoute !== 'vids' && route !== 'studio';

    // Capture exiting view layer for crisp GPU-composited directional slide (zero motion blur)
    if (stage) {
      stage.querySelectorAll('.view-exit-layer').forEach((n) => n.remove());
      if (shouldSlide && root.children.length > 0) {
        const ghost = document.createElement('div');
        ghost.className = `view-exit-layer ${dir > 0 ? 'is-exit-to-left' : 'is-exit-to-right'}`;
        ghost.setAttribute('aria-hidden', 'true');
        ghost.innerHTML = root.innerHTML;
        ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        ghost.querySelectorAll('iframe, video, audio').forEach((el) => el.remove());
        stage.appendChild(ghost);
        setTimeout(() => ghost.remove(), 270);
      }
    }

    // Clear previous DOM completely so ONLY the active screen exists in memory/DOM
    root.innerHTML = '';
    try { window.scrollTo(0, 0); } catch {}

    const controller = new AbortController();
    this._activeAbort = controller;

    // Lazy-import ONLY the required view module
    let mod;
    try {
      if (route === 'feed') mod = await import('./views/feed.js?v=46');
      else if (route === 'studio') mod = await import('./views/studio.js?v=49');
      else if (route === 'vids') mod = await import('./views/vids.js?v=43');
      else if (route === 'explore') mod = await import('./views/explore.js?v=44');
      else if (route === 'prayer') mod = await import('./views/prayer.js?v=23');
      else if (route === 'user') mod = await import('./views/parishes.js?v=43');
      else if (route === 'settings') mod = await import('./views/settings.js?v=45');
      else if (route === 'profile') mod = await import('./views/profile.js?v=45');
      else mod = await import('./views/feed.js?v=46');
    } catch (err) {
      root.innerHTML = `<div class="empty-box">Error cargando vista: ${this.esc(err.message)}</div>`;
      return;
    }

    if (seq !== this._routeSeq || controller.signal.aborted) return;

    // Side-by-side directional presentation slide (compositor transform + opacity only, clear after settle)
    root.classList.remove('view-mount', 'view-enter-from-right', 'view-enter-from-left', 'view-enter-subtle');
    void root.offsetWidth;
    const enterCls = shouldSlide ? (dir > 0 ? 'view-enter-from-right' : 'view-enter-from-left') : 'view-enter-subtle';
    root.classList.add('view-mount', enterCls);
    clearTimeout(this._viewTransTimer);
    this._viewTransTimer = setTimeout(() => {
      root.classList.remove('view-enter-from-right', 'view-enter-from-left', 'view-enter-subtle');
    }, 310);

    try {
      const handle = await mod.mount({ root, app: this, signal: controller.signal, route, params });
      if (seq !== this._routeSeq) {
        handle?.cleanup?.();
        return;
      }
      this._activeCleanup = handle?.cleanup || null;
      attachSegSpringPills(root);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        root.innerHTML = `<div class="empty-box">Error en vista: ${this.esc(err?.message || String(err))}</div>`;
      }
    }
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
      if (!st.channel && st.gospelSpeaking && st.speechMeta) {
        const sm = st.speechMeta;
        miniAnchor.hidden = false;
        document.body.classList.add('has-mini-player');
        miniGlass.style.setProperty('--mini-accent', '#0A84FF');
        miniArt.src = sm.cover_url || '/icons/art_gospel.jpg';
        miniStation.textContent = sm.title || 'Lectura Orante';
        miniProg.textContent = sm.artist || 'Credo · Voz Humana';
        miniPlayBtn.innerHTML = ICON_PAUSE;
        return;
      }

      const ch = st.channel;
      if (!ch) {
        miniAnchor.hidden = true;
        document.body.classList.remove('has-mini-player');
        if (this._fullPlayerOpen) this.closeFullPlayerImmediate();
        return;
      }

      miniAnchor.hidden = false;
      document.body.classList.add('has-mini-player');
      const artSrc = ch.cover_url && /^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(ch.cover_url)
        ? `/api/v1/media/proxy?url=${encodeURIComponent(ch.cover_url)}`
        : (ch.cover_url || '/icons/credo-192.png');
      miniGlass.style.setProperty('--mini-accent', ch.accent_color || '#007AFF');
      miniArt.src = artSrc;
      miniStation.textContent = ch.name;
      miniProg.textContent = ch.current_program || ch.tagline || 'En vivo';
      miniPlayBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;

      fpBgGlow.style.setProperty('--fp-accent', ch.accent_color || '#007AFF');
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
    miniCloseBtn.onclick = () => {
      audioEngine.stopGospelSpeech();
      audioEngine.stop();
    };
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

  playLive(channel, { expandPlayer = false } = {}) {
    audioEngine.playChannel(channel);
    if (expandPlayer) this.openFullPlayer();
  }

  // =========================================================================
  // MODALS: GENERIC, STORY VIEWER, AUTH (LOGIN / REGISTER), COMPOSER, ONBOARDING
  // =========================================================================
  _animateSheetOpen(dlg) {
    if (!dlg || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    try {
      const isMobile = window.innerWidth < 720;
      const anim = dlg.animate(
        isMobile
          ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }]
          : [{ opacity: 0, transform: 'translateY(16px) scale(0.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      setTimeout(() => {
        try { anim.finish(); } catch {}
      }, 280);
    } catch {}
  }

  openModal(title, bodyHTML) {
    const dlg = document.getElementById('modalDialog');
    dlg.classList.remove('is-comments-sheet');
    dlg.removeAttribute('data-closing');
    dlg.style.transform = '';
    dlg.innerHTML = `
      <div class="dialog-grabber" aria-hidden="true"></div>
      <div class="dialog-head" id="modalDragZone">
        <h1 id="modalTitle">${this.esc(title)}</h1>
        <button type="button" class="icon-btn-44" id="modalCloseBtn" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="dialog-body">${bodyHTML}</div>
    `;
    dlg.querySelector('#modalCloseBtn').onclick = () => closeTopLayer(dlg);

    // Tactile swipe-down on grabber/header for mobile bottom-sheet
    const dragZone = dlg.querySelector('#modalDragZone');
    const grabber = dlg.querySelector('.dialog-grabber');
    let startY = null;
    const onDown = (e) => {
      if (e.target.closest('button')) return;
      startY = e.clientY;
    };
    const onMove = (e) => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      if (dy > 4 && window.innerWidth < 720) {
        dlg.style.transition = 'none';
        dlg.style.transform = `translateY(${dy}px)`;
      }
    };
    const onUp = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      dlg.style.transition = '';
      dlg.style.transform = '';
      if (dy > 76 && window.innerWidth < 720) closeTopLayer(dlg);
    };
    [grabber, dragZone].forEach((el) => {
      el?.addEventListener('pointerdown', onDown);
      el?.addEventListener('pointermove', onMove);
      el?.addEventListener('pointerup', onUp);
      el?.addEventListener('pointercancel', onUp);
    });

    const wasOpen = dlg.open;
    if (!wasOpen) dlg.showModal();
    if (!wasOpen) this._animateSheetOpen(dlg);
    attachSegSpringPills(dlg);
    return dlg;
  }

  closeModal() {
    closeTopLayer(document.getElementById('modalDialog'));
  }

  openCommentsModal(postOrId, { onCountChange } = {}) {
    const post = typeof postOrId === 'object' && postOrId !== null ? postOrId : { id: Number(postOrId) };
    const postId = Number(post.id);
    if (!postId) return;

    const dlg = document.getElementById('modalDialog');
    dlg.removeAttribute('data-closing');
    dlg.classList.add('is-comments-sheet');
    dlg.style.transform = '';

    const proxyAv = (u) => {
      const raw = u?.avatar_url || '';
      if (raw && /^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(raw)) {
        return `/api/v1/media/proxy?url=${encodeURIComponent(raw)}`;
      }
      return raw;
    };

    const author = post.author || {};
    const authorAv = proxyAv(author);
    const meAv = proxyAv(this.user);
    const captionFull = String(post.content || post.title || '')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const captionLong = captionFull.length > 130;
    const likedIds = new Set();
    let comments = [];

    const EMOJIS = ['❤️', '🙌', '🔥', '👏', '🙏', '🕊️', '✨', '🕯️'];

    dlg.innerHTML = `
      <div class="ig-cs-head" id="igCsDragZone">
        <div class="dialog-grabber" aria-hidden="true"></div>
        <h1 id="modalTitle">Comentarios</h1>
        <button type="button" class="ig-cs-close" id="igCsCloseBtn" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="ig-cs-scroll" id="igCsScroll">
        ${author.full_name || captionFull ? `
          <div class="ig-cs-caption">
            <span class="avatar" style="--av-sz:34px;--av-bg:${this.esc(author.avatar_color || '#0F1E36')}">
              ${authorAv ? `<img src="${this.esc(authorAv)}" alt="" />` : this.initials(author.full_name || 'Credo')}
            </span>
            <div class="ig-cs-main">
              <div class="ig-cs-meta">
                <span class="ig-cs-author">${this.esc(author.title_prefix ? `${author.title_prefix} ` : '')}${this.esc(author.full_name || 'Credo')}</span>
                ${author.is_ceo ? '<span class="rank-tag">CEO</span>' : ''}
                ${this.renderCtoInsignia(author)}
                ${post.created_at ? `<span class="ig-cs-time">${this.relTime(post.created_at)}</span>` : ''}
              </div>
              ${post.title ? `<strong style="font-size:0.84rem;line-height:1.22;margin-top:1px">${this.esc(post.title)}</strong>` : ''}
              ${captionFull ? `
                <p class="ig-cs-text" id="igCsCaptionBody" style="color:var(--label-2);font-size:0.82rem">
                  ${captionLong
                    ? `${this.esc(captionFull.slice(0, 128).trimEnd())}<button type="button" class="post-more-inline" id="igCsExpandCap">… más</button>`
                    : this.esc(captionFull)}
                </p>` : ''}
            </div>
          </div>` : ''}

        <div class="ig-cs-list" id="igCommentsList">
          <div style="padding:14px;display:flex;gap:10px;align-items:center">
            <div class="skeleton" style="width:34px;height:34px;border-radius:50%;flex-shrink:0"></div>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px">
              <div class="skeleton" style="height:11px;width:36%;border-radius:5px"></div>
              <div class="skeleton" style="height:12px;width:72%;border-radius:5px"></div>
            </div>
          </div>
        </div>
      </div>

      <form class="ig-cs-composer" id="igCsForm">
        <div class="ig-cs-emojis" role="group" aria-label="Reacciones rápidas">
          ${EMOJIS.map((em) => `<button type="button" class="ig-cs-emoji-btn" data-cs-emoji="${em}">${em}</button>`).join('')}
        </div>
        <div class="ig-cs-input-row">
          <span class="avatar" style="--av-sz:34px;--av-bg:${this.esc(this.user?.avatar_color || '#0A84FF')}">
            ${meAv ? `<img src="${this.esc(meAv)}" alt="" />` : (this.user ? this.initials(this.user.full_name) : '✝')}
          </span>
          <div class="ig-cs-pill">
            <input type="text" id="igCsInput" name="content" maxlength="600" placeholder="${this.esc(author.full_name ? `Agrega un comentario para ${author.full_name}…` : 'Agrega un comentario…')}" autocomplete="off" />
            <button type="submit" class="ig-cs-post-btn" id="igCsSubmit" disabled>Publicar</button>
          </div>
        </div>
      </form>
    `;

    dlg.querySelector('#igCsCloseBtn').onclick = () => closeTopLayer(dlg);
    dlg.querySelector('#igCsExpandCap')?.addEventListener('click', () => {
      const capEl = dlg.querySelector('#igCsCaptionBody');
      if (capEl) capEl.textContent = captionFull;
    });

    // Swipe-down-to-dismiss on Comments header
    const dragZone = dlg.querySelector('#igCsDragZone');
    let startY = null;
    dragZone.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      startY = e.clientY;
    });
    dragZone.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      if (dy > 4 && window.innerWidth < 720) {
        dlg.style.transition = 'none';
        dlg.style.transform = `translateY(${dy}px)`;
      }
    });
    const finishDrag = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      dlg.style.transition = '';
      dlg.style.transform = '';
      if (dy > 72 && window.innerWidth < 720) closeTopLayer(dlg);
    };
    dragZone.addEventListener('pointerup', finishDrag);
    dragZone.addEventListener('pointercancel', finishDrag);

    const listEl = dlg.querySelector('#igCommentsList');
    const scrollEl = dlg.querySelector('#igCsScroll');
    const inputEl = dlg.querySelector('#igCsInput');
    const submitBtn = dlg.querySelector('#igCsSubmit');
    const formEl = dlg.querySelector('#igCsForm');

    const syncBtn = () => {
      submitBtn.disabled = inputEl.value.trim().length === 0;
    };
    inputEl.addEventListener('input', syncBtn);

    dlg.querySelectorAll('[data-cs-emoji]').forEach((b) => {
      b.addEventListener('click', () => {
        inputEl.value += b.dataset.csEmoji;
        syncBtn();
        inputEl.focus();
      });
    });

    const renderList = () => {
      if (comments.length === 0) {
        listEl.innerHTML = `
          <div class="ig-cs-empty">
            <strong>Todavía no hay comentarios</strong>
            <span>Inicia la conversación.</span>
          </div>
        `;
        return;
      }
      listEl.innerHTML = comments
        .map((c, i) => {
          const cid = c.id ?? `tmp-${i}`;
          const liked = likedIds.has(String(cid));
          const cAv = proxyAv(c.author);
          const handle = c.author?.username || c.author?.full_name || 'Fiel';
          const dispName = c.author?.full_name || handle;
          return `
            <div class="ig-cs-item" data-cid="${this.esc(cid)}">
              <span class="avatar" style="--av-sz:34px;--av-bg:${this.esc(c.author?.avatar_color || '#1E3A5F')}">
                ${cAv ? `<img src="${this.esc(cAv)}" alt="" loading="lazy" />` : this.initials(dispName)}
              </span>
              <div class="ig-cs-main">
                <div class="ig-cs-meta">
                  <span class="ig-cs-author">${this.esc(dispName)}</span>
                  ${c.author?.is_ceo ? '<span class="rank-tag">CEO</span>' : ''}
                  ${this.renderCtoInsignia(c.author)}
                  <span class="ig-cs-time">${this.relTime(c.created_at)}</span>
                </div>
                <p class="ig-cs-text">${this.esc(c.content)}</p>
                <div class="ig-cs-subactions">
                  <button type="button" class="ig-cs-reply-btn" data-reply-user="${this.esc(c.author?.username ? `@${c.author.username}` : dispName)}">Responder</button>
                </div>
              </div>
              <button type="button" class="ig-cs-like-btn${liked ? ' is-liked' : ''}" data-like-cid="${this.esc(cid)}" aria-label="Me gusta">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="${liked ? '#FF3040' : 'none'}" stroke="${liked ? '#FF3040' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                ${liked ? '<span>1</span>' : ''}
              </button>
            </div>
          `;
        })
        .join('');
    };

    listEl.addEventListener('click', (e) => {
      const rep = e.target.closest('[data-reply-user]');
      if (rep) {
        const tag = rep.dataset.replyUser;
        if (!inputEl.value.startsWith(tag)) {
          inputEl.value = `${tag} ${inputEl.value}`.trimStart();
        }
        syncBtn();
        inputEl.focus();
        return;
      }
      const lk = e.target.closest('[data-like-cid]');
      if (lk) {
        const key = String(lk.dataset.likeCid);
        if (likedIds.has(key)) likedIds.delete(key);
        else likedIds.add(key);
        renderList();
      }
    });

    const loadComments = async () => {
      try {
        const res = await this.api(`/api/v1/posts/${postId}/comments`, { noCache: true });
        comments = res.comments || [];
        renderList();
        onCountChange?.(comments.length);
      } catch {
        comments = [];
        renderList();
      }
    };

    formEl.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const content = inputEl.value.trim();
      if (!content) return;
      if (!this.user) {
        closeTopLayer(dlg);
        setTimeout(() => this.openAuthModal(), 180);
        return;
      }

      // Optimistic 0ms Instagram comment append
      const optimistic = {
        id: `opt-${Date.now()}`,
        content,
        created_at: new Date().toISOString(),
        author: {
          full_name: this.user.full_name,
          username: this.user.username,
          avatar_url: this.user.avatar_url,
          avatar_color: this.user.avatar_color,
          is_ceo: this.user.is_ceo,
          is_cto: this.user.is_cto,
        },
      };
      comments.push(optimistic);
      inputEl.value = '';
      syncBtn();
      renderList();
      scrollEl.scrollTop = scrollEl.scrollHeight;
      onCountChange?.(comments.length);

      try {
        await this.api(`/api/v1/posts/${postId}/comments`, {
          method: 'POST',
          body: { content },
        });
        await loadComments();
      } catch (err) {
        comments = comments.filter((x) => x.id !== optimistic.id);
        renderList();
        onCountChange?.(comments.length);
        this.toast(err.message);
      }
    });

    const wasOpen = dlg.open;
    if (!wasOpen) dlg.showModal();
    if (!wasOpen) this._animateSheetOpen(dlg);
    loadComments();
    return dlg;
  }

  openStoryViewer(stories, startIdx = 0) {
    if (!stories || stories.length === 0) return;
    const dlg = document.getElementById('storyDialog');
    let idx = startIdx;
    let muted = false;

    try { window.CredoNative?.setImmersive?.(true); } catch {}

    const closeViewer = () => {
      clearTimeout(this._storyTimer);
      dlg.innerHTML = '';
      if (dlg.open) dlg.close();
      audioEngine.notifyExternalMedia({ playing: false });
      try { window.CredoNative?.setImmersive?.(this.parseRoute().route === 'vids'); } catch {}
      window.dispatchEvent(new CustomEvent('credo:stories-seen'));
    };

    dlg.oncancel = (e) => {
      e.preventDefault();
      closeViewer();
    };

    const show = () => {
      clearTimeout(this._storyTimer);
      const st = stories[idx];
      if (!st) return closeViewer();
      if (st.id != null) this.markStorySeen(st.id);

      const authorAvRaw = st.author?.avatar_url || '';
      const authorAv = authorAvRaw && /^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(authorAvRaw)
        ? `/api/v1/media/proxy?url=${encodeURIComponent(authorAvRaw)}`
        : authorAvRaw;
      const imgSrc = st.image_url && /^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(st.image_url)
        ? `/api/v1/media/proxy?url=${encodeURIComponent(st.image_url)}`
        : (st.image_url || '');
      const isVideoStory = Boolean(st.youtube_id || st.video_url);
      if (isVideoStory && !muted) {
        audioEngine.notifyExternalMedia({
          title: st.caption || st.author?.full_name || 'Historia en Credo',
          artist: st.author?.full_name || 'Credo · Historia',
          coverUrl: imgSrc || authorAv || '/icons/credo-192.png',
          playing: true,
          onAction: (act) => {
            if (act === 'stop' || act === 'pause') closeViewer();
          },
        });
      } else {
        audioEngine.notifyExternalMedia({ playing: false });
      }
      const ytUrl = st.youtube_id
        ? `https://www.youtube.com/embed/${encodeURIComponent(st.youtube_id)}?autoplay=1&playsinline=1&rel=0&modestbranding=1&mute=${muted ? 1 : 0}`
        : '';

      const stageMediaHtml = st.video_url
        ? `<div class="story-video-wrap">${imgSrc ? `<img src="${this.esc(imgSrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" />` : ''}<video class="story-video-el" style="position:relative;z-index:1" src="${this.esc(st.video_url)}" autoplay playsinline loop ${muted ? 'muted' : ''}></video></div>`
        : st.youtube_id
          ? `<div class="story-video-wrap">${imgSrc ? `<img src="${this.esc(imgSrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0" />` : ''}<iframe class="story-video-frame" style="position:relative;z-index:1" src="${this.esc(ytUrl)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
          : (imgSrc ? `<img class="story-stage-bg" src="${this.esc(imgSrc)}" alt="" />` : '');

      const durMs = isVideoStory ? 18000 : 6000;

      dlg.innerHTML = `
        <div class="story-stage" style="background:${this.esc(st.bg_gradient || '#0B1424')}">
          ${isVideoStory && imgSrc ? `<img class="story-stage-bg" src="${this.esc(imgSrc)}" alt="" style="filter:blur(28px) saturate(1.4);opacity:0.45" />` : ''}
          ${stageMediaHtml}
          <div class="story-stage-scrim" style="${isVideoStory ? 'pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,0.65),transparent 24%,transparent 68%,rgba(0,0,0,0.88))' : ''}"></div>
          <div>
            <div class="story-bars">
              ${stories.map((_, i) => `<div class="story-bar ${i < idx ? 'is-done' : i === idx ? 'is-active' : ''}"><div class="story-bar-fill" style="${i === idx ? `animation-duration:${durMs}ms` : ''}"></div></div>`).join('')}
            </div>
            <div class="story-top">
              <div style="display:flex;align-items:center;gap:10px;min-width:0">
                <span class="avatar" style="--av-sz:36px;--av-bg:${this.esc(st.author?.avatar_color || '#0F1E36')}">
                  ${authorAv ? `<img src="${this.esc(authorAv)}" alt="" />` : this.initials(st.author?.full_name)}
                </span>
                <div style="min-width:0">
                  <strong style="font-size:0.9rem;color:#fff;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(st.author?.full_name || 'Credo Video')}</strong>
                  <div style="font-size:0.72rem;opacity:0.8;color:#fff">${isVideoStory ? 'Video · ' : ''}${this.relTime(st.created_at)}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${isVideoStory ? `<button type="button" class="story-audio-btn" id="stMute">${muted ? '🔇 Silencio' : '🔊 Audio'}</button>` : ''}
                <button type="button" class="icon-btn-44" id="stClose" style="color:#fff" aria-label="Cerrar">✕</button>
              </div>
            </div>
          </div>
          ${!isVideoStory ? `
            <div class="story-tap-zones">
              <div id="stPrev"></div>
              <div id="stNext"></div>
            </div>` : ''}
          <div class="story-bottom">
            ${isVideoStory ? `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px">
                <span style="color:#66B2FF;font-family:var(--font-serif);font-style:italic">${this.esc(st.scripture_ref || '')}</span>
                <div style="display:flex;gap:8px">
                  <button type="button" id="stPrev" class="story-audio-btn" aria-label="Anterior">‹ Anterior</button>
                  <button type="button" id="stNext" class="story-audio-btn" aria-label="Siguiente">Siguiente ›</button>
                </div>
              </div>` : (st.scripture_ref ? `<span style="color:#66B2FF;font-family:var(--font-serif);font-style:italic">${this.esc(st.scripture_ref)}</span>` : '')}
            <p style="margin:0;font-size:0.98rem;line-height:1.42;color:#fff">${this.esc(st.caption || '')}</p>
          </div>
        </div>
      `;

      dlg.querySelector('#stClose').onclick = closeViewer;
      dlg.querySelector('#stMute')?.addEventListener('click', () => {
        muted = !muted;
        show();
      });
      dlg.querySelector('#stPrev')?.addEventListener('click', () => {
        idx = Math.max(0, idx - 1);
        show();
      });
      dlg.querySelector('#stNext')?.addEventListener('click', () => {
        if (idx + 1 < stories.length) { idx += 1; show(); }
        else closeViewer();
      });

      // Instagram vertical swipe-down to dismiss story
      const stageEl = dlg.querySelector('.story-stage');
      let swipeStart = null;
      stageEl?.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, iframe, video')) return;
        swipeStart = { x: e.clientX, y: e.clientY };
      });
      stageEl?.addEventListener('pointerup', (e) => {
        if (!swipeStart) return;
        const dx = e.clientX - swipeStart.x;
        const dy = e.clientY - swipeStart.y;
        swipeStart = null;
        if (dy > 76 && Math.abs(dy) > Math.abs(dx) * 1.3) {
          closeViewer();
        }
      });

      this._storyTimer = setTimeout(() => {
        if (!dlg.open) return;
        if (idx + 1 < stories.length) { idx += 1; show(); }
        else closeViewer();
      }, durMs);
    };

    if (!dlg.open) dlg.showModal();
    show();
  }

  renderAuthWidget(container, { initialMode = 'login', uidPrefix = 'm', onAuthenticated } = {}) {
    const d = this.dict();
    let mode = initialMode;
    let roleKind = 'lay'; // 'lay' | 'clergy'
    let probeTimer = 0;
    let probeSeq = 0;
    let verifyState = {
      checkedCedula: '',
      checkedName: '',
      validCedula: false,
      duplicate: false,
      nameMatches: false,
      requiresApproval: false,
      errorField: '',
      message: '',
    };

    const fmtCedula = (raw) => {
      const dg = String(raw || '').replace(/\D/g, '').slice(0, 11);
      if (dg.length <= 3) return dg;
      if (dg.length <= 10) return `${dg.slice(0, 3)}-${dg.slice(3)}`;
      return `${dg.slice(0, 3)}-${dg.slice(3, 10)}-${dg.slice(10)}`;
    };

    const linkAriaError = (input, errorId, show) => {
      if (!input) return;
      input.setAttribute('aria-invalid', show ? 'true' : 'false');
      const cur = (input.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((x) => x && x !== errorId);
      if (show && errorId) cur.push(errorId);
      if (cur.length) input.setAttribute('aria-describedby', cur.join(' '));
      else input.removeAttribute('aria-describedby');
    };

    const renderPendingCard = (msg) => {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:12px 4px">
          <div style="width:54px;height:54px;border-radius:50%;background:rgba(48,209,88,0.15);color:#30D158;display:grid;place-items:center;font-size:1.5rem;font-weight:900">✓</div>
          <h3 style="margin:0;font-size:1.08rem">Solicitud enviada a revisión</h3>
          <p style="margin:0;font-size:0.86rem;line-height:1.48;color:var(--label-2)">${this.esc(msg || 'Tu solicitud fue recibida en el panel administrativo de Credo. Una vez confirmada tu identidad podrás iniciar sesión con tu correo y contraseña.')}</p>
          <button type="button" class="btn btn-gold btn-block" id="${uidPrefix}BackLoginBtn">Ir a Iniciar sesión</button>
        </div>
      `;
      container.querySelector(`#${uidPrefix}BackLoginBtn`)?.addEventListener('click', () => {
        mode = 'login';
        render();
      });
    };

    const render = () => {
      const isReg = mode === 'register';
      const isClergy = roleKind === 'clergy';

      container.innerHTML = `
        <div class="segmented" id="${uidPrefix}ModeSeg" style="margin-bottom:12px">
          <button type="button" class="seg-btn${!isReg ? ' is-active' : ''}" data-amode="login">${this.esc(d.profile.signIn)}</button>
          <button type="button" class="seg-btn${isReg ? ' is-active' : ''}" data-amode="register">Crear cuenta</button>
        </div>

        ${!isReg ? `
          <form id="${uidPrefix}LoginForm" style="display:flex;flex-direction:column;gap:12px">
            <div class="field">
              <label for="${uidPrefix}LogId">Correo o usuario</label>
              <input id="${uidPrefix}LogId" name="identifier" type="text" placeholder="tu@correo.com" required autocomplete="username" autocorrect="off" autocapitalize="none" spellcheck="false" />
            </div>
            <div class="field">
              <label for="${uidPrefix}LogPass">Contraseña</label>
              <div class="pass-wrap">
                <input id="${uidPrefix}LogPass" name="password" type="password" placeholder="••••••••" required autocomplete="current-password" />
                <button type="button" class="pass-toggle-btn" data-toggle-pass="${uidPrefix}LogPass" aria-pressed="false">Mostrar</button>
              </div>
            </div>
            <div id="${uidPrefix}LogErr" class="claim-form-err" hidden role="alert"></div>
            <button type="submit" class="btn btn-gold btn-block" id="${uidPrefix}LogSubmit">${this.esc(d.profile.signIn)}</button>
          </form>
        ` : `
          <form id="${uidPrefix}RegForm" style="display:flex;flex-direction:column;gap:11px" novalidate>
            <div class="reg-role-cards" role="group" aria-label="Tipo de registro">
              <button type="button" class="reg-role-btn" data-rkind="lay" aria-pressed="${!isClergy}">
                <strong>Fiel Laico</strong>
                <small>Acceso con verificación de cédula</small>
              </button>
              <button type="button" class="reg-role-btn" data-rkind="clergy" aria-pressed="${isClergy}">
                <strong>Clero / Consagrados</strong>
                <small>Sacerdotes, diáconos, monjas e iglesias</small>
              </button>
            </div>

            ${isClergy ? `
              <div style="padding:9px 11px;border-radius:10px;background:light-dark(rgba(10,132,255,0.08),rgba(10,132,255,0.16));font-size:0.78rem;line-height:1.38;color:var(--label)">
                <strong>Solicitud oficial:</strong> Las cuentas de presbíteros, diáconos, vida consagrada e iglesias pasan por confirmación en el panel de Credo antes de activarse.
              </div>
              <div class="field">
                <label for="${uidPrefix}RegRank">Ministerio en la Iglesia</label>
                <select id="${uidPrefix}RegRank" name="ecclesiastical_rank">
                  <option value="priest">Sacerdote / Presbítero</option>
                  <option value="deacon">Diácono</option>
                  <option value="religious">Religiosa / Monja / Religioso</option>
                  <option value="seminarian">Seminarista</option>
                  <option value="monsignor">Monseñor</option>
                  <option value="bishop">Obispo / Arzobispo</option>
                  <option value="church">Parroquia / Iglesia</option>
                </select>
              </div>
              <div class="field">
                <label for="${uidPrefix}RegOffice">Parroquia, Diócesis o Congregación</label>
                <input id="${uidPrefix}RegOffice" name="current_office_title" type="text" required placeholder="Ej. Parroquia San Juan Bautista · Santo Domingo" />
              </div>
            ` : '<input type="hidden" name="ecclesiastical_rank" value="lay" />'}

            <div class="field" id="${uidPrefix}NameGroup">
              <label for="${uidPrefix}RegName">${isClergy ? 'Nombre y apellidos completos' : 'Nombre y apellidos (exactos a tu cédula)'}</label>
              <input
                id="${uidPrefix}RegName"
                name="full_name"
                type="text"
                required
                autocomplete="name"
                enterkeyhint="next"
                aria-invalid="false"
                placeholder="Ej. Juan Carlos Pérez Gómez"
              />
              <div id="${uidPrefix}NameErr" class="field-error-msg">
                <span role="img" aria-label="Error">❌</span>
                <span id="${uidPrefix}NameErrTxt">Los datos de tu nombre no coinciden con los de tu cédula.</span>
              </div>
            </div>

            <div class="field" id="${uidPrefix}PhoneGroup">
              <label for="${uidPrefix}RegPhone">Teléfono / WhatsApp</label>
              <input
                id="${uidPrefix}RegPhone"
                name="phone"
                type="tel"
                required
                autocomplete="tel"
                enterkeyhint="next"
                aria-invalid="false"
                placeholder="809-000-0000"
              />
              <div id="${uidPrefix}PhoneErr" class="field-error-msg">
                <span role="img" aria-label="Error">❌</span> Ingresa un número de teléfono válido.
              </div>
            </div>

            <div class="field" id="${uidPrefix}EmailGroup">
              <label for="${uidPrefix}RegEmail">Correo electrónico</label>
              <input
                id="${uidPrefix}RegEmail"
                name="email"
                type="email"
                required
                autocomplete="username"
                spellcheck="false"
                enterkeyhint="next"
                aria-invalid="false"
                placeholder="tu@correo.com"
              />
              <div id="${uidPrefix}EmailErr" class="field-error-msg">
                <span role="img" aria-label="Error">❌</span> Ingresa un correo electrónico válido.
              </div>
            </div>

            <div class="field" id="${uidPrefix}PassGroup">
              <label for="${uidPrefix}RegPass">Contraseña (mín. 6 caracteres)</label>
              <div class="pass-wrap">
                <input
                  id="${uidPrefix}RegPass"
                  name="password"
                  type="password"
                  minlength="6"
                  required
                  autocomplete="new-password"
                  enterkeyhint="next"
                  aria-invalid="false"
                  placeholder="Mínimo 6 caracteres"
                />
                <button type="button" class="pass-toggle-btn" data-toggle-pass="${uidPrefix}RegPass" aria-pressed="false">Mostrar</button>
              </div>
              <div id="${uidPrefix}PassErr" class="field-error-msg">
                <span role="img" aria-label="Error">❌</span> La contraseña debe tener al menos 6 caracteres.
              </div>
            </div>

            <div class="field" id="${uidPrefix}CedulaGroup">
              <label for="${uidPrefix}RegCedula">Número de Cédula (11 dígitos)</label>
              <input
                id="${uidPrefix}RegCedula"
                name="cedula"
                type="text"
                inputmode="numeric"
                maxlength="13"
                required
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
                enterkeyhint="done"
                aria-invalid="false"
                placeholder="000-0000000-0"
              />
              <div id="${uidPrefix}CedulaErr" class="field-error-msg">
                <span role="img" aria-label="Error">❌</span>
                <span id="${uidPrefix}CedulaErrTxt">Ingresa una cédula válida de 11 dígitos.</span>
              </div>
              <div id="${uidPrefix}CedulaStatus" hidden></div>
              <div id="${uidPrefix}CedulaOcrBox" class="cedula-ocr-box" hidden>
                <div class="cedula-ocr-title">Verificación instantánea con foto de tu cédula</div>
                <div class="cedula-ocr-sub">Sube una foto nítida del frente de tu cédula. Nuestro sistema verifica automáticamente tu nombre y número al instante (foto privada, solo visible para administración).</div>
                <input id="${uidPrefix}CedulaPhotoFile" type="file" accept="image/*" capture="environment" hidden />
                <button type="button" class="cedula-ocr-btn" id="${uidPrefix}CedulaPhotoBtn">Subir o tomar foto de mi cédula (frente)</button>
                <img id="${uidPrefix}CedulaPhotoPrev" class="cedula-ocr-preview" alt="Vista previa de cédula" hidden />
              </div>
            </div>

            <div id="${uidPrefix}RegGlobalErr" class="claim-form-err" hidden role="alert"></div>
            <div id="${uidPrefix}LiveAnnouncer" class="visually-hidden" aria-live="polite"></div>

            <button type="submit" class="btn btn-gold btn-block" id="${uidPrefix}RegSubmit">
              ${isClergy ? 'Enviar solicitud de ingreso' : 'Verificar cédula y entrar'}
            </button>
          </form>
        `}
      `;

      container.querySelector(`#${uidPrefix}ModeSeg`)?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-amode]');
        if (!b || b.dataset.amode === mode) return;
        mode = b.dataset.amode;
        render();
      });

      container.querySelectorAll('[data-toggle-pass]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const inp = container.querySelector(`#${btn.dataset.togglePass}`);
          if (!inp) return;
          const showing = inp.type === 'text';
          inp.type = showing ? 'password' : 'text';
          btn.setAttribute('aria-pressed', String(!showing));
          btn.textContent = showing ? 'Mostrar' : 'Ocultar';
        });
      });

      container.querySelectorAll('[data-rkind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.dataset.rkind === roleKind) return;
          roleKind = btn.dataset.rkind;
          render();
        });
      });

      const loginForm = container.querySelector(`#${uidPrefix}LoginForm`);
      if (loginForm) {
        loginForm.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const fd = new FormData(loginForm);
          const errBox = container.querySelector(`#${uidPrefix}LogErr`);
          const subBtn = container.querySelector(`#${uidPrefix}LogSubmit`);
          errBox.hidden = true;
          subBtn.disabled = true;
          try {
            const res = await this.api('/api/v1/auth/login', {
              method: 'POST',
              body: { identifier: fd.get('identifier'), password: fd.get('password') },
            });
            this._applySession(res);
            onAuthenticated?.(res);
          } catch (err) {
            errBox.textContent = err.message || 'Credenciales incorrectas.';
            errBox.hidden = false;
            subBtn.disabled = false;
          }
        });
        return;
      }

      const regForm = container.querySelector(`#${uidPrefix}RegForm`);
      if (!regForm) return;

      const nameGroup = container.querySelector(`#${uidPrefix}NameGroup`);
      const nameInput = container.querySelector(`#${uidPrefix}RegName`);
      const nameErrTxt = container.querySelector(`#${uidPrefix}NameErrTxt`);
      const cedulaGroup = container.querySelector(`#${uidPrefix}CedulaGroup`);
      const cedulaInput = container.querySelector(`#${uidPrefix}RegCedula`);
      const cedulaErrTxt = container.querySelector(`#${uidPrefix}CedulaErrTxt`);
      const cedulaStatus = container.querySelector(`#${uidPrefix}CedulaStatus`);
      const ocrBox = container.querySelector(`#${uidPrefix}CedulaOcrBox`);
      const ocrFileInp = container.querySelector(`#${uidPrefix}CedulaPhotoFile`);
      const ocrPhotoBtn = container.querySelector(`#${uidPrefix}CedulaPhotoBtn`);
      const ocrPrevImg = container.querySelector(`#${uidPrefix}CedulaPhotoPrev`);
      const globalErr = container.querySelector(`#${uidPrefix}RegGlobalErr`);
      const announcer = container.querySelector(`#${uidPrefix}LiveAnnouncer`);
      const submitBtn = container.querySelector(`#${uidPrefix}RegSubmit`);
      let announceTimer = 0;
      let ocrProofToken = '';
      let cedulaPhotoId = null;

      const clearOcrProof = () => {
        ocrProofToken = '';
        cedulaPhotoId = null;
      };

      const compressCedulaPhoto = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('No se pudo leer la foto seleccionada.'));
          reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Formato de imagen no válido.'));
            img.onload = () => {
              const maxW = 1800;
              const scale = img.width > maxW ? maxW / img.width : 1;
              const w = Math.max(1, Math.round(img.width * scale));
              const h = Math.max(1, Math.round(img.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              resolve(canvas.toDataURL('image/jpeg', 0.88));
            };
            img.src = String(reader.result || '');
          };
          reader.readAsDataURL(file);
        });

      const announcePolite = (text) => {
        if (!announcer) return;
        clearTimeout(announceTimer);
        announcer.textContent = '';
        if (!text) return;
        announceTimer = setTimeout(() => {
          announcer.textContent = text;
        }, 500);
      };

      [
        [`#${uidPrefix}RegPhone`, `${uidPrefix}PhoneErr`],
        [`#${uidPrefix}RegEmail`, `${uidPrefix}EmailErr`],
        [`#${uidPrefix}RegPass`, `${uidPrefix}PassErr`],
      ].forEach(([sel, errId]) => {
        const inp = container.querySelector(sel);
        inp?.addEventListener('input', () => {
          if (inp.getAttribute('aria-invalid') === 'true') {
            linkAriaError(inp, errId, false);
          }
        });
      });

      const applyVerifyVisuals = (st, { announce = false } = {}) => {
        nameGroup.classList.remove('field--mismatch', 'field--verified');
        cedulaGroup.classList.remove('field--mismatch', 'field--verified');
        linkAriaError(nameInput, `${uidPrefix}NameErr`, false);
        linkAriaError(cedulaInput, `${uidPrefix}CedulaErr`, false);

        if (!st) {
          cedulaStatus.hidden = true;
          if (ocrBox) ocrBox.hidden = true;
          announcePolite('');
          return;
        }

        if (st.errorField === 'cedula') {
          cedulaGroup.classList.add('field--mismatch');
          const msg = st.message || 'Cédula no válida.';
          if (cedulaErrTxt) cedulaErrTxt.textContent = msg;
          linkAriaError(cedulaInput, `${uidPrefix}CedulaErr`, true);
          cedulaStatus.hidden = true;
          if (ocrBox && !st.keepOcrBox) ocrBox.hidden = true;
          if (announce) announcePolite(`Error en cédula: ${msg}`);
          return;
        }

        if (st.errorField === 'full_name') {
          nameGroup.classList.add('field--mismatch');
          const msg =
            st.message ||
            'Los datos de tu nombre no coinciden con los de tu cédula. Corrige tu nombre y apellido exactos.';
          if (nameErrTxt) {
            nameErrTxt.textContent = msg;
          }
          linkAriaError(nameInput, `${uidPrefix}NameErr`, true);
          cedulaStatus.className = 'cedula-status-pill cedula-status-pill--err';
          cedulaStatus.textContent = '⚠ El nombre escrito arriba no coincide con esta cédula.';
          cedulaStatus.hidden = false;
          if (ocrBox && !st.keepOcrBox) ocrBox.hidden = true;
          if (announce) announcePolite(`Error en nombre: ${msg}`);
          return;
        }

        if (st.validCedula && st.lookupStatus === 'manual_review' && !st.nameMatches && !ocrProofToken) {
          cedulaStatus.className = 'cedula-status-pill cedula-status-pill--warn';
          cedulaStatus.textContent = `⏳ ${st.message || 'Cédula válida. Sube foto de tu cédula o envíala a revisión manual.'}`;
          cedulaStatus.hidden = false;
          if (ocrBox) ocrBox.hidden = st.supportsPhotoOcr === false;
          if (announce) announcePolite(st.message || 'Sube foto de tu cédula o envía a revisión manual.');
          return;
        }

        if (st.validCedula && (st.nameMatches || ocrProofToken || isClergy)) {
          nameGroup.classList.add('field--verified');
          cedulaGroup.classList.add('field--verified');
          cedulaStatus.className = 'cedula-status-pill cedula-status-pill--ok';
          cedulaStatus.textContent = `✓ ${st.message || 'Identidad verificada con tu cédula.'}`;
          cedulaStatus.hidden = false;
          if (ocrBox && !ocrProofToken && !isClergy) ocrBox.hidden = true;
          announcePolite('');
        }
      };

      ocrPhotoBtn?.addEventListener('click', () => ocrFileInp?.click());
      ocrFileInp?.addEventListener('change', async () => {
        const file = ocrFileInp.files?.[0];
        if (!file) return;
        const digits = String(cedulaInput.value || '').replace(/\D/g, '');
        const curName = String(nameInput.value || '').trim();
        if (digits.length !== 11 || curName.split(/\s+/).filter((w) => w.length >= 2).length < 2) {
          globalErr.textContent = 'Completa primero tu nombre completo y cédula de 11 dígitos antes de escanear la foto.';
          globalErr.hidden = false;
          return;
        }

        ocrPhotoBtn.disabled = true;
        ocrPhotoBtn.textContent = 'Escaneando cédula con OCR seguro…';
        cedulaStatus.className = 'cedula-status-pill cedula-status-pill--checking';
        cedulaStatus.textContent = 'Leyendo número y nombre en tu cédula…';
        cedulaStatus.hidden = false;

        try {
          const dataUrl = await compressCedulaPhoto(file);
          if (ocrPrevImg) {
            ocrPrevImg.src = dataUrl;
            ocrPrevImg.hidden = false;
          }
          const res = await this.api('/api/v1/auth/verify-cedula-photo', {
            method: 'POST',
            body: { cedula: digits, full_name: curName, image_data_url: dataUrl },
          });
          cedulaPhotoId = res.photo_id || null;

          if (res.verified && res.ocr_proof_token) {
            ocrProofToken = res.ocr_proof_token;
            verifyState = {
              ...verifyState,
              checkedCedula: digits,
              checkedName: curName,
              validCedula: true,
              nameMatches: true,
              errorField: '',
              message: res.message || 'Foto de cédula verificada por OCR · Ya puedes entrar al instante.',
            };
            applyVerifyVisuals(verifyState, { announce: true });
            ocrPhotoBtn.textContent = '✓ Cédula verificada · Cambiar foto';
          } else {
            ocrProofToken = '';
            if (res.error_field === 'full_name' || res.error_field === 'cedula') {
              applyVerifyVisuals(
                {
                  ...verifyState,
                  errorField: res.error_field,
                  keepOcrBox: true,
                  message: res.message,
                },
                { announce: true }
              );
            } else {
              cedulaStatus.className = 'cedula-status-pill cedula-status-pill--warn';
              cedulaStatus.textContent = `⏳ ${res.message || 'Foto adjuntada · Puedes intentar una más clara o enviar a revisión manual.'}`;
              cedulaStatus.hidden = false;
            }
            ocrPhotoBtn.textContent = 'Tomar otra foto más nítida';
          }
        } catch (err) {
          ocrProofToken = '';
          cedulaStatus.className = 'cedula-status-pill cedula-status-pill--err';
          cedulaStatus.textContent = err.message || 'No se pudo leer la foto de la cédula.';
          cedulaStatus.hidden = false;
          ocrPhotoBtn.textContent = 'Intentar de nuevo con otra foto';
        } finally {
          ocrPhotoBtn.disabled = false;
        }
      });

      const runLiveCedulaCheck = async ({ announce = true } = {}) => {
        const digits = String(cedulaInput.value || '').replace(/\D/g, '');
        const curName = String(nameInput.value || '').trim();
        const curRank = isClergy
          ? container.querySelector(`#${uidPrefix}RegRank`)?.value || 'priest'
          : 'lay';

        if (digits.length < 11) {
          verifyState = { checkedCedula: '', checkedName: '', validCedula: false };
          clearOcrProof();
          applyVerifyVisuals(null);
          return null;
        }

        const seq = ++probeSeq;
        cedulaStatus.className = 'cedula-status-pill cedula-status-pill--checking';
        cedulaStatus.textContent = 'Verificando cédula con tus datos…';
        cedulaStatus.hidden = false;

        try {
          const res = await this.api('/api/v1/auth/verify-cedula', {
            method: 'POST',
            body: { cedula: digits, full_name: curName, ecclesiastical_rank: curRank },
          });
          if (seq !== probeSeq) return null;
          verifyState = {
            checkedCedula: digits,
            checkedName: curName,
            validCedula: Boolean(res.valid_cedula),
            duplicate: Boolean(res.duplicate),
            nameMatches: Boolean(res.name_matches),
            lookupStatus: res.lookup_status || '',
            requiresApproval: Boolean(res.requires_approval),
            supportsPhotoOcr: res.supports_photo_ocr !== false,
            errorField: res.error_field || '',
            message: res.message || '',
          };
          applyVerifyVisuals(verifyState, { announce });
          return verifyState;
        } catch (err) {
          if (seq !== probeSeq) return null;
          cedulaStatus.className = 'cedula-status-pill cedula-status-pill--err';
          cedulaStatus.textContent = err.message || 'Error al verificar la cédula.';
          cedulaStatus.hidden = false;
          return null;
        }
      };

      cedulaInput.addEventListener('input', () => {
        const formatted = fmtCedula(cedulaInput.value);
        if (cedulaInput.value !== formatted) cedulaInput.value = formatted;
        globalErr.hidden = true;
        clearOcrProof();
        clearTimeout(probeTimer);
        const digits = formatted.replace(/\D/g, '');
        if (digits.length === 11) {
          probeTimer = setTimeout(() => runLiveCedulaCheck({ announce: true }), 180);
        } else {
          applyVerifyVisuals(null);
        }
      });

      cedulaInput.addEventListener('blur', () => {
        const digits = cedulaInput.value.replace(/\D/g, '');
        if (digits.length > 0 && digits.length < 11) {
          applyVerifyVisuals(
            {
              errorField: 'cedula',
              message: 'Completa los 11 dígitos de tu cédula (000-0000000-0).',
            },
            { announce: true }
          );
        } else if (digits.length === 11 && !ocrProofToken) {
          runLiveCedulaCheck({ announce: true });
        }
      });

      nameInput.addEventListener('input', () => {
        globalErr.hidden = true;
        clearOcrProof();
        if (nameGroup.classList.contains('field--mismatch')) {
          nameGroup.classList.remove('field--mismatch');
          linkAriaError(nameInput, `${uidPrefix}NameErr`, false);
        }
        const digits = cedulaInput.value.replace(/\D/g, '');
        if (digits.length === 11) {
          clearTimeout(probeTimer);
          probeTimer = setTimeout(() => runLiveCedulaCheck({ announce: true }), 320);
        }
      });

      regForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        globalErr.hidden = true;

        const fd = new FormData(regForm);
        const cleanName = String(fd.get('full_name') || '').trim();
        const cleanPhone = String(fd.get('phone') || '').trim();
        const cleanEmail = String(fd.get('email') || '').trim();
        const cleanPass = String(fd.get('password') || '');
        const digits = String(fd.get('cedula') || '').replace(/\D/g, '');

        if (cleanName.split(/\s+/).filter(Boolean).length < 2) {
          applyVerifyVisuals({
            errorField: 'full_name',
            message: 'Escribe tu nombre y apellido completos tal como figuran en tu cédula.',
          });
          nameInput.focus();
          return;
        }
        if (cleanPhone.replace(/\D/g, '').length < 8) {
          const pInp = container.querySelector(`#${uidPrefix}RegPhone`);
          linkAriaError(pInp, `${uidPrefix}PhoneErr`, true);
          pInp?.focus();
          return;
        }
        if (!cleanEmail.includes('@')) {
          const eInp = container.querySelector(`#${uidPrefix}RegEmail`);
          linkAriaError(eInp, `${uidPrefix}EmailErr`, true);
          eInp?.focus();
          return;
        }
        if (cleanPass.length < 6) {
          const pwInp = container.querySelector(`#${uidPrefix}RegPass`);
          linkAriaError(pwInp, `${uidPrefix}PassErr`, true);
          pwInp?.focus();
          return;
        }
        if (digits.length !== 11) {
          applyVerifyVisuals({
            errorField: 'cedula',
            message: 'Ingresa los 11 dígitos de tu cédula (000-0000000-0).',
          });
          cedulaInput.focus();
          return;
        }

        submitBtn.disabled = true;
        const origLabel = submitBtn.textContent;
        submitBtn.textContent = 'Verificando identidad…';

        try {
          if (!ocrProofToken && (verifyState.checkedCedula !== digits || verifyState.checkedName !== cleanName)) {
            await runLiveCedulaCheck();
          }

          if (verifyState.errorField === 'cedula' || !verifyState.validCedula || verifyState.duplicate) {
            cedulaInput.focus();
            submitBtn.disabled = false;
            submitBtn.textContent = origLabel;
            return;
          }

          if (!isClergy && !ocrProofToken && verifyState.errorField === 'full_name') {
            nameInput.focus();
            submitBtn.disabled = false;
            submitBtn.textContent = origLabel;
            return;
          }

          const res = await this.api('/api/v1/auth/register', {
            method: 'POST',
            body: {
              full_name: cleanName,
              phone: cleanPhone,
              email: cleanEmail,
              password: cleanPass,
              cedula: digits,
              ecclesiastical_rank: fd.get('ecclesiastical_rank') || 'lay',
              current_office_title: fd.get('current_office_title') || '',
              preferred_locale: this.locale,
              ocr_proof_token: ocrProofToken || undefined,
              cedula_photo_id: cedulaPhotoId || undefined,
            },
          });

          if (res.pending_approval) {
            renderPendingCard(res.message);
            return;
          }

          this._applySession(res);
          onAuthenticated?.(res);
        } catch (err) {
          const msg = err.message || 'No se pudo completar el registro.';
          if (/nombre.*c[eé]dula|coinciden/i.test(msg)) {
            applyVerifyVisuals({ errorField: 'full_name', message: msg });
            nameInput.focus();
          } else if (/c[eé]dula/i.test(msg)) {
            applyVerifyVisuals({ errorField: 'cedula', message: msg });
            cedulaInput.focus();
          } else {
            globalErr.textContent = msg;
            globalErr.hidden = false;
          }
          submitBtn.disabled = false;
          submitBtn.textContent = origLabel;
        }
      });
    };

    render();
  }

  openAuthModal(initialMode = 'login') {
    const dlg = this.openModal(
      'Acceso a Credo',
      `<div id="modalAuthMount"></div>`
    );
    const mountEl = dlg.querySelector('#modalAuthMount');
    this.renderAuthWidget(mountEl, {
      initialMode,
      uidPrefix: 'dlgAuth',
      onAuthenticated: () => {
        this.closeModal();
      },
    });
  }

  async openClaimProfileModal(claimToken) {
    const cleanTok = String(claimToken || '').trim();
    if (!cleanTok) return;

    const loadingDlg = this.openModal(
      'Bienvenida a Credo',
      `<div style="padding:18px 0;text-align:center;color:var(--label-2)">Verificando tu perfil oficial…</div>`
    );

    let data;
    try {
      const pref = this._claimPrefetch;
      this._claimPrefetch = null;
      data = await (pref || this.api(`/api/v1/auth/claim/${encodeURIComponent(cleanTok)}`, { noCache: true }));
    } catch (err) {
      const msg = err?.message || 'Este enlace de bienvenida no es válido o ya fue utilizado.';
      if (loadingDlg) {
        this.openModal(
          'Enlace de Bienvenida',
          `
          <div style="display:flex;flex-direction:column;gap:14px">
            <p style="margin:0;color:var(--label-2);line-height:1.5">${this.esc(msg)}</p>
            <button type="button" class="btn btn-gold btn-block" id="claimGoLoginBtn">Iniciar sesión con mi cuenta</button>
          </div>
          `
        );
        document.getElementById('claimGoLoginBtn')?.addEventListener('click', () => {
          this.closeModal();
          setTimeout(() => this.openAuthModal(), 180);
        });
      }
      return;
    }

    const p = data?.profile || {};
    const displayTitle = `${p.title_prefix ? p.title_prefix + ' ' : ''}${p.full_name || 'Perfil Oficial'}`;

    const dlg = this.openModal(
      'Activar tu Perfil Oficial',
      `
      <div class="claim-hero-card">
        <span class="avatar" style="--av-sz:56px;--av-bg:${this.esc(p.avatar_color || '#0F1E36')}">
          ${p.avatar_url ? `<img src="${this.esc(p.avatar_url)}" alt="" />` : this.esc(this.initials(p.full_name || 'C'))}
        </span>
        <div class="claim-hero-meta">
          <div class="claim-hero-name">
            <strong>${this.esc(displayTitle)}</strong>
            ${p.is_ceo ? '<span class="ceo-pill">CEO</span>' : ''}
          </div>
          <small>@${this.esc(p.username || '')}${p.posts_count ? ` · ${p.posts_count} publicaciones listas en tu perfil` : ''}</small>
        </div>
      </div>

      <p style="margin:0;font-size:0.86rem;color:var(--label-2);line-height:1.45">
        Tu perfil oficial ya está creado. Ingresa tu correo electrónico, elige tu contraseña personal y confirma tus datos para entrar directamente.
      </p>

      <form id="claimProfileForm" class="claim-form">
        <div class="field">
          <label for="claimEmail">Tu correo electrónico (para iniciar sesión)</label>
          <input
            id="claimEmail"
            name="email"
            type="email"
            value="${this.esc(p.email || '')}"
            placeholder="ejemplo@correo.com"
            autocomplete="username"
            spellcheck="false"
            enterkeyhint="next"
            required
          />
        </div>

        <div class="field">
          <label for="claimNewPassword">Crea tu contraseña (mín. 6 caracteres)</label>
          <div class="claim-pass-wrap">
            <input
              id="claimNewPassword"
              name="new-password"
              type="password"
              minlength="6"
              placeholder="Escribe tu contraseña segura"
              autocomplete="new-password"
              enterkeyhint="done"
              required
            />
            <button type="button" class="claim-pass-toggle" id="claimTogglePass" aria-label="Mostrar contraseña">Mostrar</button>
          </div>
        </div>

        <div id="claimFormError" class="claim-form-err" hidden></div>

        <button type="submit" class="btn btn-gold btn-block" id="claimSubmitBtn">
          Guardar mis datos y entrar a mi perfil
        </button>

        <div class="claim-extra-box">
          <span class="claim-extra-title">Datos visibles en tu perfil (puedes ajustarlos ahora o después)</span>
          <div class="field">
            <label for="claimFullName">Nombre completo</label>
            <input
              id="claimFullName"
              name="full_name"
              type="text"
              value="${this.esc(p.full_name || '')}"
              autocomplete="name"
              enterkeyhint="next"
              required
            />
          </div>
          <div class="claim-row-2">
            <div class="field">
              <label for="claimPrefix">Título</label>
              <input
                id="claimPrefix"
                name="title_prefix"
                type="text"
                value="${this.esc(p.title_prefix || 'P.')}"
                placeholder="P."
                enterkeyhint="next"
              />
            </div>
            <div class="field">
              <label for="claimUsername">Usuario (@)</label>
              <input
                id="claimUsername"
                name="username"
                type="text"
                value="${this.esc(p.username || '')}"
                spellcheck="false"
                autocapitalize="none"
                autocorrect="off"
                enterkeyhint="next"
              />
            </div>
          </div>
          <div class="field">
            <label for="claimBio">Presentación / Biografía (opcional)</label>
            <textarea
              id="claimBio"
              name="bio"
              rows="2"
              placeholder="Ej. Sacerdote · Aire 96 FM y Reflexionando la Palabra"
            >${this.esc(p.bio || '')}</textarea>
          </div>
        </div>
      </form>
      `
    );

    const passInput = dlg.querySelector('#claimNewPassword');
    const passToggle = dlg.querySelector('#claimTogglePass');
    passToggle?.addEventListener('click', () => {
      if (!passInput) return;
      const showing = passInput.type === 'text';
      passInput.type = showing ? 'password' : 'text';
      passToggle.textContent = showing ? 'Mostrar' : 'Ocultar';
      passToggle.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });

    const errEl = dlg.querySelector('#claimFormError');
    const submitBtn = dlg.querySelector('#claimSubmitBtn');
    dlg.querySelector('#claimProfileForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }
      const fd = new FormData(ev.target);
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Activando tu perfil…';
      }
      try {
        const res = await this.api(`/api/v1/auth/claim/${encodeURIComponent(cleanTok)}`, {
          method: 'POST',
          body: {
            email: fd.get('email'),
            password: fd.get('new-password'),
            full_name: fd.get('full_name'),
            title_prefix: fd.get('title_prefix'),
            username: fd.get('username'),
            bio: fd.get('bio'),
          },
        });
        this.closeModal();
        this._applySession(res);
        location.hash = '#/profile';
      } catch (err) {
        if (errEl) {
          errEl.textContent = err?.message || 'No se pudo activar tu perfil.';
          errEl.hidden = false;
        } else {
          this.toast(err?.message || 'Error al guardar');
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Guardar mis datos y entrar a mi perfil';
        }
      }
    });
  }

  _applySession({ token, user }) {
    this.token = token;
    this.user = user;
    try {
      localStorage.setItem('credo-token', token);
      if (user) localStorage.setItem('credo-user-cache', JSON.stringify(user));
    } catch {}
    this.toast(`Bienvenido, ${user.title_prefix ? user.title_prefix + ' ' : ''}${user.full_name}`);
    this.renderChrome();
    this.navigate();
  }

  logout() {
    this.token = '';
    this.user = null;
    try {
      localStorage.removeItem('credo-token');
      localStorage.removeItem('credo-user-cache');
    } catch {}
    this.clearLocalCache();
    this.toast('Sesión cerrada');
    this.renderChrome();
  }

  async uploadMediaFast(fileOrBlob, { onProgress = null, maxImageSide = 1600 } = {}) {
    let blob = fileOrBlob;
    let width = null;
    let height = null;

    if (blob.type && blob.type.startsWith('image/') && blob.type !== 'image/gif') {
      const compressed = await compressImageToBlob(blob, maxImageSide, 0.85);
      blob = compressed.blob;
      width = compressed.width;
      height = compressed.height;
    }

    const mime = (blob.type || 'application/octet-stream').toLowerCase();
    const totalBytes = blob.size;
    const tStart = performance.now();

    // Hardware-accelerated WebCrypto SHA-256 for instant O(1) PostgreSQL deduplication (<8ms for photos/clips)
    let sha256 = '';
    if (totalBytes <= 48 * 1024 * 1024 && window.crypto?.subtle) {
      try {
        const ab = await blob.arrayBuffer();
        const digest = await window.crypto.subtle.digest('SHA-256', ab);
        sha256 = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch {}
    }

    const presign = await this.api('/api/v1/media/presign', {
      method: 'POST',
      body: { mime_type: mime, size_bytes: totalBytes, sha256 },
    });

    if (presign?.instant_dedup && presign?.public_url) {
      onProgress?.({ pct: 100, mbPerSec: 999, instant: true });
      return { url: presign.public_url, kind: presign.kind || 'image', width, height, deduplicated: true };
    }

    if (presign?.direct_supported && presign?.upload_url && presign?.ticket) {
      try {
        const chunkBytes = Number(presign.chunk_bytes) || 8 * 1024 * 1024;
        const chunkTotal = Math.max(1, Math.ceil(totalBytes / chunkBytes));
        const tk = presign.ticket;

        for (let idx = 0; idx < chunkTotal; idx += 1) {
          const start = idx * chunkBytes;
          const end = Math.min(totalBytes, start + chunkBytes);
          const slice = blob.slice(start, end);

          let attempt = 0;
          while (attempt < 3) {
            try {
              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', presign.upload_url, true);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.setRequestHeader('X-Credo-Key', tk.key);
                xhr.setRequestHeader('X-Credo-Mime', tk.mime);
                xhr.setRequestHeader('X-Credo-Max-Bytes', tk.max_bytes);
                xhr.setRequestHeader('X-Credo-Exp', tk.exp);
                xhr.setRequestHeader('X-Credo-Sig', tk.sig);
                xhr.setRequestHeader('X-Credo-Chunk-Index', String(idx));
                xhr.setRequestHeader('X-Credo-Chunk-Total', String(chunkTotal));

                xhr.upload.onprogress = (ev) => {
                  if (!ev.lengthComputable) return;
                  const sent = start + ev.loaded;
                  const pct = Math.min(99, Math.round((sent / totalBytes) * 100));
                  const dt = Math.max(0.05, (performance.now() - tStart) / 1000);
                  const mbPerSec = sent / (1024 * 1024) / dt;
                  onProgress?.({ pct, mbPerSec });
                };

                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve();
                  else reject(new Error(`Edge HTTP ${xhr.status}: ${xhr.responseText?.slice(0, 120)}`));
                };
                xhr.onerror = () => reject(new Error('Network error reaching Edge CDN'));
                xhr.send(slice);
              });
              break;
            } catch (chunkErr) {
              attempt += 1;
              if (attempt >= 3) throw chunkErr;
              await new Promise((r) => setTimeout(r, 350 * attempt));
            }
          }
        }

        await this.api('/api/v1/media/complete', {
          method: 'POST',
          body: { session_id: presign.session_id, width, height },
        });
        onProgress?.({ pct: 100, mbPerSec: totalBytes / (1024 * 1024) / Math.max(0.05, (performance.now() - tStart) / 1000) });
        return { url: presign.public_url, kind: presign.kind, width, height };
      } catch (directErr) {
        console.warn('[uploadMediaFast] Direct Edge fallback to 358 Mbps binary relay:', directErr.message);
      }
    }

    // Automatic high-speed 358 Mbps raw binary fallback via VPS -> 4TB Edge Storage
    const res = await fetch('/api/v1/media/binary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Media-Mime': mime,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error subiendo archivo (${res.status})`);
    }
    onProgress?.({ pct: 100, mbPerSec: 0 });
    return { url: data.url, kind: data.kind || 'image', width, height };
  }

  openComposer({ defaultKind = 'article' } = {}) {
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

    const isReel = defaultKind === 'reel';
    const dlg = this.openModal(
      isReel ? 'Nuevo Reel / Video Oficial' : 'Nueva Publicación Oficial',
      `
      <form id="composeForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="field">
          <label for="cType">Tipo de publicación</label>
          <select id="cType" name="post_type">
            <option value="homily"${isReel ? ' selected' : ''}>Homilía</option>
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
          <label for="cMediaFile">Fotografía HD o Video directo (MP4 / MOV / WebP hasta 500 MB)</label>
          <input id="cMediaFile" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" />
        </div>
        <div class="field">
          <label for="cYouTube">O enlace de YouTube / Shorts (opcional)</label>
          <input id="cYouTube" name="youtube_url" type="url" placeholder="https://www.youtube.com/shorts/..." />
        </div>
        <div class="field">
          <label for="cBody">Contenido</label>
          <textarea id="cBody" name="content" required placeholder="Comparte tu mensaje pastoral con la comunidad…"></textarea>
        </div>
        <div class="field">
          <label for="cScripture">Cita bíblica (opcional)</label>
          <input id="cScripture" name="scripture_ref" type="text" placeholder="Ej. Jn 15, 9–17" />
        </div>
        <div id="cUploadProgressBox" class="turbo-upload-box" hidden>
          <div class="turbo-upload-meta">
            <span id="cUploadLabel">⚡ Conectando con Credo Edge CDN…</span>
            <strong id="cUploadPct">0%</strong>
          </div>
          <div class="turbo-upload-track"><div id="cUploadFill" class="turbo-upload-fill"></div></div>
        </div>
        <button type="submit" class="btn btn-gold btn-block" id="cSubmitBtn">Publicar oficialmente</button>
      </form>
      `
    );

    dlg.querySelector('#composeForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const fd = new FormData(form);
      const submitBtn = form.querySelector('#cSubmitBtn');
      const progBox = form.querySelector('#cUploadProgressBox');
      const progLbl = form.querySelector('#cUploadLabel');
      const progPct = form.querySelector('#cUploadPct');
      const progFill = form.querySelector('#cUploadFill');

      let image_url = '';
      let video_url = '';
      let video_duration = '';

      const file = form.querySelector('#cMediaFile').files?.[0];
      if (submitBtn) submitBtn.disabled = true;

      if (file) {
        try {
          if (progBox) progBox.hidden = false;
          const isVideo = file.type.startsWith('video/');

          if (isVideo) {
            const posterInfo = await extractVideoPosterBlob(file).catch(() => null);
            if (posterInfo?.blob) {
              const posterUp = await this.uploadMediaFast(posterInfo.blob);
              image_url = posterUp.url || '';
              video_duration = posterInfo.durationLabel || '';
            }
          }

          const up = await this.uploadMediaFast(file, {
            onProgress: ({ pct, mbPerSec, instant }) => {
              if (progPct) progPct.textContent = `${pct}%`;
              if (progFill) progFill.style.width = `${pct}%`;
              if (progLbl) {
                progLbl.textContent = instant
                  ? '⚡ Deduplicado instantáneo (0 ms)'
                  : `⚡ Credo Edge CDN · ${mbPerSec > 0 ? mbPerSec.toFixed(1) + ' MB/s' : 'transfiriendo…'}`;
              }
            },
          });

          if (isVideo || up.kind === 'video') {
            video_url = up.url;
          } else {
            image_url = up.url;
          }
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          if (progBox) progBox.hidden = true;
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
            youtube_url: fd.get('youtube_url'),
            content: fd.get('content'),
            scripture_ref: fd.get('scripture_ref'),
            image_url,
            video_url,
            video_duration,
          },
        });
        this.closeModal();
        this.toast('Publicación oficial enviada');
        const curRoute = this.parseRoute().route;
        if (curRoute === 'feed' || curRoute === 'vids' || curRoute === 'profile') this.navigate();
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
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
          <img src="/icons/credo-192.png" alt="Credo" width="68" height="68" style="display:block;margin:0 auto" />
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

function compressImageToBlob(file, maxSide = 1600, quality = 0.85) {
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
      canvas.toBlob(
        (webpBlob) => {
          if (webpBlob) {
            resolve({ blob: webpBlob, width, height });
            return;
          }
          canvas.toBlob(
            (jpgBlob) => {
              if (jpgBlob) resolve({ blob: jpgBlob, width, height });
              else reject(new Error('No se pudo codificar la imagen'));
            },
            'image/jpeg',
            quality
          );
        },
        'image/webp',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo procesar la imagen'));
    };
    img.src = url;
  });
}

function extractVideoPosterBlob(videoFile) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(videoFile);
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch {}
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 4000);

    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 0) * 0.1);
    };
    v.onseeked = () => {
      clearTimeout(timer);
      const w = Math.min(1080, v.videoWidth || 720);
      const h = Math.round((w * (v.videoHeight || 1280)) / (v.videoWidth || 720));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(v, 0, 0, w, h);
      const dur = Number(v.duration || 0);
      const mins = Math.floor(dur / 60);
      const secs = String(Math.floor(dur % 60)).padStart(2, '0');
      const durationLabel = dur > 0 ? `${mins}:${secs}` : '';
      canvas.toBlob(
        (blob) => {
          cleanup();
          resolve(blob ? { blob, durationLabel } : null);
        },
        'image/webp',
        0.82
      );
    };
    v.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    };
    v.src = url;
  });
}

const app = new CredoApp();
window.__CREDO__ = app;
app.bootstrap();

