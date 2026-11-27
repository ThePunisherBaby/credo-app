const express = require('express');
const { pool } = require('../db/pool');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { getSetting, getClientIp } = require('../services/systemState');

const router = express.Router();

function isAdEligibleForViewer(ad, user) {
  const level = ad.enforcement_level || 'free_only';
  if (level === 'total_imposition') return true;
  const hasPlan = Boolean(user && user.active_plan_sku);
  if (level === 'free_only') return !hasPlan;
  if (level === 'non_premium') {
    return !Boolean(user && user.ad_free);
  }
  return true;
}

// GET /api/v1/platform-ads/active — Serve active sticky banners, section sponsors, interstitial & explore pinned ads
router.get('/active', optionalAuth, async (req, res) => {
  try {
    if (getSetting('pause_global_ads')?.enabled) {
      return res.json({ ads: [], paused: true });
    }
    const country = String(req.user?.country_code || req.headers['cf-ipcountry'] || 'DO').toUpperCase().slice(0, 4);
    const ua = String(req.headers['user-agent'] || '');
    const platform = /Android|iPhone|iPad|Mobile|CredoAndroid/i.test(ua) ? 'mobile' : 'web';

    const { rows } = await pool.query(
      `SELECT id, title, body, format, media_url, cta_text, cta_url, cta_type,
              enforcement_level, frequency_every_n, target_country, target_platform, priority
         FROM platform_ads
        WHERE is_active = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
          AND (max_impressions = 0 OR impressions_count < max_impressions)
          AND (target_country = 'ALL' OR target_country = $1)
          AND (target_platform = 'all' OR target_platform = $2)
        ORDER BY priority DESC, id DESC
        LIMIT 20`,
      [country, platform]
    );

    const eligible = rows.filter((ad) => isAdEligibleForViewer(ad, req.user));
    return res.json({ ads: eligible, min_mobile_version: getSetting('min_mobile_version') });
  } catch (err) {
    console.error('[platform-ads/active]', err);
    return res.status(500).json({ ads: [] });
  }
});

// POST /api/v1/platform-ads/:id/event — Record real impression or click in platform_ad_events
router.post('/:id/event', optionalAuth, async (req, res) => {
  try {
    const adId = Number(req.params.id);
    const eventType = req.body?.event_type === 'click' ? 'click' : 'impression';
    if (!Number.isInteger(adId)) return res.status(400).json({ error: 'Invalid ad id' });

    const ip = getClientIp(req);
    const userId = req.user?.id || null;

    await pool.query(
      `INSERT INTO platform_ad_events (ad_id, user_id, ip, event_type) VALUES ($1, $2, $3, $4)`,
      [adId, userId, ip, eventType]
    );

    if (eventType === 'click') {
      await pool.query(`UPDATE platform_ads SET clicks_count = clicks_count + 1 WHERE id = $1`, [adId]);
    } else {
      const seenBefore = await pool.query(
        `SELECT 1 FROM platform_ad_events
          WHERE ad_id = $1 AND event_type = 'impression'
            AND (($2::int IS NOT NULL AND user_id = $2) OR ($2::int IS NULL AND ip = $3))
          OFFSET 1 LIMIT 1`,
        [adId, userId, ip]
      );
      const isUnique = seenBefore.rows.length === 0 ? 1 : 0;
      await pool.query(
        `UPDATE platform_ads
            SET impressions_count = impressions_count + 1,
                unique_reach_count = unique_reach_count + $2
          WHERE id = $1`,
        [adId, isUnique]
      );
    }

    return res.status(202).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/platform-ads/notifications — In-app user notifications (broadcasts & admin warnings)
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, broadcast_id, kind, title, body, deep_link, is_read, created_at
         FROM user_notifications
        WHERE user_id = $1
        ORDER BY is_read ASC, created_at DESC
        LIMIT 20`,
      [req.user.id]
    );
    return res.json({ notifications: rows });
  } catch (err) {
    return res.status(500).json({ notifications: [] });
  }
});

router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE user_notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING broadcast_id`,
      [id, req.user.id]
    );
    if (rows[0]?.broadcast_id) {
      await pool.query(`UPDATE push_broadcasts SET opened_count = opened_count + 1 WHERE id = $1`, [rows[0].broadcast_id]);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/platform-ads/reports — Community reporting endpoint feeding Core OS Moderation Queue
router.post('/reports', requireAuth, async (req, res) => {
  try {
    const { target_type = 'post', target_id, reason = '' } = req.body || {};
    if (!['post', 'comment', 'user', 'prayer', 'live'].includes(target_type) || !Number.isInteger(Number(target_id))) {
      return res.status(400).json({ error: 'Objetivo de reporte inválido.' });
    }
    const cleanReason = String(reason || '').trim().slice(0, 400);
    if (!cleanReason) return res.status(400).json({ error: 'Indica el motivo del reporte.' });
    const { rows } = await pool.query(
      `INSERT INTO content_reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.user.id, target_type, Number(target_id), cleanReason]
    );
    return res.status(201).json({ ok: true, report_id: rows[0].id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.isAdEligibleForViewer = isAdEligibleForViewer;
