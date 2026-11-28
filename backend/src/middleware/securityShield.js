const { pool } = require('../db/pool');
const {
  getClientIp,
  getUpstreamProxyPeerIp,
  isCloudflareEdgeIp,
  isPrivateOrLoopbackIp,
  findActiveIpBan,
  refreshSystemState,
} = require('../services/systemState');
const { evictSessionsForUserOrIp } = require('../services/liveTelemetry');

// Throttle DB writes per offending IP so high-volume bot floods never saturate PostgreSQL
const recentOffenderFlushes = new Map(); // ip -> timestamp
const inMemoryWafStats = {
  blockedTotalSinceBoot: 0,
  autoBannedSinceBoot: 0,
  originBypassBlockedSinceBoot: 0,
};

// High-confidence exploit, CMS scanner, secret probe, RCE & traversal signatures
const EXPLOIT_PATH_RE =
  /(?:^|\/)(?:wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|wlwmanifest\.xml|phpmyadmin|pma|myadmin|adminer|dbadmin|mysqladmin|vendor\/phpunit|phpunit|boaform|actuator|cgi-bin|hnap1|hudson|jenkins|solr|autodiscover|owa|ecp|server-status|server-info|telescope|_ignition|elfinder|kcfinder|fckeditor|ckeditor|alfa\.php|shell\.php|c99\.php|r57\.php)(?:\/|$|\?)/i;

const FORBIDDEN_EXT_RE = /\.(?:php\d?|phtml|phar|asp|aspx|ashx|jsp|jspx|cgi|pl|py|sh|bash|env|git|svn|hg|bak|old|orig|swp|sql|sqlite|ini|conf|pem|key|crt)(?:$|\?)/i;

const DOTFILE_SECRET_RE = /(?:^|\/)\.(?:env|git|svn|hg|aws|ssh|docker|npmrc|bashrc|zshrc|htaccess|htpasswd|ds_store|vscode|idea)(?:\/|$|\.|\?)/i;

const PATH_TRAVERSAL_RE = /(?:\.\.\/|\.\.\\|%2e%2e|%252e%252e|%00|\/etc\/passwd|\/proc\/self|win\.ini)/i;

const QUERY_INJECTION_RE = /(?:union\s+(?:all\s+)?select|information_schema|\$\{jndi:|<\s*script\b|javascript:|on(?:error|load)\s*=|;\s*(?:wget|curl|chmod|rm\s+-rf)\b)/i;

const MALICIOUS_UA_RE =
  /(?:sqlmap|nikto|nmap|masscan|zgrab|nuclei|acunetix|nessus|openvas|dirbuster|gobuster|ffuf|feroxbuster|wpscan|havij|jndi:|wp-admin|install\.php|xmlrpc\.php|libredtail)/i;

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function classifyThreat(req, ip) {
  const rawUrl = String(req.originalUrl || req.url || '');
  const pathOnly = String(req.path || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '');
  const cfWorker = String(req.headers['cf-worker'] || '').trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  // 0. Origin Cloaking: block external attackers hitting VPS IP directly with Host: credoapp.tech (bypassing Cloudflare WAF)
  const peerIp = getUpstreamProxyPeerIp(req);
  if (
    (hostHeader === 'credoapp.tech' || hostHeader === 'www.credoapp.tech') &&
    peerIp &&
    !isPrivateOrLoopbackIp(peerIp) &&
    !isCloudflareEdgeIp(peerIp)
  ) {
    inMemoryWafStats.originBypassBlockedSinceBoot += 1;
    return {
      rule: 'ORIGIN_BYPASS_BLOCKED',
      reason: `Intento directo al IP origen saltándose Cloudflare bloqueado (${peerIp} -> ${pathOnly.slice(0, 60)})`,
      autoBanHours: 72,
    };
  }

  // Never interfere with health checks or verified PayPal webhook endpoints
  if (
    pathOnly === '/health' ||
    pathOnly === '/api/webhooks/paypal' ||
    pathOnly === '/api/v1/webhooks/paypal'
  ) {
    return null;
  }

  // 1. Block Cloudflare Worker anonymous proxy abuse (e.g. 2a06:98c0:3600::103 Russian botnet)
  if (cfWorker || ip === '2a06:98c0:3600::103') {
    return {
      rule: 'CF_WORKER_BOT_PROXY',
      reason: `Proxy automatizado Cloudflare Worker bloqueado (${cfWorker || '2a06:98c0:3600::103'} -> ${pathOnly.slice(0, 80)})`,
      autoBanHours: 0, // Permanent ban for anonymous Worker proxy abuse
    };
  }

  // 2. Exploit / WordPress / PHPMyAdmin / RCE path probes
  if (EXPLOIT_PATH_RE.test(pathOnly)) {
    return {
      rule: 'CMS_EXPLOIT_PROBE',
      reason: `Escaneo de vulnerabilidades bloqueado (${pathOnly.slice(0, 90)})`,
      autoBanHours: 72,
    };
  }

  // 3. Dotfile / .env / .git secret extraction attempts
  if (DOTFILE_SECRET_RE.test(pathOnly)) {
    return {
      rule: 'SECRET_DOTFILE_PROBE',
      reason: `Intento de lectura de archivos sensibles bloqueado (${pathOnly.slice(0, 90)})`,
      autoBanHours: 168,
    };
  }

  // 4. Non-existent server-side script extensions (.php, .asp, .jsp, .cgi, .sql, .bak)
  if (FORBIDDEN_EXT_RE.test(pathOnly)) {
    return {
      rule: 'FORBIDDEN_SCRIPT_EXT',
      reason: `Sondeo de ejecución remota bloqueado (${pathOnly.slice(0, 90)})`,
      autoBanHours: 72,
    };
  }

  // 5. Directory traversal / LFI
  if (PATH_TRAVERSAL_RE.test(rawUrl)) {
    return {
      rule: 'PATH_TRAVERSAL_LFI',
      reason: `Ataque Path Traversal / LFI bloqueado (${rawUrl.slice(0, 90)})`,
      autoBanHours: 168,
    };
  }

  // 6. SQLi / JNDI / XSS injection in URL query string
  let decodedUrl = rawUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {}
  if (QUERY_INJECTION_RE.test(decodedUrl)) {
    return {
      rule: 'QUERY_INJECTION_PAYLOAD',
      reason: `Payload de inyección bloqueado en URL (${pathOnly.slice(0, 80)})`,
      autoBanHours: 168,
    };
  }

  // 7. Known offensive vulnerability scanner User-Agents
  if (MALICIOUS_UA_RE.test(ua)) {
    return {
      rule: 'OFFENSIVE_SCANNER_UA',
      reason: `Escáner ofensivo detectado en User-Agent (${ua.slice(0, 80)})`,
      autoBanHours: 168,
    };
  }

  return null;
}

async function recordAndBanThreat({ ip, country, method, reqPath, ua, threat }) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return;

  const now = Date.now();
  const prev = recentOffenderFlushes.get(ip) || 0;
  if (now - prev < 60_000) return;
  recentOffenderFlushes.set(ip, now);
  if (recentOffenderFlushes.size > 5000) {
    recentOffenderFlushes.clear();
  }

  try {
    evictSessionsForUserOrIp({ ip });

    await pool.query(
      `INSERT INTO waf_events (ip_address, country_code, method, request_path, user_agent, rule_code, action_taken, hits_count)
       VALUES ($1, $2, $3, $4, $5, $6, 'auto_banned_403', 1)`,
      [
        ip.slice(0, 64),
        String(country || '').slice(0, 8),
        String(method || 'GET').slice(0, 12),
        String(reqPath || '/').slice(0, 240),
        String(ua || '').slice(0, 220),
        threat.rule,
      ]
    );

    if (!findActiveIpBan(ip)) {
      const expiresAt =
        threat.autoBanHours && threat.autoBanHours > 0
          ? new Date(now + threat.autoBanHours * 3600_000).toISOString()
          : null;

      await pool.query(
        `INSERT INTO ip_bans (ip_or_cidr, reason, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (ip_or_cidr) DO UPDATE SET
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           created_at = NOW()`,
        [ip, `[WAF Auto-Shield · ${threat.rule}] ${threat.reason}`.slice(0, 240), expiresAt]
      );
      inMemoryWafStats.autoBannedSinceBoot += 1;
      await refreshSystemState();
    }
  } catch (err) {
    console.warn('[securityShield]', err.message);
  }
}

function securityShieldMiddleware(req, res, next) {
  const ip = getClientIp(req);
  const threat = classifyThreat(req, ip);
  if (!threat) return next();

  req._wafBlocked = true;
  inMemoryWafStats.blockedTotalSinceBoot += 1;
  const country = String(req.headers['cf-ipcountry'] || req.headers['x-country-code'] || '').toUpperCase().slice(0, 4);
  const ua = String(req.headers['user-agent'] || '');

  recordAndBanThreat({
    ip,
    country,
    method: req.method,
    reqPath: req.originalUrl || req.path || '/',
    ua,
    threat,
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Connection', 'close');
  return res.status(403).type('text/plain').send('Forbidden');
}

// Recursively strips Prototype Pollution keys (__proto__, constructor, prototype) & null bytes from parsed JSON/query
function sanitizeValue(val, depth = 0) {
  if (depth > 8 || val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.includes('\u0000') ? val.replace(/\u0000/g, '') : val;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i += 1) {
      val[i] = sanitizeValue(val[i], depth + 1);
    }
    return val;
  }
  if (typeof val === 'object') {
    for (const key of Object.keys(val)) {
      if (DANGEROUS_OBJECT_KEYS.has(key)) {
        delete val[key];
      } else {
        val[key] = sanitizeValue(val[key], depth + 1);
      }
    }
    return val;
  }
  return val;
}

function sanitizeInputMiddleware(req, _res, next) {
  if (req.body && typeof req.body === 'object') sanitizeValue(req.body, 0);
  if (req.query && typeof req.query === 'object') sanitizeValue(req.query, 0);
  return next();
}

function getWafStats() {
  return { ...inMemoryWafStats };
}

module.exports = {
  securityShieldMiddleware,
  sanitizeInputMiddleware,
  classifyThreat,
  getWafStats,
};
