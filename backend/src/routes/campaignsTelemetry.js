const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { optionalAuth } = require('../middleware/auth');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

function resolveSessionKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const raw =
    String(req.body?.session_key || req.headers['x-credo-device'] || '').trim() ||
    `${req.ip || 'anon'}:${String(req.headers['user-agent'] || '').slice(0, 60)}`;
  return `s:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function currentHourBucket() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.toISOString();
}

// POST /api/campaigns/:id/impression — Session-deduplicated impression counter + auto-pause at 100% quota
router.post('/:id/impression', optionalAuth, async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }

    const sessionKey = resolveSessionKey(req);
    const bucket = currentHourBucket();

    const dedup = await pool.query(
      `INSERT INTO campaign_events_dedup (campaign_id, session_key, event_type, bucket_hour)
       VALUES ($1,$2,'impression',$3)
       ON CONFLICT (campaign_id, session_key, event_type, bucket_hour) DO NOTHING
       RETURNING id`,
      [campaignId, sessionKey, bucket]
    );

    if (dedup.rows.length === 0) {
      return res.json({ counted: false, deduplicated: true });
    }

    const upd = await pool.query(
      `UPDATE campaigns
          SET impressions_served = impressions_served + 1,
              unique_reach = unique_reach + 1,
              status = CASE WHEN impressions_served + 1 >= impressions_allocated THEN 'completed' ELSE status END,
              updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING id, organization_id, impressions_served, impressions_allocated, status`,
      [campaignId]
    );

    if (!upd.rows[0]) {
      return res.json({ counted: false, inactive: true });
    }

    const camp = upd.rows[0];
    await Promise.all([
      pool.query(
        `INSERT INTO campaign_metrics_daily (
           campaign_id, organization_id, metric_date, boosted_impressions, unique_viewers
         ) VALUES ($1,$2,CURRENT_DATE,1,1)
         ON CONFLICT (campaign_id, metric_date) DO UPDATE SET
           boosted_impressions = campaign_metrics_daily.boosted_impressions + 1,
           unique_viewers = campaign_metrics_daily.unique_viewers + 1`,
        [camp.id, camp.organization_id]
      ),
      pool.query(
        `UPDATE subscriptions
            SET impressions_used = LEAST(impressions_quota, impressions_used + 1),
                updated_at = NOW()
          WHERE organization_id = $1 AND status = 'active'`,
        [camp.organization_id]
      ),
    ]);

    if (camp.status === 'completed') {
      apiCache.invalidatePrefix('posts:');
    }

    return res.json({
      counted: true,
      impressions_served: camp.impressions_served,
      impressions_allocated: camp.impressions_allocated,
      status: camp.status,
    });
  } catch (err) {
    console.error('[campaigns/impression]', err);
    return res.status(500).json({ error: 'Telemetry error' });
  }
});

// POST /api/campaigns/:id/click — Session-deduplicated CTA click tracking
router.post('/:id/click', optionalAuth, async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }

    const sessionKey = resolveSessionKey(req);
    const bucket = currentHourBucket();

    const dedup = await pool.query(
      `INSERT INTO campaign_events_dedup (campaign_id, session_key, event_type, bucket_hour)
       VALUES ($1,$2,'click',$3)
       ON CONFLICT (campaign_id, session_key, event_type, bucket_hour) DO NOTHING
       RETURNING id`,
      [campaignId, sessionKey, bucket]
    );

    if (dedup.rows.length === 0) {
      return res.json({ counted: false, deduplicated: true });
    }

    const upd = await pool.query(
      `UPDATE campaigns
          SET clicks_count = clicks_count + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING id, organization_id, clicks_count`,
      [campaignId]
    );

    if (upd.rows[0]) {
      const camp = upd.rows[0];
      await pool.query(
        `INSERT INTO campaign_metrics_daily (campaign_id, organization_id, metric_date, clicks)
         VALUES ($1,$2,CURRENT_DATE,1)
         ON CONFLICT (campaign_id, metric_date) DO UPDATE SET
           clicks = campaign_metrics_daily.clicks + 1`,
        [camp.id, camp.organization_id]
      );
    }

    return res.json({ counted: true, clicks_count: upd.rows[0]?.clicks_count || 0 });
  } catch (err) {
    console.error('[campaigns/click]', err);
    return res.status(500).json({ error: 'Click telemetry error' });
  }
});

// POST /api/campaigns/:id/lead — Native Enterprise In-App Lead Form Submission
router.post('/:id/lead', optionalAuth, async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const { full_name, email = '', phone = '', notes = '' } = req.body || {};
    if (!Number.isInteger(campaignId) || !full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: 'Nombre completo es obligatorio.' });
    }

    const campRes = await pool.query('SELECT id, organization_id FROM campaigns WHERE id = $1', [campaignId]);
    if (!campRes.rows[0]) return res.status(404).json({ error: 'Campaña no encontrada' });

    const { rows } = await pool.query(
      `INSERT INTO campaign_leads (campaign_id, organization_id, user_id, full_name, email, phone, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [
        campaignId,
        campRes.rows[0].organization_id,
        req.user?.id || null,
        String(full_name).trim().slice(0, 120),
        String(email).trim().slice(0, 140),
        String(phone).trim().slice(0, 40),
        String(notes).trim().slice(0, 600),
      ]
    );

    return res.status(201).json({ lead: rows[0] });
  } catch (err) {
    console.error('[campaigns/lead]', err);
    return res.status(500).json({ error: 'No se pudo enviar tu solicitud' });
  }
});

module.exports = router;
