// officialSync.js — Real-time official content federation from P. Domingo Vásquez's portals:
// https://aire96fm.com.do & https://reflexionandolapalabra.com (WordPress REST API)

const { pool } = require('../db/pool');

const ALLOWED_PROXY_HOSTS = new Set(['aire96fm.com.do', 'www.aire96fm.com.do', 'reflexionandolapalabra.com', 'www.reflexionandolapalabra.com']);

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#8211;': '–',
  '&#8212;': '—',
  '&#8216;': '‘',
  '&#8217;': '’',
  '&#8220;': '“',
  '&#8221;': '”',
  '&#8230;': '…',
  '&nbsp;': ' ',
  '&laquo;': '«',
  '&raquo;': '»',
};

function decodeEntities(str) {
  return String(str || '')
    .replace(/&(?:amp|lt|gt|quot|#039|#8211|#8212|#8216|#8217|#8220|#8221|#8230|nbsp|laquo|raquo);/g, (m) => ENTITY_MAP[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toProxiedImage(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (ALLOWED_PROXY_HOSTS.has(u.hostname.toLowerCase())) {
      return `/api/v1/media/proxy?url=${encodeURIComponent(u.toString())}`;
    }
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CredoApp/1.0; +https://credoapp.tech)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

/**
 * Syncs real published articles from aire96fm.com.do and reflexionandolapalabra.com
 * into PostgreSQL posts attributed to CEO P. Domingo Vásquez.
 */
async function syncOfficialSources() {
  const ceoRes = await pool.query(
    "SELECT id, primary_unit_id FROM users WHERE username = 'p_domingo_vasquez' LIMIT 1"
  );
  const ceo = ceoRes.rows[0];
  if (!ceo) return { synced: 0 };

  const feeds = [
    {
      name: 'Aire 96 FM',
      postType: 'announcement',
      url: 'https://aire96fm.com.do/wp-json/wp/v2/posts?per_page=8&_embed=wp:featuredmedia',
    },
    {
      name: 'Reflexionando la Palabra',
      postType: 'reflection',
      url: 'https://reflexionandolapalabra.com/wp-json/wp/v2/posts?per_page=4&_embed=wp:featuredmedia',
    },
  ];

  let synced = 0;

  for (const feed of feeds) {
    try {
      const items = await fetchJson(feed.url);
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const sourceUrl = String(item.link || '').trim();
        if (!sourceUrl) continue;

        const title = htmlToText(item.title?.rendered || '').slice(0, 200);
        const fullText = htmlToText(item.content?.rendered || item.excerpt?.rendered || '').slice(0, 7500);
        if (!fullText) continue;

        const mediaObj = item._embedded?.['wp:featuredmedia']?.[0];
        const rawImg =
          mediaObj?.media_details?.sizes?.large?.source_url ||
          mediaObj?.media_details?.sizes?.medium_large?.source_url ||
          mediaObj?.source_url ||
          '';
        const imageUrl = toProxiedImage(rawImg);
        const createdAt = item.date_gmt ? new Date(item.date_gmt + 'Z') : new Date();

        await pool.query(
          `INSERT INTO posts (
             author_id, scope_unit_id, post_type, title, content, image_url,
             media_kind, channel_name, source_url, language, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'article', $7, $8, 'es', $9)
           ON CONFLICT (source_url) WHERE source_url <> '' DO UPDATE SET
             title = EXCLUDED.title,
             content = EXCLUDED.content,
             image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE posts.image_url END,
             channel_name = EXCLUDED.channel_name`,
          [
            ceo.id,
            ceo.primary_unit_id,
            feed.postType,
            title,
            fullText,
            imageUrl,
            feed.name,
            sourceUrl,
            Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
          ]
        );
        synced += 1;
      }
    } catch (err) {
      console.warn(`[officialSync] Failed ${feed.name}:`, err.message);
    }
  }

  console.log(`[officialSync] Synced ${synced} real posts from Aire 96 FM & Reflexionando la Palabra.`);
  return { synced };
}

// Cached real Daily Liturgy directly from reflexionandolapalabra.com
let liturgyCache = { expiresAt: 0, data: null };

async function getLiveDailyLiturgy() {
  if (liturgyCache.data && Date.now() < liturgyCache.expiresAt) {
    return liturgyCache.data;
  }

  try {
    const items = await fetchJson(
      'https://reflexionandolapalabra.com/wp-json/wp/v2/posts?per_page=5&_fields=id,date,link,title,content,excerpt'
    );
    if (Array.isArray(items) && items.length > 0) {
      const lecturas =
        items.find((p) => /lecturas|evangelio/i.test(p.title?.rendered || '')) || items[0];
      const title = htmlToText(lecturas.title?.rendered || 'Liturgia del Día');
      const fullText = htmlToText(lecturas.content?.rendered || lecturas.excerpt?.rendered || '');
      const paragraphs = fullText.split(/\n{2,}/).filter((x) => x.trim().length > 20);
      const excerpt = (paragraphs[0] || fullText).slice(0, 260);

      const result = {
        liturgical_season: 'Reflexionando la Palabra · Liturgia Oficial',
        saint_of_day: title,
        gospel_ref: 'reflexionandolapalabra.com',
        gospel_title: title,
        gospel_excerpt: excerpt + (excerpt.length >= 260 ? '…' : ''),
        gospel_text: fullText,
        reflection: '',
        source_url: lecturas.link || 'https://reflexionandolapalabra.com',
        first_reading_ref: '',
        first_reading_text: '',
        psalm_ref: '',
        psalm_response: '',
      };

      liturgyCache = { expiresAt: Date.now() + 15 * 60 * 1000, data: result };
      return result;
    }
  } catch (err) {
    console.warn('[officialSync] Liturgy fetch failed:', err.message);
  }

  return null;
}

module.exports = {
  ALLOWED_PROXY_HOSTS,
  syncOfficialSources,
  getLiveDailyLiturgy,
};
