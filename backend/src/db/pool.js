const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 25,
  idleTimeoutMillis: 25000,
  connectionTimeoutMillis: 6000,
  statement_timeout: 12000,
  query_timeout: 12000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error:', err.message);
});

async function initDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  // Refresh PostgreSQL planner statistics for newly created/updated composite & partial indexes
  await pool
    .query(
      'ANALYZE posts, users, post_reactions, post_comments, saved_posts, follows, stories, prayer_intentions, prayer_logs, live_channels;'
    )
    .catch(() => {});
}

module.exports = {
  pool,
  initDatabase,
};
