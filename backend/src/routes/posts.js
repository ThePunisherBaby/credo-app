const express = require('express');
const { pool } = require('../db/pool');
const { POST_TYPES } = require('../config');
const { optionalAuth, requireAuth, requireClergy } = require('../middleware/auth');
const { getUnitLineage, serializeUserSummary } = require('../utils/hierarchy');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

async function hydratePosts(rows, viewerId) {
  if (rows.length === 0) return [];

  let viewerReactionsRes = { rows: [] };
  let viewerSavedRes = { rows: [] };

  if (viewerId) {
    const postIds = rows.map((r) => r.id);
    [viewerReactionsRes, viewerSavedRes] = await Promise.all([
      pool.query(
        `SELECT post_id, reaction_type
           FROM post_reactions
          WHERE post_id = ANY($1::int[]) AND user_id = $2`,
        [postIds, viewerId]
      ),
      pool.query(
        `SELECT post_id FROM saved_posts WHERE post_id = ANY($1::int[]) AND user_id = $2`,
        [postIds, viewerId]
      ),
    ]);
  }

  const viewerMap = new Map();
  for (const vr of viewerReactionsRes.rows) {
    if (!viewerMap.has(vr.post_id)) viewerMap.set(vr.post_id, []);
    viewerMap.get(vr.post_id).push(vr.reaction_type);
  }
  const savedSet = new Set(viewerSavedRes.rows.map((s) => s.post_id));

  return rows.map((r) => ({
    id: r.id,
    post_type: r.post_type,
    title: r.title || '',
    content: r.content,
    image_url: r.image_url || '',
    video_url: r.video_url || '',
    visual_theme: r.visual_theme || '',
    media_kind: r.media_kind || 'article',
    youtube_id: r.youtube_id || '',
    video_duration: r.video_duration || '',
    channel_name: r.channel_name || '',
    source_url: r.source_url || '',
    scripture_ref: r.scripture_ref || '',
    event_date: r.event_date || null,
    event_location: r.event_location || '',
    language: r.language || 'es',
    is_pinned: Boolean(r.is_pinned),
    is_saved: savedSet.has(r.id),
    created_at: r.created_at,
    scope_unit: null,
    author: serializeUserSummary(
      {
        id: r.author_id,
        username: r.author_username,
        full_name: r.author_full_name,
        title_prefix: r.author_title_prefix,
        ecclesiastical_rank: r.author_rank,
        religious_order_initials: r.author_order_initials,
        primary_unit_id: null,
        current_office_title: r.author_office_title,
        avatar_color: r.author_avatar_color,
        avatar_url: r.author_avatar_url,
        verification_status: r.author_verification_status,
        country_code: r.author_country_code,
        is_ceo: r.author_is_ceo,
        active_plan_sku: r.author_active_plan_sku || '',
        one_badge: r.author_one_badge || '',
      },
      []
    ),
    reactions: {
      amen: Number(r.amen_count || 0),
      pray: Number(r.pray_count || 0),
      gratitude: Number(r.gratitude_count || 0),
    },
    my_reactions: viewerMap.get(r.id) || [],
    comments_count: Number(r.comments_count || 0),
  }));
}

const POST_SELECT = `
  SELECT p.id, p.author_id, p.post_type, p.title, p.content, p.image_url, p.video_url, p.visual_theme,
         p.media_kind, p.youtube_id, p.video_duration, p.channel_name, p.source_url,
         p.scripture_ref, p.event_date, p.event_location, p.language, p.is_pinned, p.created_at,
         p.amen_count, p.pray_count, p.gratitude_count, p.comments_count,
         u.username AS author_username,
         u.full_name AS author_full_name,
         u.title_prefix AS author_title_prefix,
         u.ecclesiastical_rank AS author_rank,
         u.religious_order_initials AS author_order_initials,
         u.current_office_title AS author_office_title,
         u.avatar_color AS author_avatar_color,
         u.avatar_url AS author_avatar_url,
         u.verification_status AS author_verification_status,
         u.country_code AS author_country_code,
         u.is_ceo AS author_is_ceo,
         u.active_plan_sku AS author_active_plan_sku,
         u.one_badge AS author_one_badge
    FROM posts p
    JOIN users u ON u.id = p.author_id
`;

// High-speed Feed endpoint with cursor/offset pagination, O(1) denormalized counts & singleflight cache
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      scope = 'global',
      author_id,
      post_type,
      media_kind,
      q,
      limit = 40,
      offset = 0,
      before_ts,
      before_id,
    } = req.query;

    const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const viewerId = req.user ? req.user.id : null;

    const runFeedQuery = async () => {
      const clauses = [];
      const params = [];

      if (author_id) {
        params.push(Number(author_id));
        clauses.push(`p.author_id = $${params.length}`);
      }

      if (post_type && POST_TYPES.includes(String(post_type))) {
        params.push(String(post_type));
        clauses.push(`p.post_type = $${params.length}`);
      }

      if (media_kind && ['article', 'video', 'photo'].includes(String(media_kind))) {
        params.push(String(media_kind));
        clauses.push(`p.media_kind = $${params.length}`);
      }

      if (q && String(q).trim()) {
        params.push(`%${String(q).trim()}%`);
        const idx = params.length;
        clauses.push(`(p.title ILIKE $${idx} OR p.content ILIKE $${idx} OR p.scripture_ref ILIKE $${idx})`);
      }

      if (scope === 'saved' && viewerId) {
        params.push(viewerId);
        clauses.push(`p.id IN (SELECT post_id FROM saved_posts WHERE user_id = $${params.length})`);
      } else if (scope === 'following' && viewerId) {
        params.push(viewerId);
        clauses.push(
          `p.author_id IN (SELECT target_user_id FROM follows WHERE follower_id = $${params.length} AND target_user_id IS NOT NULL)`
        );
      }

      if (before_ts && before_id) {
        params.push(before_ts, Number(before_id));
        clauses.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::int)`);
      }

      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(safeLimit);
      const limitIdx = params.length;
      const offsetSql = before_ts && before_id ? '' : `OFFSET $${params.push(safeOffset)}`;

      const { rows } = await pool.query(
        `${POST_SELECT}
          ${whereSql}
          ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC
          LIMIT $${limitIdx} ${offsetSql}`,
        params
      );

      const posts = await hydratePosts(rows, viewerId);
      const last = posts[posts.length - 1];

      // Interleave active Credo One campaigns for non-ad-free viewers on the global feed
      const isAdFreeViewer = Boolean(req.user && req.user.ad_free);
      const viewerCountry = String(req.user?.country_code || req.query.country || 'DO').toUpperCase().slice(0, 4);
      let finalPosts = posts;

      if (!isAdFreeViewer && scope === 'global' && !author_id && !q && posts.length >= 2) {
        const campRes = await pool
          .query(
            `SELECT c.id, c.organization_id, c.post_id, c.title, c.body, c.media_url, c.media_kind,
                    c.objective, c.cta_type, c.cta_label, c.cta_url, c.target_country, c.created_at,
                    o.name AS org_name, o.slug AS org_slug, o.badge_type AS org_badge_type,
                    o.avatar_style AS org_avatar_style, o.avatar_url AS org_avatar_url,
                    o.avatar_color AS org_avatar_color, o.owner_user_id
               FROM campaigns c
               JOIN organizations o ON o.id = c.organization_id
              WHERE c.status = 'active'
                AND c.impressions_served < c.impressions_allocated
                AND (c.starts_at IS NULL OR c.starts_at <= NOW())
                AND (c.ends_at IS NULL OR c.ends_at >= NOW())
                AND (c.target_country = 'ALL' OR c.target_country = $1)
              ORDER BY (c.impressions_allocated - c.impressions_served) DESC, c.updated_at DESC
              LIMIT 3`,
            [viewerCountry]
          )
          .catch(() => ({ rows: [] }));

        if (campRes.rows.length > 0) {
          finalPosts = [];
          let campIdx = 0;
          for (let i = 0; i < posts.length; i++) {
            finalPosts.push(posts[i]);
            if ((i === 1 || (i > 1 && (i - 1) % 6 === 0)) && campIdx < campRes.rows.length) {
              const c = campRes.rows[campIdx++];
              finalPosts.push({
                id: `camp-${c.id}`,
                campaign_id: c.id,
                is_sponsored: true,
                post_type: 'announcement',
                title: c.title,
                content: c.body,
                image_url: c.media_url || '',
                media_kind: c.media_kind || 'photo',
                youtube_id: '',
                channel_name: 'Patrocinado',
                source_url: c.cta_url || '',
                cta_type: c.cta_type,
                cta_label: c.cta_label,
                cta_url: c.cta_url,
                org_badge_type: c.org_badge_type,
                org_avatar_style: c.org_avatar_style,
                created_at: c.created_at,
                author: {
                  id: c.owner_user_id,
                  username: c.org_slug,
                  full_name: c.org_name,
                  title_prefix: '',
                  avatar_url: c.org_avatar_url || '',
                  avatar_color: c.org_avatar_color || '#0A84FF',
                  is_ceo: false,
                  one_badge: c.org_badge_type,
                  avatar_style: c.org_avatar_style,
                },
                reactions: { amen: 0, pray: 0, gratitude: 0 },
                my_reactions: [],
                comments_count: 0,
              });
            }
          }
        }
      }

      return {
        posts: finalPosts,
        next_cursor: last ? { before_ts: last.created_at, before_id: last.id } : null,
      };
    };

    // Anonymous / public feed reads coalesce into one shared PostgreSQL query via singleflight cache
    if (!viewerId && scope === 'global' && !q) {
      const countryKey = String(req.query.country || 'DO').toUpperCase().slice(0, 4);
      const cacheKey = `posts:pub:${countryKey}:${author_id || ''}:${post_type || ''}:${media_kind || ''}:${safeLimit}:${safeOffset}:${before_id || ''}`;
      const cached = await apiCache.getOrLoad(cacheKey, 12000, runFeedQuery);
      res.setHeader('Cache-Control', 'public, max-age=12, stale-while-revalidate=45');
      return res.json(cached);
    }

    const data = await runFeedQuery();
    return res.json(data);
  } catch (err) {
    console.error('[posts/list]', err);
    return res.status(500).json({ error: 'Failed to load feed' });
  }
});

// Single post detail
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const { rows } = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [postId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const [post] = await hydratePosts(rows, req.user ? req.user.id : null);
    return res.json({ post });
  } catch (err) {
    console.error('[posts/detail]', err);
    return res.status(500).json({ error: 'Failed to load post' });
  }
});

function extractYouTubeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

// Create post — STRICTLY CLERGY ONLY (requireClergy middleware)
router.post('/', requireAuth, requireClergy, async (req, res) => {
  try {
    const {
      title = '',
      content,
      post_type = 'reflection',
      scope_unit_id,
      image_url = '',
      video_url = '',
      visual_theme = '',
      media_kind = 'article',
      youtube_id = '',
      youtube_url = '',
      video_duration = '',
      channel_name = '',
      scripture_ref = '',
      event_date = null,
      event_location = '',
      language,
    } = req.body || {};

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (!POST_TYPES.includes(post_type)) {
      return res.status(400).json({ error: 'Invalid post_type' });
    }

    const ytId = extractYouTubeId(youtube_url || youtube_id);
    const cleanVideoUrl = String(video_url || '').trim().slice(0, 1000);
    const hasNativeVideo = /^https:\/\/(media\.credoapp\.tech|st91130\.ispot\.cc)\//i.test(cleanVideoUrl);
    const safeVideoUrl = hasNativeVideo ? cleanVideoUrl : '';
    const safeMediaKind = (ytId || safeVideoUrl)
      ? 'video'
      : (image_url ? 'photo' : (['article', 'video', 'photo'].includes(media_kind) ? media_kind : 'article'));
    const resolvedImage = String(image_url).trim() || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '');
    const { rows } = await pool.query(
      `INSERT INTO posts (
         author_id, scope_unit_id, post_type, title, content,
         image_url, video_url, visual_theme, media_kind, youtube_id, video_duration, channel_name,
         scripture_ref, event_date, event_location, language
       ) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        req.user.id,
        post_type,
        String(title).trim().slice(0, 200),
        String(content).trim().slice(0, 8000),
        resolvedImage.slice(0, 1000),
        safeVideoUrl,
        String(visual_theme).trim().slice(0, 120),
        safeMediaKind,
        ytId,
        String(video_duration).trim().slice(0, 16),
        String(channel_name).trim().slice(0, 120),
        String(scripture_ref).trim().slice(0, 120),
        event_date || null,
        String(event_location).trim().slice(0, 200),
        String(language || req.user.preferred_locale || 'es').slice(0, 5),
      ]
    );

    const createdId = rows[0].id;
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');

    const fullRes = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [createdId]);
    const hydrated = await hydratePosts(fullRes.rows, req.user.id);
    return res.status(201).json({ post: hydrated[0] });
  } catch (err) {
    console.error('[posts/create]', err);
    return res.status(500).json({ error: 'Failed to create publication' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { rows } = await pool.query('SELECT author_id FROM posts WHERE id = $1', [postId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    if (rows[0].author_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not allowed to delete this post' });
    }
    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[posts/delete]', err);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Toggle Instagram Bookmark (Guardar)
router.post('/:id/save', requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const existing = await pool.query(
      'SELECT 1 FROM saved_posts WHERE user_id = $1 AND post_id = $2',
      [req.user.id, postId]
    );
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2', [
        req.user.id,
        postId,
      ]);
      return res.json({ saved: false });
    }
    await pool.query(
      'INSERT INTO saved_posts (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, postId]
    );
    return res.json({ saved: true });
  } catch (err) {
    console.error('[posts/save]', err);
    return res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
});

// Liturgical reactions — ALL authenticated users (clergy + lay)
router.post('/:id/react', requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { reaction_type = 'amen' } = req.body || {};
    if (!['amen', 'pray', 'gratitude'].includes(reaction_type)) {
      return res.status(400).json({ error: 'Invalid reaction_type' });
    }

    const existing = await pool.query(
      `SELECT id FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND reaction_type = $3`,
      [postId, req.user.id, reaction_type]
    );

    let active = false;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM post_reactions WHERE id = $1', [existing.rows[0].id]);
    } else {
      await pool.query(
        `INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [postId, req.user.id, reaction_type]
      );
      active = true;
    }

    const { rows: postCounts } = await pool.query(
      `SELECT amen_count, pray_count, gratitude_count FROM posts WHERE id = $1 LIMIT 1`,
      [postId]
    );
    const { rows: myRows } = await pool.query(
      `SELECT reaction_type FROM post_reactions WHERE post_id = $1 AND user_id = $2`,
      [postId, req.user.id]
    );
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');

    const c = postCounts[0] || { amen_count: 0, pray_count: 0, gratitude_count: 0 };
    return res.json({
      active,
      my_reactions: myRows.map((m) => m.reaction_type),
      reactions: {
        amen: Number(c.amen_count || 0),
        pray: Number(c.pray_count || 0),
        gratitude: Number(c.gratitude_count || 0),
      },
    });
  } catch (err) {
    console.error('[posts/react]', err);
    return res.status(500).json({ error: 'Failed to toggle reaction' });
  }
});

router.get('/:id/comments', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const comments = await apiCache.getOrLoad(`comments:${postId}`, 10000, async () => {
      const { rows } = await pool.query(
        `SELECT c.id, c.post_id, c.content, c.created_at,
                u.id AS author_id, u.username, u.full_name, u.title_prefix,
                u.ecclesiastical_rank, u.religious_order_initials,
                u.current_office_title, u.avatar_color, u.avatar_url,
                u.verification_status, u.country_code, u.is_ceo
           FROM post_comments c
           JOIN users u ON u.id = c.author_id
          WHERE c.post_id = $1
          ORDER BY c.created_at ASC, c.id ASC
          LIMIT 250`,
        [postId]
      );

      return rows.map((r) => ({
        id: r.id,
        post_id: r.post_id,
        content: r.content,
        created_at: r.created_at,
        author: serializeUserSummary(
          {
            id: r.author_id,
            username: r.username,
            full_name: r.full_name,
            title_prefix: r.title_prefix,
            ecclesiastical_rank: r.ecclesiastical_rank,
            religious_order_initials: r.religious_order_initials,
            primary_unit_id: null,
            current_office_title: r.current_office_title,
            avatar_color: r.avatar_color,
            avatar_url: r.avatar_url,
            verification_status: r.verification_status,
            country_code: r.country_code,
            is_ceo: Boolean(r.is_ceo),
          },
          []
        ),
      }));
    });

    return res.json({ comments });
  } catch (err) {
    console.error('[posts/comments/list]', err);
    return res.status(500).json({ error: 'Failed to load comments' });
  }
});

// Comments — ALL authenticated users (clergy + lay)
router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { content } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO post_comments (post_id, author_id, content)
       VALUES ($1, $2, $3) RETURNING id, post_id, content, created_at`,
      [postId, req.user.id, String(content).trim().slice(0, 2000)]
    );

    apiCache.invalidate(`comments:${postId}`);
    apiCache.invalidate('posts:');
    apiCache.invalidate('vids:');

    return res.status(201).json({
      comment: {
        ...rows[0],
        author: serializeUserSummary(req.user, []),
      },
    });
  } catch (err) {
    console.error('[posts/comments/create]', err);
    return res.status(500).json({ error: 'Failed to post comment' });
  }
});

module.exports = router;
