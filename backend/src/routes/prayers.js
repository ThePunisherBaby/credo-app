const express = require('express');
const { pool } = require('../db/pool');
const { optionalAuth } = require('../middleware/auth');
const { getLiveDailyLiturgy } = require('../utils/officialSync');
const { apiCache } = require('../utils/fastCache');

const router = express.Router();

// GET /api/v1/prayers/liturgy — Live Daily Liturgy from reflexionandolapalabra.com
router.get('/liturgy', async (req, res) => {
  const lang = String(req.query.lang || 'es').slice(0, 2).toLowerCase();
  const live = await getLiveDailyLiturgy();
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({
    date: new Date().toISOString().slice(0, 10),
    lang,
    liturgy: live,
  });
});

// GET /api/v1/prayers/intentions?filter=recent|urgent|mine&device_key=&limit=20&offset=0
router.get('/intentions', optionalAuth, async (req, res) => {
  try {
    const filter = String(req.query.filter || 'recent');
    const deviceKey = String(req.query.device_key || '').trim().slice(0, 64);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const clauses = [];
    const params = [];

    if (filter === 'urgent') {
      clauses.push('(pi.is_urgent = TRUE OR pi.category = \'urgent\')');
    } else if (filter === 'mine') {
      if (req.user) {
        params.push(req.user.id);
        clauses.push(`pi.user_id = $${params.length}`);
      } else {
        return res.json({ intentions: [], total: 0 });
      }
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderSql =
      filter === 'urgent'
        ? 'ORDER BY pi.is_urgent DESC, pi.prayers_count DESC, pi.created_at DESC'
        : 'ORDER BY pi.created_at DESC';

    const runQuery = async () => {
      const qParams = [...params, limit, offset];
      const limitIdx = qParams.length - 1;
      const offsetIdx = qParams.length;
      const { rows } = await pool.query(
        `SELECT pi.id, pi.author_display, pi.is_anonymous, pi.category, pi.is_urgent,
                pi.content, pi.prayers_count, pi.created_at
           FROM prayer_intentions pi
          ${whereSql}
          ${orderSql}
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        qParams
      );
      return rows;
    };

    const rows =
      filter !== 'mine'
        ? await apiCache.getOrLoad(`prayers:list:${filter}:${limit}:${offset}`, 10000, runQuery)
        : await runQuery();

    let prayedSet = new Set();
    if (rows.length > 0 && (req.user || deviceKey)) {
      const ids = rows.map((r) => r.id);
      const logRes = req.user
        ? await pool.query(
            'SELECT intention_id FROM prayer_logs WHERE intention_id = ANY($1::int[]) AND user_id = $2',
            [ids, req.user.id]
          )
        : await pool.query(
            'SELECT intention_id FROM prayer_logs WHERE intention_id = ANY($1::int[]) AND user_id IS NULL AND device_key = $2',
            [ids, deviceKey]
          );
      prayedSet = new Set(logRes.rows.map((r) => r.intention_id));
    }

    return res.json({
      intentions: rows.map((r) => ({
        id: r.id,
        author_display: r.is_anonymous ? 'Fiel anónimo' : r.author_display,
        is_anonymous: Boolean(r.is_anonymous),
        category: r.category,
        is_urgent: Boolean(r.is_urgent),
        content: r.content,
        prayers_count: r.prayers_count,
        i_prayed: prayedSet.has(r.id),
        unit_id: null,
        unit_name: '',
        unit_city: '',
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('[prayers/intentions]', err);
    return res.status(500).json({ error: 'Failed to load prayer intentions' });
  }
});

// POST /api/v1/prayers/intentions — Open to all faithful (authenticated or guest)
router.post('/intentions', optionalAuth, async (req, res) => {
  try {
    const {
      content,
      category = 'family',
      is_anonymous = false,
      is_urgent = false,
      author_name,
    } = req.body || {};

    const clean = String(content || '').trim();
    if (clean.length < 6 || clean.length > 600) {
      return res.status(400).json({ error: 'La intención debe tener entre 6 y 600 caracteres.' });
    }

    const allowedCategories = new Set(['health', 'family', 'peace', 'vocation', 'gratitude', 'urgent']);
    const safeCategory = allowedCategories.has(category) ? category : 'family';
    const urgentFlag = Boolean(is_urgent || safeCategory === 'urgent');
    const anonFlag = Boolean(is_anonymous);
    const display = anonFlag
      ? 'Fiel anónimo'
      : String(author_name || req.user?.full_name || 'Fiel en oración').trim().slice(0, 80);

    const { rows } = await pool.query(
      `INSERT INTO prayer_intentions (user_id, unit_id, author_display, is_anonymous, category, is_urgent, content, prayers_count)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, 1)
       RETURNING *`,
      [req.user?.id || null, display, anonFlag, safeCategory, urgentFlag, clean]
    );

    apiCache.invalidate('prayers:');
    apiCache.invalidate('stats:');

    const created = rows[0];
    return res.status(201).json({
      intention: {
        id: created.id,
        author_display: created.author_display,
        is_anonymous: created.is_anonymous,
        category: created.category,
        is_urgent: created.is_urgent,
        content: created.content,
        prayers_count: created.prayers_count,
        i_prayed: true,
        unit_id: null,
        unit_name: '',
        created_at: created.created_at,
      },
    });
  } catch (err) {
    console.error('[prayers/create]', err);
    return res.status(500).json({ error: 'Failed to create prayer intention' });
  }
});

// POST /api/v1/prayers/intentions/:id/pray — Interactive "Orar por esto" candle/prayer counter
router.post('/intentions/:id/pray', optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid intention id' });
    }
    const deviceKey = String(req.body?.device_key || '').trim().slice(0, 64) || 'guest';

    let already = false;
    if (req.user) {
      const check = await pool.query(
        'SELECT id FROM prayer_logs WHERE intention_id = $1 AND user_id = $2',
        [id, req.user.id]
      );
      if (check.rows.length > 0) {
        already = true;
      } else {
        await pool.query(
          'INSERT INTO prayer_logs (intention_id, user_id, device_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, req.user.id, '']
        );
      }
    } else {
      const check = await pool.query(
        'SELECT id FROM prayer_logs WHERE intention_id = $1 AND user_id IS NULL AND device_key = $2',
        [id, deviceKey]
      );
      if (check.rows.length > 0) {
        already = true;
      } else {
        await pool.query(
          'INSERT INTO prayer_logs (intention_id, user_id, device_key) VALUES ($1, NULL, $2) ON CONFLICT DO NOTHING',
          [id, deviceKey]
        );
      }
    }

    const { rows } = already
      ? await pool.query('SELECT id, prayers_count FROM prayer_intentions WHERE id = $1', [id])
      : await pool.query(
          'UPDATE prayer_intentions SET prayers_count = prayers_count + 1 WHERE id = $1 RETURNING id, prayers_count',
          [id]
        );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Prayer intention not found' });
    }

    if (!already) {
      apiCache.invalidate('prayers:');
      apiCache.invalidate('stats:');
    }

    return res.json({
      id: rows[0].id,
      prayers_count: rows[0].prayers_count,
      i_prayed: true,
      incremented: !already,
    });
  } catch (err) {
    console.error('[prayers/pray]', err);
    return res.status(500).json({ error: 'Failed to register prayer' });
  }
});

// POST /api/v1/prayers/offerings — 100% direct Parish Offering (demo confirmation)
router.post('/offerings', optionalAuth, async (req, res) => {
  try {
    const { unit_id, amount_usd, frequency = 'one_time', intention_note = '' } = req.body || {};
    const parsedUnit = Number(unit_id);
    const amountCents = Math.round(Number(amount_usd) * 100);
    if (!Number.isInteger(parsedUnit) || !Number.isFinite(amountCents) || amountCents < 100 || amountCents > 5000000) {
      return res.status(400).json({ error: 'Selecciona una parroquia y un monto válido.' });
    }
    const safeFreq = frequency === 'monthly' ? 'monthly' : 'one_time';

    const { rows } = await pool.query(
      `INSERT INTO parish_offerings (user_id, unit_id, amount_cents, currency, frequency, intention_note)
       VALUES ($1, $2, $3, 'USD', $4, $5)
       RETURNING id, unit_id, amount_cents, currency, frequency, created_at`,
      [req.user?.id || null, parsedUnit, amountCents, safeFreq, String(intention_note).trim().slice(0, 300)]
    );

    return res.status(201).json({
      offering: rows[0],
      guarantee: '100% íntegro para la parroquia seleccionada',
    });
  } catch (err) {
    console.error('[prayers/offerings]', err);
    return res.status(500).json({ error: 'Failed to record parish offering' });
  }
});

module.exports = router;
