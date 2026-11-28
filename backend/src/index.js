const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { PORT, CLERGY_RANKS } = require('./config');
const { pool, initDatabase } = require('./db/pool');
const { seedIfEmpty, purgeMockDataAndSyncReal } = require('./db/seed');
const { seedCredoOnePlans } = require('./db/credoOneSeed');
const { syncOfficialSources } = require('./utils/officialSync');
const { warmUpRosaryCache } = require('./services/rosaryRadio');
const { optionalAuth } = require('./middleware/auth');
const { apiCache } = require('./utils/fastCache');

const authRoutes = require('./routes/auth');
const unitsRoutes = require('./routes/units');
const usersRoutes = require('./routes/users');
const postsRoutes = require('./routes/posts');
const mediaRoutes = require('./routes/media');
const storiesRoutes = require('./routes/stories');
const liveRoutes = require('./routes/live');
const prayersRoutes = require('./routes/prayers');
const rosaryRoutes = require('./routes/rosary');
const credoOneRoutes = require('./routes/credoOne');
const studioRoutes = require('./routes/studio');
const campaignsTelemetryRoutes = require('./routes/campaignsTelemetry');
const panelAdminRoutes = require('./routes/panelAdmin');
const adminCoreRoutes = require('./routes/adminCore');
const platformAdsPublicRoutes = require('./routes/platformAdsPublic');
const { ipBanMiddleware, maintenanceMiddleware, refreshSystemState } = require('./services/systemState');
const { recordRequestTelemetry } = require('./services/liveTelemetry');

const app = express();
app.set('trust proxy', 1);

// Enforce HTTPS for any non-local HTTP traffic behind reverse proxy
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https' && req.hostname && req.hostname !== 'localhost') {
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  }
  return next();
});

app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'sameorigin' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://www.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypal.com',
          'https://www.paypalobjects.com',
          'https://*.paypalobjects.com',
          'https://*.braintreegateway.com',
          'https://*.braintree-api.com',
          'https://pay.google.com',
          'https://applepay.cdn-apple.com',
          'https://static.cloudflareinsights.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
        ],
        fontSrc: [
          "'self'",
          'data:',
          'https://fonts.gstatic.com',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://media.credoapp.tech',
          'https://st91130.ispot.cc',
          'https://aire96fm.com.do',
          'https://reflexionandolapalabra.com',
          'https://i.ytimg.com',
          'https://i1.ytimg.com',
          'https://i2.ytimg.com',
          'https://i3.ytimg.com',
          'https://i4.ytimg.com',
          'https://www.paypalobjects.com',
          'https://*.paypalobjects.com',
          'https://www.paypal.com',
          'https://*.paypal.com',
          'https://*.braintreegateway.com',
          'https://pay.google.com',
          'https:',
        ],
        mediaSrc: [
          "'self'",
          'blob:',
          'https://media.credoapp.tech',
          'https://st91130.ispot.cc',
          'https://paginas.moisespaulino.com',
        ],
        frameSrc: [
          "'self'",
          'https://www.youtube-nocookie.com',
          'https://www.youtube.com',
          'https://www.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
          'https://*.braintreegateway.com',
          'https://*.venmo.com',
          'https://*.firebaseapp.com',
          'https://pay.google.com',
          'https://*.cardinalcommerce.com',
        ],
        childSrc: [
          "'self'",
          'blob:',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
          'https://*.braintreegateway.com',
        ],
        workerSrc: ["'self'", 'blob:'],
        connectSrc: [
          "'self'",
          'https://media.credoapp.tech',
          'https://st91130.ispot.cc',
          'https://paginas.moisespaulino.com',
          'https://www.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
          'https://api-m.paypal.com',
          'https://api-m.sandbox.paypal.com',
          'https://api.paypal.com',
          'https://api.sandbox.paypal.com',
          'https://*.braintree-api.com',
          'https://*.braintreegateway.com',
          'https://*.venmo.com',
          'https://*.cardinalcommerce.com',
          'https://*.googleapis.com',
          'https://*.firebaseio.com',
          'wss://*.firebaseio.com',
          'https://pay.google.com',
          'https://cloudflareinsights.com',
        ],
        formAction: [
          "'self'",
          'https://www.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypal.com',
        ],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(self "https://www.paypal.com" "https://*.paypal.com")'
  );
  if (req.path.startsWith('/diosesmiguia') || req.path.startsWith('/api/admin')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
});

// Strict Origin Allowlist CORS (blocks cross-origin API abuse from untrusted third-party sites while allowing Credo Web, VOXON & Native Apps)
const ALLOWED_ORIGIN_RE =
  /^(?:https:\/\/(?:[a-z0-9-]+\.)?(?:credoapp\.tech|voxon\.cloud|hstgr\.cloud)|capacitor:\/\/localhost|ionic:\/\/localhost|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/i;

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGIN_RE.test(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
    maxAge: 86400,
  })
);

app.use(
  compression({
    filter: (req, res) => {
      if (
        req.path.includes('/stream') ||
        req.path.includes('/rosary/audio') ||
        res.getHeader('Content-Type') === 'audio/mpeg' ||
        res.getHeader('Content-Type') === 'text/event-stream'
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// Global Security & Telemetry Middlewares (IP/CIDR bans -> Active WAF & Origin Cloaking Shield -> Body Parsers -> Input Sanitizer)
const { securityShieldMiddleware, sanitizeInputMiddleware } = require('./middleware/securityShield');
app.use(ipBanMiddleware);
app.use(securityShieldMiddleware);

// Route-scoped 22MB JSON parser ONLY for verified base64 media/OCR upload endpoints; strict 512KB limit everywhere else (Anti-RAM DoS)
const largeMediaJsonParser = express.json({ limit: '22mb' });
app.use(['/api/v1/auth/verify-cedula-photo', '/api/v1/media', '/api/v1/rosary'], largeMediaJsonParser);
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(sanitizeInputMiddleware);

app.use(optionalAuth);
app.use(recordRequestTelemetry);
app.use(maintenanceMiddleware);

// Strictly hide /admin (returns 404 Not Found so nobody probes an exposed /admin route)
app.all(['/admin', '/admin/*'], (_req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

// Robots.txt strictly disallows indexing of /diosesmiguia
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /diosesmiguia\nDisallow: /api/admin\n');
});

// Health check for Hostinger VPS / Coolify
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', service: 'credo' });
  } catch (err) {
    return res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// Layered Rate Limiters: Global API Anti-Scraping + Auth Limiter + Strict Super-Admin Anti-Brute-Force
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 360,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => require('./services/systemState').getClientIp(req) || req.ip,
  skip: (req) =>
    req.path === '/health' ||
    req.path.startsWith('/api/webhooks/paypal') ||
    req.path.startsWith('/api/v1/webhooks/paypal') ||
    req.path.startsWith('/api/admin/telemetry/stream'),
  message: { error: 'Límite de peticiones por minuto excedido. Espera unos segundos.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => require('./services/systemState').getClientIp(req) || req.ip,
});

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => require('./services/systemState').getClientIp(req) || req.ip,
  skip: (req) => req.method === 'GET' && req.path === '/me',
  message: { error: 'Demasiados intentos en Credo Core OS. Intenta nuevamente en 15 minutos.' },
});

app.use('/api', globalApiLimiter);
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/units', unitsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/posts', postsRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/stories', storiesRoutes);
app.use('/api/v1/live', liveRoutes);
app.use('/api/v1/prayers', prayersRoutes);
app.use('/api/v1/rosary', rosaryRoutes);
app.use('/api/v1/credo-one', credoOneRoutes);
app.use('/api/v1/studio', studioRoutes);
app.use('/api/v1/panel-admin', panelAdminRoutes);
app.use('/api/v1/platform-ads', platformAdsPublicRoutes);
app.use('/api/admin/auth', adminAuthLimiter);
app.use('/api/admin', adminCoreRoutes);
app.use('/api/campaigns', campaignsTelemetryRoutes);
app.use('/api/v1/campaigns', campaignsTelemetryRoutes);
app.post('/api/webhooks/paypal', credoOneRoutes.handlePayPalWebhook);
app.post('/api/v1/webhooks/paypal', credoOneRoutes.handlePayPalWebhook);

// Credo Official Video Reels endpoint (internal clergy/church videos only — zero external EWTN/Vatican feeds)
app.get(['/api/v1/vids', '/api/v1/reels'], optionalAuth, async (_req, res) => {
  try {
    const reels = await apiCache.getOrLoad('vids:global', 15000, async () => {
      const dbRes = await pool.query(
        `SELECT p.id, p.title, p.content, p.image_url, p.video_url, p.youtube_id, p.video_duration,
                p.channel_name, p.source_url, p.scripture_ref, p.created_at,
                p.amen_count, p.comments_count,
                u.id AS author_id, u.username AS author_username, u.full_name AS author_full_name, u.title_prefix AS author_title_prefix,
                u.avatar_color AS author_avatar_color, u.avatar_url AS author_avatar_url, u.is_ceo AS author_is_ceo, u.is_cto AS author_is_cto
           FROM posts p
           JOIN users u ON u.id = p.author_id
          WHERE p.media_kind = 'video'
             OR (p.youtube_id IS NOT NULL AND p.youtube_id <> '')
             OR (p.video_url IS NOT NULL AND p.video_url <> '')
          ORDER BY p.created_at DESC
          LIMIT 30`
      );

      return dbRes.rows.map((r) => ({
        id: `post-${r.id}`,
        post_id: r.id,
        is_external: false,
        video_url: r.video_url || '',
        youtube_id: r.youtube_id || '',
        title: r.title || '',
        description: r.content || '',
        thumbnail_url: r.image_url || (r.youtube_id ? `https://i.ytimg.com/vi/${r.youtube_id}/hqdefault.jpg` : ''),
        published_at: r.created_at,
        source_url: r.source_url || '',
        scripture_ref: r.scripture_ref || '',
        channel_name: r.channel_name || `${r.author_title_prefix ? r.author_title_prefix + ' ' : ''}${r.author_full_name}`,
        author_id: r.author_id,
        author_is_ceo: Boolean(r.author_is_ceo),
        author_is_cto: Boolean(r.author_is_cto || String(r.author_username || '').toLowerCase() === 'paulinosstudios'),
        avatar_url: r.author_avatar_url || '',
        accent_color: r.author_avatar_color || '#0F1E36',
        amen_count: r.amen_count || 0,
        comments_count: r.comments_count || 0,
      }));
    });

    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    return res.json({ reels });
  } catch (err) {
    console.error('[reels/list]', err);
    return res.status(500).json({ error: 'Failed to load reels' });
  }
});

// Global statistics endpoint (singleflight cached for massive concurrency)
app.get('/api/v1/stats', async (_req, res) => {
  try {
    const stats = await apiCache.getOrLoad('stats:global', 30000, async () => {
      const [clergyRes, membersRes, postsRes, liveRes, prayersRes] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS cnt FROM users WHERE ecclesiastical_rank = ANY($1::text[])', [
          [...CLERGY_RANKS],
        ]),
        pool.query('SELECT COUNT(*)::int AS cnt FROM users'),
        pool.query('SELECT COUNT(*)::int AS cnt FROM posts'),
        pool.query('SELECT COUNT(*)::int AS cnt FROM live_channels WHERE is_live = TRUE'),
        pool.query('SELECT COALESCE(SUM(prayers_count), 0)::int AS cnt FROM prayer_intentions'),
      ]);

      return {
        clergy: clergyRes.rows[0].cnt,
        members: membersRes.rows[0].cnt,
        posts: postsRes.rows[0].cnt,
        live_channels: liveRes.rows[0].cnt,
        prayers_total: prayersRes.rows[0].cnt,
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.json(stats);
  } catch (err) {
    console.error('[stats]', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

// Serve ultra-fast Apple-grade Credo PWA from ./public
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      maxAge: '7d',
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.includes('/diosesmiguia/')) {
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        }
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (
          filePath.endsWith('.js') ||
          filePath.endsWith('.mjs') ||
          filePath.endsWith('.css') ||
          filePath.endsWith('.png') ||
          filePath.endsWith('.jpg') ||
          filePath.endsWith('.webp') ||
          filePath.endsWith('.svg')
        ) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );

  // Private Master Admin Console: Credo Core OS exclusively at /diosesmiguia/*
  app.get(['/diosesmiguia', '/diosesmiguia/*'], (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const coreHtml = path.join(publicDir, 'diosesmiguia', 'index.html');
    if (fs.existsSync(coreHtml)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      return res.sendFile(coreHtml);
    }
    return res.status(404).send('Not Found');
  });

  // SPA fallback (strictly return 404 for missing static/config files with extensions so scanners never see 200 OK)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (/\.[a-z0-9]{1,8}$/i.test(req.path)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    const indexHtml = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.sendFile(indexHtml);
    }
    return res.status(200).send('Credo API is running.');
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

async function start() {
  let attempts = 0;
  while (attempts < 20) {
    try {
      await initDatabase();
      await refreshSystemState();
      await seedCredoOnePlans();
      await seedIfEmpty();
      await purgeMockDataAndSyncReal();
      break;
    } catch (err) {
      attempts += 1;
      console.warn(`[startup] Waiting for PostgreSQL (${attempts}/20): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Refresh real articles & sweep expired subscriptions every 15 minutes
  const { expireLapsedSubscriptions } = require('./middleware/rbac');
  setInterval(() => {
    syncOfficialSources()
      .then(() => mediaRoutes.warmUpProxyImages?.())
      .catch((e) => console.warn('[sync-interval]', e.message));
    expireLapsedSubscriptions().catch(() => {});
  }, 15 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[credo] Server listening on http://0.0.0.0:${PORT}`);
    warmUpRosaryCache();
    mediaRoutes.warmUpProxyImages?.();
    expireLapsedSubscriptions().catch(() => {});
    const { bootstrapPayPalAutomation } = require('./services/paypal');
    bootstrapPayPalAutomation().catch((e) => console.warn('[paypal-boot]', e.message));
  });
}

start().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
