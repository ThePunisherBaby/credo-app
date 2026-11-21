const express = require('express');
const { pool } = require('../db/pool');
const { UNIT_TYPES } = require('../config');
const { optionalAuth, requireAuth, requireClergy } = require('../middleware/auth');
const {
  getUnitLineage,
  getUnitLineagesMap,
  getDescendantUnitIds,
  serializeUserSummary,
} = require('../utils/hierarchy');

const router = express.Router();

// Compact global tree for fast navigation & affiliation pickers
router.get('/tree', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.slug, u.name, u.official_latin_name, u.unit_type, u.parent_id,
              u.country_code, u.country_name, u.city, u.rite, u.patron_saint,
              u.accent_color, u.verified,
              (SELECT COUNT(*)::int FROM ecclesiastical_units c WHERE c.parent_id = u.id) AS children_count,
              (SELECT COUNT(*)::int FROM users m WHERE m.primary_unit_id = u.id OR m.religious_order_id = u.id) AS direct_members_count
         FROM ecclesiastical_units u
        ORDER BY
          CASE u.unit_type
            WHEN 'holy_see' THEN 1
            WHEN 'dicastery' THEN 2
            WHEN 'episcopal_conference' THEN 3
            WHEN 'religious_order' THEN 4
            WHEN 'archdiocese' THEN 5
            WHEN 'diocese' THEN 6
            WHEN 'vicariate' THEN 7
            WHEN 'seminary' THEN 8
            WHEN 'parish' THEN 9
            ELSE 10
          END,
          u.country_name ASC NULLS LAST,
          u.name ASC`
    );
    return res.json({ units: rows });
  } catch (err) {
    console.error('[units/tree]', err);
    return res.status(500).json({ error: 'Failed to load hierarchy tree' });
  }
});

// List/search ecclesiastical units
router.get('/', async (req, res) => {
  try {
    const { parent_id, root_only, unit_type, country_code, q, limit = 60 } = req.query;
    const clauses = [];
    const params = [];

    if (root_only === 'true') {
      clauses.push('u.parent_id IS NULL');
    } else if (parent_id !== undefined && parent_id !== '') {
      params.push(Number(parent_id));
      clauses.push(`u.parent_id = $${params.length}`);
    }

    if (unit_type) {
      params.push(String(unit_type));
      clauses.push(`u.unit_type = $${params.length}`);
    }

    if (country_code) {
      params.push(String(country_code).toUpperCase());
      clauses.push(`UPPER(u.country_code) = $${params.length}`);
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      const idx = params.length;
      clauses.push(
        `(u.name ILIKE $${idx} OR u.official_latin_name ILIKE $${idx} OR u.city ILIKE $${idx} OR u.country_name ILIKE $${idx} OR u.patron_saint ILIKE $${idx})`
      );
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 60, 200));

    const { rows } = await pool.query(
      `SELECT u.*,
              (SELECT COUNT(*)::int FROM ecclesiastical_units c WHERE c.parent_id = u.id) AS children_count,
              (SELECT COUNT(*)::int FROM users m WHERE m.primary_unit_id = u.id OR m.religious_order_id = u.id) AS members_count
         FROM ecclesiastical_units u
        ${whereSql}
        ORDER BY u.name ASC
        LIMIT $${params.length}`,
      params
    );

    const lineages = await getUnitLineagesMap(rows.map((r) => r.id));
    const enriched = rows.map((r) => ({
      ...r,
      lineage: lineages.get(r.id) || [],
    }));

    return res.json({ units: enriched });
  } catch (err) {
    console.error('[units/list]', err);
    return res.status(500).json({ error: 'Failed to query units' });
  }
});

// Unit detail with complete lineage, children, clergy, stats, and pastoral group
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    if (!Number.isInteger(unitId)) {
      return res.status(400).json({ error: 'Invalid unit id' });
    }

    const { rows } = await pool.query('SELECT * FROM ecclesiastical_units WHERE id = $1', [unitId]);
    const unit = rows[0];
    if (!unit) {
      return res.status(404).json({ error: 'Ecclesiastical unit not found' });
    }

    const [lineage, childrenRes, descendantIds, followersRes, pastoralGroupRes] = await Promise.all([
      getUnitLineage(unitId),
      pool.query(
        `SELECT u.*,
                (SELECT COUNT(*)::int FROM ecclesiastical_units c WHERE c.parent_id = u.id) AS children_count,
                (SELECT COUNT(*)::int FROM users m WHERE m.primary_unit_id = u.id OR m.religious_order_id = u.id) AS members_count
           FROM ecclesiastical_units u
          WHERE u.parent_id = $1
          ORDER BY u.unit_type ASC, u.name ASC`,
        [unitId]
      ),
      getDescendantUnitIds(unitId),
      pool.query('SELECT COUNT(*)::int AS cnt FROM follows WHERE target_unit_id = $1', [unitId]),
      pool.query(
        `SELECT id, title, description FROM conversations
          WHERE kind = 'pastoral_group' AND unit_id = $1
          ORDER BY id ASC LIMIT 1`,
        [unitId]
      ),
    ]);

    // Fetch members directly attached to this unit or its descendants (prioritizing direct clergy)
    const membersRes = await pool.query(
      `SELECT DISTINCT u.*
         FROM users u
         LEFT JOIN user_assignments ua ON ua.user_id = u.id AND ua.is_current = TRUE
        WHERE u.primary_unit_id = ANY($1::int[])
           OR u.religious_order_id = $2
           OR ua.unit_id = $2
        ORDER BY
          CASE WHEN u.primary_unit_id = $2 THEN 0 ELSE 1 END,
          CASE u.ecclesiastical_rank
            WHEN 'pope' THEN 1
            WHEN 'cardinal' THEN 2
            WHEN 'archbishop' THEN 3
            WHEN 'bishop' THEN 4
            WHEN 'monsignor' THEN 5
            WHEN 'priest' THEN 6
            WHEN 'deacon' THEN 7
            WHEN 'religious' THEN 8
            WHEN 'seminarian' THEN 9
            WHEN 'catechist' THEN 10
            ELSE 11
          END,
          u.full_name ASC
        LIMIT 80`,
      [descendantIds, unitId]
    );

    const memberLineages = await getUnitLineagesMap(membersRes.rows.map((m) => m.primary_unit_id));
    const members = membersRes.rows.map((m) =>
      serializeUserSummary(m, memberLineages.get(m.primary_unit_id) || [])
    );

    let isFollowing = false;
    if (req.user) {
      const f = await pool.query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND target_unit_id = $2',
        [req.user.id, unitId]
      );
      isFollowing = f.rows.length > 0;
    }

    return res.json({
      unit: {
        ...unit,
        lineage,
        followers_count: followersRes.rows[0].cnt,
        is_following: isFollowing,
        total_descendants_count: Math.max(0, descendantIds.length - 1),
        pastoral_group: pastoralGroupRes.rows[0] || null,
      },
      children: childrenRes.rows,
      members,
    });
  } catch (err) {
    console.error('[units/detail]', err);
    return res.status(500).json({ error: 'Failed to load unit detail' });
  }
});

// Clergy can expand the global hierarchy by adding parishes, dioceses, etc.
router.post('/', requireAuth, requireClergy, async (req, res) => {
  try {
    const {
      name,
      official_latin_name = '',
      unit_type,
      parent_id,
      country_code = '',
      country_name = '',
      city = '',
      rite = 'Latin',
      patron_saint = '',
      motto = '',
      address = '',
      website = '',
      founded_year,
      description = '',
    } = req.body || {};

    if (!name || !unit_type || !UNIT_TYPES.includes(unit_type)) {
      return res.status(400).json({ error: 'Valid name and unit_type are required' });
    }
    if (!parent_id) {
      return res.status(400).json({ error: 'parent_id is required to place unit in hierarchy' });
    }

    const parentRes = await pool.query('SELECT * FROM ecclesiastical_units WHERE id = $1', [
      Number(parent_id),
    ]);
    if (parentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Parent unit not found' });
    }
    const parent = parentRes.rows[0];

    const baseSlug = String(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { rows } = await pool.query(
      `INSERT INTO ecclesiastical_units (
         slug, name, official_latin_name, unit_type, parent_id,
         country_code, country_name, city, rite, patron_saint,
         motto, address, website, founded_year, description,
         accent_color, verified, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,$17)
       RETURNING *`,
      [
        slug,
        String(name).trim(),
        String(official_latin_name).trim(),
        unit_type,
        parent.id,
        (country_code || parent.country_code || 'VA').toUpperCase().slice(0, 4),
        country_name || parent.country_name || '',
        String(city).trim(),
        String(rite || 'Latin').trim(),
        String(patron_saint).trim(),
        String(motto).trim(),
        String(address).trim(),
        String(website).trim(),
        founded_year ? Number(founded_year) : null,
        String(description).trim(),
        parent.accent_color || '#6B2D5C',
        req.user.id,
      ]
    );

    const created = rows[0];

    // Automatically create a pastoral group for the new ecclesiastical unit
    const groupRes = await pool.query(
      `INSERT INTO conversations (kind, title, description, unit_id, created_by)
       VALUES ('pastoral_group', $1, $2, $3, $4) RETURNING id`,
      [
        `Comunidad — ${created.name}`,
        `Canal pastoral oficial de ${created.name}`,
        created.id,
        req.user.id,
      ]
    );
    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'moderator') ON CONFLICT DO NOTHING`,
      [groupRes.rows[0].id, req.user.id]
    );

    const lineage = await getUnitLineage(created.id);
    return res.status(201).json({ unit: { ...created, lineage } });
  } catch (err) {
    console.error('[units/create]', err);
    return res.status(500).json({ error: 'Failed to create ecclesiastical unit' });
  }
});

router.post('/:id/follow', requireAuth, async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    await pool.query(
      `INSERT INTO follows (follower_id, target_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, unitId]
    );
    return res.json({ following: true });
  } catch (err) {
    console.error('[units/follow]', err);
    return res.status(500).json({ error: 'Failed to follow unit' });
  }
});

router.delete('/:id/follow', requireAuth, async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    await pool.query(
      `DELETE FROM follows WHERE follower_id = $1 AND target_unit_id = $2`,
      [req.user.id, unitId]
    );
    return res.json({ following: false });
  } catch (err) {
    console.error('[units/unfollow]', err);
    return res.status(500).json({ error: 'Failed to unfollow unit' });
  }
});

module.exports = router;
