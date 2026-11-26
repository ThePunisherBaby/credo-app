const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { isClergyRank } = require('../config');
const { decryptCedula, formatCedula } = require('../services/cedulaVerifier');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

const RANK_LABELS_ES = {
  pope: 'Papa',
  cardinal: 'Cardenal',
  archbishop: 'Arzobispo',
  bishop: 'Obispo',
  monsignor: 'Monseñor',
  priest: 'Sacerdote / Presbítero',
  deacon: 'Diácono',
  religious: 'Religioso(a) / Monja',
  seminarian: 'Seminarista',
  church: 'Parroquia / Iglesia',
  parish: 'Parroquia',
  catechist: 'Catequista',
  lay: 'Fiel Laico',
};

const DEFAULT_COLOR_BY_RANK = {
  cardinal: '#9B1C2E',
  archbishop: '#6B2D5C',
  bishop: '#5B2C6F',
  monsignor: '#8E3A59',
  priest: '#0F1E36',
  deacon: '#355070',
  church: '#0A84FF',
  parish: '#0A84FF',
  religious: '#5C4033',
  seminarian: '#4A5568',
  catechist: '#2F6F6D',
  lay: '#007AFF',
};

function requirePanelApiKey(req, res, next) {
  const expected = String(process.env.API_KEY || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'API_KEY no configurada en el contenedor de Credo.' });
  }
  const auth = String(req.headers.authorization || '');
  const provided = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : String(req.headers['x-api-key'] || '').trim();

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  next();
}

router.use(requirePanelApiKey);

// GET /api/v1/panel-admin/overview — Complete Credo Insights + Pending Requests + Faithful Directory for voxon.cloud/diosesmiguia
router.get('/overview', async (_req, res) => {
  try {
    const [
      statsRes,
      subRes,
      mediaRes,
      reqRes,
      usersRes,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(account_status, 'active') = 'active')::int AS total_users,
          COUNT(*) FILTER (WHERE cedula_verified = TRUE)::int AS verified_cedula_users,
          COUNT(*) FILTER (WHERE ecclesiastical_rank IN ('priest','deacon','bishop','archbishop','monsignor','cardinal','religious','seminarian','church','parish') AND COALESCE(account_status, 'active') = 'active')::int AS clergy_users,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_users_7d,
          (SELECT COUNT(*)::int FROM registration_requests WHERE status = 'pending') AS pending_requests,
          (SELECT COUNT(*)::int FROM posts) AS total_posts,
          (SELECT COUNT(*)::int FROM post_comments) AS total_comments,
          (SELECT COUNT(*)::int FROM post_reactions) AS total_reactions,
          (SELECT COUNT(*)::int FROM prayer_intentions) AS total_prayers
        FROM users
      `),
      pool
        .query(`
          SELECT
            (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS active_subscriptions,
            (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM billing_transactions WHERE status = 'succeeded') AS revenue_cents
        `)
        .catch(() => ({ rows: [{ active_subscriptions: 0, revenue_cents: 0 }] })),
      pool
        .query(`
          SELECT COUNT(*)::int AS media_objects_count, COALESCE(SUM(size_bytes), 0)::bigint AS media_bytes
            FROM media_objects
           WHERE status = 'ready'
        `)
        .catch(() => ({ rows: [{ media_objects_count: 0, media_bytes: 0 }] })),
      pool.query(`
        SELECT id, request_kind, full_name, username, email, phone, ecclesiastical_rank,
               title_prefix, current_office_title, bio, country_code,
               cedula_encrypted, cedula_masked, cedula_official_name, cedula_name_matched,
               status, review_note, approved_user_id, ip_address, reviewed_at, created_at
          FROM registration_requests
         ORDER BY
           CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
           created_at DESC
         LIMIT 200
      `),
      pool.query(`
        SELECT id, username, full_name, title_prefix, email, phone, ecclesiastical_rank,
               current_office_title, verification_status, is_ceo, is_cto, is_admin,
               active_plan_sku, cedula_encrypted, cedula_masked, cedula_official_name,
               cedula_verified, COALESCE(account_status, 'active') AS account_status,
               posts_count, followers_count, created_at
          FROM users
         ORDER BY created_at DESC
         LIMIT 250
      `),
    ]);

    const s = statsRes.rows[0] || {};
    const sub = subRes.rows[0] || {};
    const med = mediaRes.rows[0] || {};

    const requests = reqRes.rows.map((r) => {
      const rawCed = decryptCedula(r.cedula_encrypted);
      return {
        id: r.id,
        request_kind: r.request_kind,
        full_name: r.full_name,
        username: r.username,
        email: r.email,
        phone: r.phone || '',
        ecclesiastical_rank: r.ecclesiastical_rank,
        rank_label: RANK_LABELS_ES[r.ecclesiastical_rank] || r.ecclesiastical_rank,
        title_prefix: r.title_prefix || '',
        current_office_title: r.current_office_title || '',
        bio: r.bio || '',
        country_code: r.country_code || 'DO',
        cedula: rawCed ? formatCedula(rawCed) : r.cedula_masked || '',
        cedula_masked: r.cedula_masked || '',
        cedula_official_name: r.cedula_official_name || '',
        cedula_name_matched: Boolean(r.cedula_name_matched),
        status: r.status,
        review_note: r.review_note || '',
        approved_user_id: r.approved_user_id,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
      };
    });

    const users = usersRes.rows.map((u) => {
      const rawCed = decryptCedula(u.cedula_encrypted);
      return {
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        title_prefix: u.title_prefix || '',
        email: u.email,
        phone: u.phone || '',
        ecclesiastical_rank: u.ecclesiastical_rank,
        rank_label: u.is_ceo
          ? 'CEO · Presbítero'
          : u.is_cto
            ? 'CTO · Arquitectura'
            : RANK_LABELS_ES[u.ecclesiastical_rank] || u.ecclesiastical_rank,
        current_office_title: u.current_office_title || '',
        verification_status: u.verification_status,
        is_ceo: Boolean(u.is_ceo),
        is_cto: Boolean(u.is_cto),
        active_plan_sku: u.active_plan_sku || '',
        cedula: rawCed ? formatCedula(rawCed) : u.cedula_masked || '',
        cedula_official_name: u.cedula_official_name || '',
        cedula_verified: Boolean(u.cedula_verified),
        account_status: u.account_status || 'active',
        posts_count: Number(u.posts_count || 0),
        followers_count: Number(u.followers_count || 0),
        created_at: u.created_at,
      };
    });

    return res.json({
      insights: {
        total_users: Number(s.total_users || 0),
        verified_cedula_users: Number(s.verified_cedula_users || 0),
        clergy_users: Number(s.clergy_users || 0),
        new_users_7d: Number(s.new_users_7d || 0),
        pending_requests: Number(s.pending_requests || 0),
        total_posts: Number(s.total_posts || 0),
        total_comments: Number(s.total_comments || 0),
        total_reactions: Number(s.total_reactions || 0),
        total_prayers: Number(s.total_prayers || 0),
        active_subscriptions: Number(sub.active_subscriptions || 0),
        revenue_usd: Number((Number(sub.revenue_cents || 0) / 100).toFixed(2)),
        media_objects_count: Number(med.media_objects_count || 0),
        media_bytes: Number(med.media_bytes || 0),
      },
      requests,
      users,
    });
  } catch (err) {
    console.error('[panel-admin/overview]', err);
    return res.status(500).json({ error: 'No se pudo cargar el resumen de Credo.' });
  }
});

// POST /api/v1/panel-admin/requests/:id/approve — Confirm & activate a pending clergy/faithful registration request
router.post('/requests/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const reqId = Number(req.params.id);
    if (!Number.isInteger(reqId)) {
      return res.status(400).json({ error: 'ID de solicitud inválido.' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM registration_requests WHERE id = $1 FOR UPDATE`,
      [reqId]
    );
    const r = rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    if (r.status === 'approved' && r.approved_user_id) {
      await client.query('COMMIT');
      return res.json({ ok: true, user_id: r.approved_user_id });
    }

    // Ensure unique username if taken in the meantime
    let candidateUsername = (r.username || r.email.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 24) || `fiel_${reqId}`;
    const uCheck = await client.query(`SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1`, [candidateUsername]);
    if (uCheck.rows.length > 0) {
      candidateUsername = `${candidateUsername}_${reqId}`;
    }

    const avatarColor = DEFAULT_COLOR_BY_RANK[r.ecclesiastical_rank] || '#0F1E36';
    const isClergyOrConsecrated =
      isClergyRank(r.ecclesiastical_rank) || ['religious', 'seminarian'].includes(r.ecclesiastical_rank);

    const ins = await client.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, current_office_title, bio, country_code,
         languages, preferred_locale, avatar_color, verification_status,
         verification_note, phone, cedula_hash, cedula_encrypted,
         cedula_masked, cedula_official_name, cedula_verified, account_status
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         ARRAY[$10], $10, $11, $12,
         'Confirmado desde Panel VOXON', $13, $14, $15,
         $16, $17, TRUE, 'active'
       )
       ON CONFLICT (email) DO UPDATE SET
         ecclesiastical_rank = EXCLUDED.ecclesiastical_rank,
         title_prefix = EXCLUDED.title_prefix,
         current_office_title = EXCLUDED.current_office_title,
         verification_status = 'verified',
         cedula_verified = TRUE,
         account_status = 'active',
         updated_at = NOW()
       RETURNING id`,
      [
        r.email.toLowerCase(),
        r.password_hash,
        candidateUsername,
        r.full_name,
        r.title_prefix || '',
        r.ecclesiastical_rank,
        r.current_office_title || '',
        r.bio || '',
        r.country_code || 'DO',
        r.preferred_locale || 'es',
        avatarColor,
        isClergyOrConsecrated ? 'verified' : 'verified',
        r.phone || '',
        r.cedula_hash,
        r.cedula_encrypted,
        r.cedula_masked,
        r.cedula_official_name || '',
      ]
    );

    const userId = ins.rows[0].id;
    await client.query(
      `UPDATE registration_requests
          SET status = 'approved',
              approved_user_id = $2,
              review_note = $3,
              reviewed_at = NOW()
        WHERE id = $1`,
      [reqId, userId, String(req.body?.note || 'Aprobado en panel').slice(0, 240)]
    );

    await client.query('COMMIT');
    apiCache.invalidate('users:');
    apiCache.invalidate('stats:');
    return res.json({ ok: true, user_id: userId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[panel-admin/approve]', err);
    return res.status(500).json({ error: err.message || 'No se pudo confirmar la solicitud.' });
  } finally {
    client.release();
  }
});

// POST /api/v1/panel-admin/requests/:id/reject — Reject a pending registration request
router.post('/requests/:id/reject', async (req, res) => {
  try {
    const reqId = Number(req.params.id);
    if (!Number.isInteger(reqId)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const note = String(req.body?.note || 'Rechazado desde el panel').trim().slice(0, 240);
    const { rowCount } = await pool.query(
      `UPDATE registration_requests
          SET status = 'rejected',
              review_note = $2,
              reviewed_at = NOW()
        WHERE id = $1`,
      [reqId, note]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[panel-admin/reject]', err);
    return res.status(500).json({ error: 'No se pudo rechazar la solicitud.' });
  }
});

// POST /api/v1/panel-admin/users/:id/status — Confirm/Activate or Reject/Suspend an existing registered user
router.post('/users/:id/status', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const nextStatus = String(req.body?.status || '').trim();
    if (!Number.isInteger(userId) || !['active', 'suspended'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Parámetros inválidos.' });
    }

    const { rows } = await pool.query(`SELECT id, is_ceo, is_cto FROM users WHERE id = $1 LIMIT 1`, [userId]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    if ((rows[0].is_ceo || rows[0].is_cto) && nextStatus === 'suspended') {
      return res.status(400).json({ error: 'Las cuentas ejecutivas CEO y CTO no pueden suspenderse.' });
    }

    await pool.query(
      `UPDATE users
          SET account_status = $2,
              verification_status = CASE WHEN $2 = 'active' THEN 'verified' ELSE verification_status END,
              updated_at = NOW()
        WHERE id = $1`,
      [userId, nextStatus]
    );
    apiCache.invalidate('users:');
    apiCache.invalidate('posts:');
    return res.json({ ok: true, account_status: nextStatus });
  } catch (err) {
    console.error('[panel-admin/user-status]', err);
    return res.status(500).json({ error: 'No se pudo actualizar el estado del usuario.' });
  }
});

module.exports = router;
