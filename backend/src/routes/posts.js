const express = require('express');
const { pool } = require('../db/pool');
const { POST_TYPES } = require('../config');
const { optionalAuth, requireAuth, requireClergy } = require('../middleware/auth');
const {
  getUnitLineage,
  getUnitLineagesMap,
  getDescendantUnitIds,
  serializeUserSummary,
} = require('../utils/hierarchy');

const router = express.Router();

async function hydratePosts(rows, viewerId) {
  if (rows.length === 0) return [];

  const postIds = rows.map((r) => r.id);
  const unitIds = [
    ...rows.map((r) => r.scope_unit_id),
    ...rows.map((r) => r.author_primary_unit_id),
  ];

  const [lineages, reactionsRes, commentsCountRes, viewerReactionsRes, viewerSavedRes] =
    await Promise.all([
      getUnitLineagesMap(unitIds),
      pool.query(
        `SELECT post_id, reaction_type, COUNT(*)::int AS cnt
           FROM post_reactions
          WHERE post_id = ANY($1::int[])
          GROUP BY post_id, reaction_type`,
        [postIds]
      ),
      pool.query(
        `SELECT post_id, COUNT(*)::int AS cnt
           FROM post_comments
          WHERE post_id = ANY($1::int[])
          GROUP BY post_id`,
        [postIds]
      ),
      viewerId
        ? pool.query(
            `SELECT post_id, reaction_type
               FROM post_reactions
              WHERE post_id = ANY($1::int[]) AND user_id = $2`,
            [postIds, viewerId]
          )
        : Promise.resolve({ rows: [] }),
      viewerId
        ? pool.query(
            `SELECT post_id FROM saved_posts WHERE post_id = ANY($1::int[]) AND user_id = $2`,
            [postIds, viewerId]
          )
        : Promise.resolve({ rows: [] }),
    ]);

  const reactionMap = new Map();
  for (const r of reactionsRes.rows) {
    if (!reactionMap.has(r.post_id)) {
      reactionMap.set(r.post_id, { amen: 0, pray: 0, gratitude: 0 });
    }
    reactionMap.get(r.post_id)[r.reaction_type] = r.cnt;
  }

  const commentCountMap = new Map(commentsCountRes.rows.map((c) => [c.post_id, c.cnt]));
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
    scope_unit: r.scope_unit_id
      ? {
          id: r.scope_unit_id,
          name: r.scope_unit_name,
          unit_type: r.scope_unit_type,
          country_code: r.scope_unit_country_code,
          accent_color: r.scope_unit_accent_color,
          lineage: lineages.get(r.scope_unit_id) || [],
        }
      : null,
    author: serializeUserSummary(
      {
        id: r.author_id,
        username: r.author_username,
        full_name: r.author_full_name,
        title_prefix: r.author_title_prefix,
        ecclesiastical_rank: r.author_rank,
        religious_order_initials: r.author_order_initials,
        primary_unit_id: r.author_primary_unit_id,
        current_office_title: r.author_office_title,
        avatar_color: r.author_avatar_color,
        avatar_url: r.author_avatar_url,
        verification_status: r.author_verification_status,
        country_code: r.author_country_code,
        is_ceo: r.author_is_ceo,
      },
      lineages.get(r.author_primary_unit_id) || []
    ),
    reactions: reactionMap.get(r.id) || { amen: 0, pray: 0, gratitude: 0 },
    my_reactions: viewerMap.get(r.id) || [],
    comments_count: commentCountMap.get(r.id) || 0,
  }));
}

const POST_SELECT = `
  SELECT p.*,
         u.username AS author_username,
         u.full_name AS author_full_name,
         u.title_prefix AS author_title_prefix,
         u.ecclesiastical_rank AS author_rank,
         u.religious_order_initials AS author_order_initials,
         u.primary_unit_id AS author_primary_unit_id,
         u.current_office_title AS author_office_title,
         u.avatar_color AS author_avatar_color,
         u.avatar_url AS author_avatar_url,
         u.verification_status AS author_verification_status,
         u.country_code AS author_country_code,
         u.is_ceo AS author_is_ceo,
         eu.name AS scope_unit_name,
         eu.unit_type AS scope_unit_type,
         eu.country_code AS scope_unit_country_code,
         eu.accent_color AS scope_unit_accent_color
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN ecclesiastical_units eu ON eu.id = p.scope_unit_id
`;

// Hierarchical Visual Feed
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      scope = 'global',
      unit_id,
      author_id,
      post_type,
      media_kind,
      q,
      limit = 40,
      offset = 0,
    } = req.query;

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

    let resolvedScopeUnit = null;

    if (scope === 'saved' && req.user) {
      params.push(req.user.id);
      clauses.push(`p.id IN (SELECT post_id FROM saved_posts WHERE user_id = $${params.length})`);
    } else if (scope === 'following' && req.user) {
      params.push(req.user.id);
      const idx = params.length;
      clauses.push(
        `(p.author_id IN (SELECT target_user_id FROM follows WHERE follower_id = $${idx} AND target_user_id IS NOT NULL)
          OR p.scope_unit_id IN (SELECT target_unit_id FROM follows WHERE follower_id = $${idx} AND target_unit_id IS NOT NULL))`
      );
    } else if (scope === 'unit' && unit_id) {
      const uid = Number(unit_id);
      const descendants = await getDescendantUnitIds(uid);
      const ancestors = (await getUnitLineage(uid)).map((u) => u.id);
      const relevantIds = [...new Set([...descendants, ...ancestors])];
      if (relevantIds.length > 0) {
        params.push(relevantIds);
        clauses.push(`p.scope_unit_id = ANY($${params.length}::int[])`);
      }
    } else if (
      ['my_country', 'my_archdiocese', 'my_diocese', 'my_parish'].includes(String(scope)) &&
      req.user &&
      req.user.primary_unit_id
    ) {
      const lineage = await getUnitLineage(req.user.primary_unit_id);
      const targetTypesByScope = {
        my_country: ['episcopal_conference'],
        my_archdiocese: ['archdiocese'],
        my_diocese: ['diocese', 'archdiocese'],
        my_parish: ['parish', 'seminary', 'religious_order'],
      };
      const wantedTypes = targetTypesByScope[scope] || [];
      const match = [...lineage].reverse().find((u) => wantedTypes.includes(u.unit_type));
      if (match) {
        resolvedScopeUnit = match;
        const descendants = await getDescendantUnitIds(match.id);
        params.push(descendants);
        clauses.push(`p.scope_unit_id = ANY($${params.length}::int[])`);
      } else {
        const descendants = await getDescendantUnitIds(req.user.primary_unit_id);
        params.push(descendants);
        clauses.push(`p.scope_unit_id = ANY($${params.length}::int[])`);
      }
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 40, 100));
    const limitIdx = params.length;
    params.push(Math.max(Number(offset) || 0, 0));
    const offsetIdx = params.length;

    const { rows } = await pool.query(
      `${POST_SELECT}
        ${whereSql}
        ORDER BY p.is_pinned DESC, p.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const posts = await hydratePosts(rows, req.user ? req.user.id : null);
    return res.json({ posts, resolved_scope_unit: resolvedScopeUnit });
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
    const safeMediaKind = ytId ? 'video' : (['article', 'video', 'photo'].includes(media_kind) ? media_kind : 'article');
    const resolvedImage = String(image_url).trim() || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '');
    const targetUnitId = scope_unit_id ? Number(scope_unit_id) : req.user.primary_unit_id;
    const { rows } = await pool.query(
      `INSERT INTO posts (
         author_id, scope_unit_id, post_type, title, content,
         image_url, visual_theme, media_kind, youtube_id, video_duration, channel_name,
         scripture_ref, event_date, event_location, language
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        req.user.id,
        targetUnitId || null,
        post_type,
        String(title).trim().slice(0, 200),
        String(content).trim().slice(0, 8000),
        resolvedImage.slice(0, 1000),
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
        `INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES ($1,$2,$3)`,
        [postId, req.user.id, reaction_type]
      );
      active = true;
    }

    const countsRes = await pool.query(
      `SELECT reaction_type, COUNT(*)::int AS cnt FROM post_reactions WHERE post_id = $1 GROUP BY reaction_type`,
      [postId]
    );
    const counts = { amen: 0, pray: 0, gratitude: 0 };
    for (const r of countsRes.rows) counts[r.reaction_type] = r.cnt;

    return res.json({ active, reactions: counts });
  } catch (err) {
    console.error('[posts/react]', err);
    return res.status(500).json({ error: 'Failed to toggle reaction' });
  }
});

router.get('/:id/comments', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT c.id, c.post_id, c.content, c.created_at,
              u.id AS author_id, u.username, u.full_name, u.title_prefix,
              u.ecclesiastical_rank, u.religious_order_initials,
              u.primary_unit_id, u.current_office_title, u.avatar_color, u.avatar_url,
              u.verification_status, u.country_code
         FROM post_comments c
         JOIN users u ON u.id = c.author_id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC`,
      [postId]
    );

    const lineages = await getUnitLineagesMap(rows.map((r) => r.primary_unit_id));
    const comments = rows.map((r) => ({
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
          primary_unit_id: r.primary_unit_id,
          current_office_title: r.current_office_title,
          avatar_color: r.avatar_color,
          avatar_url: r.avatar_url,
          verification_status: r.verification_status,
          country_code: r.country_code,
        },
        lineages.get(r.primary_unit_id) || []
      ),
    }));

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

    const lineage = await getUnitLineage(req.user.primary_unit_id);
    return res.status(201).json({
      comment: {
        ...rows[0],
        author: serializeUserSummary(req.user, lineage),
      },
    });
  } catch (err) {
    console.error('[posts/comments/create]', err);
    return res.status(500).json({ error: 'Failed to post comment' });
  }
});

module.exports = router;
