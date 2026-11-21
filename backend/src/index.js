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
const { syncOfficialSources } = require('./utils/officialSync');

const authRoutes = require('./routes/auth');
const unitsRoutes = require('./routes/units');
const usersRoutes = require('./routes/users');
const postsRoutes = require('./routes/posts');
const messagesRoutes = require('./routes/messages');
const mediaRoutes = require('./routes/media');
const storiesRoutes = require('./routes/stories');
const liveRoutes = require('./routes/live');
const prayersRoutes = require('./routes/prayers');

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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://images.unsplash.com',
          'https://aire96fm.com.do',
          'https://reflexionandolapalabra.com',
        ],
        mediaSrc: ["'self'", 'blob:', 'https://paginas.moisespaulino.com'],
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
        connectSrc: ["'self'", 'https://paginas.moisespaulino.com'],
        upgradeInsecureRequests: [],
      },
    },
  })
);
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
});
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Health check for Hostinger VPS / Coolify
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', service: 'credo' });
  } catch (err) {
    return res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/units', unitsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/posts', postsRoutes);
app.use('/api/v1/conversations', messagesRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/stories', storiesRoutes);
app.use('/api/v1/live', liveRoutes);
app.use('/api/v1/prayers', prayersRoutes);

// Global statistics endpoint
app.get('/api/v1/stats', async (_req, res) => {
  try {
    const [unitsRes, countriesRes, clergyRes, membersRes, postsRes, liveRes, prayersRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS cnt FROM ecclesiastical_units'),
      pool.query(
        "SELECT COUNT(DISTINCT country_code)::int AS cnt FROM ecclesiastical_units WHERE country_code IS NOT NULL AND country_code <> ''"
      ),
      pool.query('SELECT COUNT(*)::int AS cnt FROM users WHERE ecclesiastical_rank = ANY($1::text[])', [
        [...CLERGY_RANKS],
      ]),
      pool.query('SELECT COUNT(*)::int AS cnt FROM users'),
      pool.query('SELECT COUNT(*)::int AS cnt FROM posts'),
      pool.query('SELECT COUNT(*)::int AS cnt FROM live_channels WHERE is_live = TRUE'),
      pool.query('SELECT COALESCE(SUM(prayers_count), 0)::int AS cnt FROM prayer_intentions'),
    ]);

    return res.json({
      units: unitsRes.rows[0].cnt,
      countries: countriesRes.rows[0].cnt,
      clergy: clergyRes.rows[0].cnt,
      members: membersRes.rows[0].cnt,
      posts: postsRes.rows[0].cnt,
      live_channels: liveRes.rows[0].cnt,
      prayers_total: prayersRes.rows[0].cnt,
    });
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
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith('.html') ||
          filePath.endsWith('.js') ||
          filePath.endsWith('.mjs') ||
          filePath.endsWith('.css')
        ) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    })
  );

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexHtml = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
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
      await seedIfEmpty();
      await purgeMockDataAndSyncReal();
      break;
    } catch (err) {
      attempts += 1;
      console.warn(`[startup] Waiting for PostgreSQL (${attempts}/20): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Refresh real articles from aire96fm.com.do & reflexionandolapalabra.com every 15 minutes
  setInterval(() => {
    syncOfficialSources().catch((e) => console.warn('[sync-interval]', e.message));
  }, 15 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[credo] Server listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
