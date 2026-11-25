// sw.js — Credo Offline-First Shell & Zero-Latency Local Image Cache (v35)
const SHELL_CACHE = 'credo-shell-v35';
const IMG_CACHE = 'credo-img-v2';
const MAX_IMG_ENTRIES = 160;

const SHELL_ASSETS = [
  '/',
  '/styles.css?v=25',
  '/credo-one.css?v=35',
  '/app.js?v=35',
  '/credo-one-sheet.js?v=35',
  '/springs.mjs?v=23',
  '/glass.js?v=23',
  '/audio-engine.js?v=23',
  '/i18n.js?v=23',
  '/views/feed.js?v=35',
  '/views/explore.js?v=25',
  '/views/prayer.js?v=23',
  '/views/profile.js?v=35',
  '/views/studio.js?v=26',
  '/views/vids.js?v=23',
  '/views/parishes.js?v=35',
  '/views/settings.js?v=23',
  '/icons/credo-192.png',
  '/icons/art_rosary.jpg',
  '/icons/art_music.jpg',
  '/icons/art_morning.jpg',
  '/icons/art_gospel.jpg',
  '/icons/art_sorrow.jpg',
  '/icons/art_glory.jpg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== IMG_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

async function trimImageCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_IMG_ENTRIES) {
      const excess = keys.length - MAX_IMG_ENTRIES;
      for (let i = 0; i < excess; i += 1) {
        await cache.delete(keys[i]);
      }
    }
  } catch {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never touch live radio / audio / TTS streams
  if (
    url.pathname.includes('/stream') ||
    url.pathname.startsWith('/api/v1/rosary/audio') ||
    url.pathname.startsWith('/api/v1/rosary/tts')
  ) {
    return;
  }

  // 1. Proxied & uploaded images -> Cache-First (0ms instant feed/profile/radio photos!)
  if (url.pathname.startsWith('/api/v1/media/')) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const net = await fetch(req);
        if (net && net.ok && net.status === 200) {
          cache.put(req, net.clone()).then(() => trimImageCache(cache));
        }
        return net;
      })
    );
    return;
  }

  // Never intercept JSON API calls (handled by app.js 2-tier Memory + localStorage SWR cache)
  if (url.pathname.startsWith('/api/')) return;

  // 2. Navigation / HTML -> Network-First (instant updates on first open, offline cache fallback)
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        try {
          const net = await fetch(req, { cache: 'no-cache' });
          if (net && net.ok) cache.put('/', net.clone());
          return net;
        } catch {
          return (await cache.match('/')) || new Response('Offline', { status: 503 });
        }
      })
    );
    return;
  }

  // 3. Versioned static assets (JS, MJS, CSS, Icons) -> Cache-First (0ms!)
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      if (net && net.ok && net.status === 200) {
        cache.put(req, net.clone());
      }
      return net;
    })
  );
});
