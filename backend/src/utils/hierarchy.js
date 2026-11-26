const { pool } = require('../db/pool');
const { isClergyRank } = require('../config');

/**
 * Returns the full ancestry chain from root (Santa Sede) down to the given unitId.
 */
async function getUnitLineage(unitId) {
  if (!unitId) return [];
  const { rows } = await pool.query(
    `WITH RECURSIVE lineage AS (
       SELECT id, slug, name, official_latin_name, unit_type, parent_id,
              country_code, country_name, city, accent_color, 0 AS depth
         FROM ecclesiastical_units
        WHERE id = $1
       UNION ALL
       SELECT u.id, u.slug, u.name, u.official_latin_name, u.unit_type, u.parent_id,
              u.country_code, u.country_name, u.city, u.accent_color, l.depth + 1
         FROM ecclesiastical_units u
         JOIN lineage l ON u.id = l.parent_id
        WHERE l.depth < 12
     )
     SELECT id, slug, name, official_latin_name, unit_type, parent_id,
            country_code, country_name, city, accent_color
       FROM lineage
      ORDER BY depth DESC`,
    [unitId]
  );
  return rows;
}

/**
 * Batch load lineage for multiple unit IDs in a single recursive query.
 */
async function getUnitLineagesMap(unitIds) {
  const uniqueIds = [...new Set(unitIds.filter(Boolean))];
  const map = new Map();
  if (uniqueIds.length === 0) return map;

  const { rows } = await pool.query(
    `WITH RECURSIVE lineage AS (
       SELECT id AS leaf_id, id, slug, name, unit_type, parent_id,
              country_code, country_name, city, accent_color, 0 AS depth
         FROM ecclesiastical_units
        WHERE id = ANY($1::int[])
       UNION ALL
       SELECT l.leaf_id, u.id, u.slug, u.name, u.unit_type, u.parent_id,
              u.country_code, u.country_name, u.city, u.accent_color, l.depth + 1
         FROM ecclesiastical_units u
         JOIN lineage l ON u.id = l.parent_id
        WHERE l.depth < 12
     )
     SELECT leaf_id, id, slug, name, unit_type, parent_id,
            country_code, country_name, city, accent_color, depth
       FROM lineage
      ORDER BY leaf_id, depth DESC`,
    [uniqueIds]
  );

  for (const row of rows) {
    if (!map.has(row.leaf_id)) map.set(row.leaf_id, []);
    map.get(row.leaf_id).push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      unit_type: row.unit_type,
      parent_id: row.parent_id,
      country_code: row.country_code,
      country_name: row.country_name,
      city: row.city,
      accent_color: row.accent_color,
    });
  }
  return map;
}

/**
 * Returns all descendant unit IDs (including unitId itself).
 */
async function getDescendantUnitIds(unitId) {
  if (!unitId) return [];
  const { rows } = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, 0 AS depth FROM ecclesiastical_units WHERE id = $1
       UNION ALL
       SELECT u.id, t.depth + 1
         FROM ecclesiastical_units u
         JOIN tree t ON u.parent_id = t.id
        WHERE t.depth < 12
     )
     SELECT id FROM tree`,
    [unitId]
  );
  return rows.map((r) => r.id);
}

const fsharpKernel = require('../services/fsharpKernel');

function serializeUserSummary(u, lineage = [], orderUnit = null) {
  const isCto = Boolean(u.is_cto || String(u.username || '').toLowerCase() === 'paulinosstudios');
  const effectiveSku = u.active_plan_sku || (u.is_ceo ? 'biz_one_enterprise' : '');
  const planSpec = effectiveSku ? fsharpKernel.getPlanSpec(effectiveSku) : null;
  const effectiveBadge = u.one_badge || planSpec?.badge_type || (u.is_ceo ? 'enterprise_gold' : '');
  const effectivePlanName = planSpec?.display_name || '';

  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    title_prefix: u.title_prefix || '',
    ecclesiastical_rank: u.ecclesiastical_rank,
    can_publish:
      (isClergyRank(u.ecclesiastical_rank) && u.verification_status === 'verified') ||
      Boolean(u.is_ceo || isCto) ||
      ['user_one_pro', 'biz_one_plus', 'biz_one_pro', 'biz_one_enterprise'].includes(effectiveSku),
    religious_order_initials: u.religious_order_initials || '',
    primary_unit_id: u.primary_unit_id,
    religious_order_id: u.religious_order_id,
    current_office_title: u.current_office_title || '',
    bio: u.bio || '',
    motto: u.motto || '',
    ordination_date: u.ordination_date || null,
    country_code: u.country_code || '',
    languages: u.languages || ['es'],
    preferred_locale: u.preferred_locale || 'es',
    avatar_color: u.avatar_color || '#7A1C2E',
    avatar_url: u.avatar_url || '',
    verification_status: u.verification_status || 'unverified',
    is_admin: Boolean(u.is_admin),
    is_ceo: Boolean(u.is_ceo),
    is_cto: isCto,
    website_links: Array.isArray(u.website_links) ? u.website_links : [],
    is_credo_plus: Boolean(u.is_credo_plus || effectiveSku),
    credo_plus_plan: effectiveSku || u.credo_plus_plan || '',
    active_plan_sku: effectiveSku,
    active_plan_name: effectivePlanName,
    ad_free: Boolean(u.ad_free || planSpec?.ad_free || isCto),
    studio_eligible: Boolean(u.studio_eligible || planSpec?.studio_access || u.is_ceo || isCto || u.is_admin),
    one_badge: effectiveBadge,
    lineage,
    religious_order: orderUnit,
    created_at: u.created_at,
  };
}

module.exports = {
  getUnitLineage,
  getUnitLineagesMap,
  getDescendantUnitIds,
  serializeUserSummary,
};
