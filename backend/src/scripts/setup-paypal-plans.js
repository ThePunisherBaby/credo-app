#!/usr/bin/env node
/**
 * Autonomous, idempotent PayPal Product & Billing Plan provisioner.
 * Usage:
 *   PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run setup-paypal-plans
 */
const { initDatabase, pool } = require('../db/pool');
const { seedCredoOnePlans } = require('../db/credoOneSeed');
const { isPayPalConfigured, setupPayPalProductsAndPlans } = require('../services/paypal');
const { PAYPAL_MODE } = require('../config');

async function main() {
  console.log(`[setup-paypal-plans] Initializing DB & Credo One plan catalog (mode=${PAYPAL_MODE})...`);
  await initDatabase();
  await seedCredoOnePlans();

  if (!isPayPalConfigured()) {
    console.error(
      '[setup-paypal-plans] Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment.\n' +
        'Set PAYPAL_MODE, PAYPAL_CLIENT_ID, and PAYPAL_CLIENT_SECRET and re-run.'
    );
    process.exit(1);
  }

  const summary = await setupPayPalProductsAndPlans();
  console.log('[setup-paypal-plans] Successfully synchronized 4 products & 8 billing plans:');
  console.table(summary);
  await pool.end();
}

main().catch((err) => {
  console.error('[setup-paypal-plans] Error:', err.message);
  process.exit(1);
});
