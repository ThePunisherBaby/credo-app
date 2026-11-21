const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getUnitLineagesMap, serializeUserSummary } = require('../utils/hierarchy');

const router = express.Router();

// List authenticated user's conversations (direct + joined pastoral groups)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.kind, c.title, c.description, c.unit_id, c.created_at,
              eu.name AS unit_name, eu.unit_type AS unit_type, eu.accent_color AS unit_accent_color,
              (SELECT COUNT(*)::int FROM conversation_members cm2 WHERE cm2.conversation_id = c.id) AS members_count,
              lm.content AS last_message_content,
              lm.created_at AS last_message_at,
              lm.sender_name AS last_sender_name
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
         LEFT JOIN ecclesiastical_units eu ON eu.id = c.unit_id
         LEFT JOIN LATERAL (
           SELECT m.content, m.created_at, u.full_name AS sender_name
             FROM messages m
             JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
         ) lm ON TRUE
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.user.id]
    );

    // For direct chats, resolve the peer user info
    const directIds = rows.filter((r) => r.kind === 'direct').map((r) => r.id);
    const peerMap = new Map();
    if (directIds.length > 0) {
      const peersRes = await pool.query(
        `SELECT cm.conversation_id, u.*
           FROM conversation_members cm
           JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = ANY($1::int[]) AND cm.user_id <> $2`,
        [directIds, req.user.id]
      );
      const lineages = await getUnitLineagesMap(peersRes.rows.map((p) => p.primary_unit_id));
      for (const p of peersRes.rows) {
        peerMap.set(
          p.conversation_id,
          serializeUserSummary(p, lineages.get(p.primary_unit_id) || [])
        );
      }
    }

    const conversations = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.kind === 'direct' && peerMap.has(r.id) ? peerMap.get(r.id).full_name : r.title,
      description: r.description || '',
      unit_id: r.unit_id,
      unit_name: r.unit_name || null,
      unit_type: r.unit_type || null,
      unit_accent_color: r.unit_accent_color || '#6B2D5C',
      members_count: r.members_count,
      peer: peerMap.get(r.id) || null,
      last_message_content: r.last_message_content || '',
      last_message_at: r.last_message_at || r.created_at,
      last_sender_name: r.last_sender_name || '',
    }));

    return res.json({ conversations });
  } catch (err) {
    console.error('[conversations/list]', err);
    return res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// Discover public pastoral groups by ecclesiastical unit
router.get('/discover', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    const params = [req.user.id];
    let searchSql = '';
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      searchSql = `AND (c.title ILIKE $2 OR c.description ILIKE $2 OR eu.name ILIKE $2)`;
    }

    const { rows } = await pool.query(
      `SELECT c.id, c.kind, c.title, c.description, c.unit_id,
              eu.name AS unit_name, eu.unit_type, eu.country_code, eu.accent_color AS unit_accent_color,
              (SELECT COUNT(*)::int FROM conversation_members cm WHERE cm.conversation_id = c.id) AS members_count,
              EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = $1) AS is_member
         FROM conversations c
         LEFT JOIN ecclesiastical_units eu ON eu.id = c.unit_id
        WHERE c.kind = 'pastoral_group' ${searchSql}
        ORDER BY members_count DESC, c.title ASC
        LIMIT 60`,
      params
    );

    return res.json({ groups: rows });
  } catch (err) {
    console.error('[conversations/discover]', err);
    return res.status(500).json({ error: 'Failed to discover groups' });
  }
});

// Start or get existing 1-to-1 direct conversation
router.post('/direct', requireAuth, async (req, res) => {
  try {
    const targetUserId = Number(req.body?.target_user_id);
    if (!Number.isInteger(targetUserId) || targetUserId === req.user.id) {
      return res.status(400).json({ error: 'Valid target_user_id is required' });
    }

    const existing = await pool.query(
      `SELECT c.id
         FROM conversations c
         JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
         JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
        WHERE c.kind = 'direct'
        LIMIT 1`,
      [req.user.id, targetUserId]
    );

    if (existing.rows.length > 0) {
      return res.json({ conversation_id: existing.rows[0].id });
    }

    const created = await pool.query(
      `INSERT INTO conversations (kind, title, created_by) VALUES ('direct', '', $1) RETURNING id`,
      [req.user.id]
    );
    const cid = created.rows[0].id;
    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`,
      [cid, req.user.id, targetUserId]
    );

    return res.status(201).json({ conversation_id: cid });
  } catch (err) {
    console.error('[conversations/direct]', err);
    return res.status(500).json({ error: 'Failed to start direct chat' });
  }
});

// Create a pastoral group linked to an ecclesiastical unit
router.post('/groups', requireAuth, async (req, res) => {
  try {
    const { title, description = '', unit_id } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const created = await pool.query(
      `INSERT INTO conversations (kind, title, description, unit_id, created_by)
       VALUES ('pastoral_group', $1, $2, $3, $4) RETURNING *`,
      [
        String(title).trim().slice(0, 120),
        String(description).trim().slice(0, 400),
        unit_id ? Number(unit_id) : req.user.primary_unit_id,
        req.user.id,
      ]
    );

    const cid = created.rows[0].id;
    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'moderator')`,
      [cid, req.user.id]
    );

    return res.status(201).json({ conversation: created.rows[0] });
  } catch (err) {
    console.error('[conversations/groups/create]', err);
    return res.status(500).json({ error: 'Failed to create pastoral group' });
  }
});

// Join a pastoral group
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const cid = Number(req.params.id);
    const conv = await pool.query(`SELECT id, kind FROM conversations WHERE id = $1`, [cid]);
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.rows[0].kind !== 'pastoral_group') {
      return res.status(403).json({ error: 'Cannot join a private direct chat' });
    }

    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [cid, req.user.id]
    );
    return res.json({ joined: true, conversation_id: cid });
  } catch (err) {
    console.error('[conversations/join]', err);
    return res.status(500).json({ error: 'Failed to join group' });
  }
});

// Get messages inside a conversation
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const cid = Number(req.params.id);
    const memberCheck = await pool.query(
      `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [cid, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      // Allow auto-join if it's a public pastoral group
      const conv = await pool.query(`SELECT kind FROM conversations WHERE id = $1`, [cid]);
      if (conv.rows[0]?.kind === 'pastoral_group') {
        await pool.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
          [cid, req.user.id]
        );
      } else {
        return res.status(403).json({ error: 'Not a member of this conversation' });
      }
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.conversation_id, m.content, m.created_at,
              u.id AS sender_id, u.username, u.full_name, u.title_prefix,
              u.ecclesiastical_rank, u.religious_order_initials,
              u.primary_unit_id, u.current_office_title, u.avatar_color,
              u.verification_status, u.country_code
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC
        LIMIT 200`,
      [cid]
    );

    const messages = rows.map((r) => ({
      id: r.id,
      conversation_id: r.conversation_id,
      content: r.content,
      created_at: r.created_at,
      sender: serializeUserSummary({
        id: r.sender_id,
        username: r.username,
        full_name: r.full_name,
        title_prefix: r.title_prefix,
        ecclesiastical_rank: r.ecclesiastical_rank,
        religious_order_initials: r.religious_order_initials,
        primary_unit_id: r.primary_unit_id,
        current_office_title: r.current_office_title,
        avatar_color: r.avatar_color,
        verification_status: r.verification_status,
        country_code: r.country_code,
      }),
    }));

    return res.json({ messages });
  } catch (err) {
    console.error('[conversations/messages/list]', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

// Send a message
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const cid = Number(req.params.id);
    const { content } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const memberCheck = await pool.query(
      `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [cid, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Join this conversation first' });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING id, conversation_id, content, created_at`,
      [cid, req.user.id, String(content).trim().slice(0, 4000)]
    );

    return res.status(201).json({
      message: {
        ...rows[0],
        sender: serializeUserSummary(req.user),
      },
    });
  } catch (err) {
    console.error('[conversations/messages/send]', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
