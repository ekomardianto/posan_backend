require('dotenv').config();
const pool = require('./db');

async function seedConfigs() {
  try {
    await pool.query('ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS config JSONB DEFAULT \'{}\'');
    
    await pool.query(
      'UPDATE payment_methods SET config = $1 WHERE id = $2',
      [
        JSON.stringify({
          cash_drawer_auto_open: true,
          rounding_rule: 'Tanpa Pembulatan',
          allow_change: true,
          max_cash_limit: '5000000',
        }),
        37,
      ]
    );

    await pool.query(
      'UPDATE payment_methods SET config = $1 WHERE id = $2',
      [
        JSON.stringify({
          qris_mode: 'dynamic',
          gateway_provider: 'QRIS Standar Bank Indonesia',
          mid: 'POSAN-QRIS-9921',
          auto_verify_webhook: true,
          timeout_minutes: 15,
          settlement_type: 'Instant H+0',
          webhook_url: 'https://api.posan.com/api/webhooks/qris',
        }),
        38,
      ]
    );

    await pool.query(
      'UPDATE payment_methods SET config = $1 WHERE id = $2',
      [
        JSON.stringify({
          bank_name: 'BCA / Mandiri / BRI',
          account_number: '8820-1928-3310',
          account_holder: 'POSAN OPERATIONAL CAFE',
          require_proof_upload: true,
          edc_tid: 'TID-882910',
        }),
        39,
      ]
    );

    const res = await pool.query('SELECT id, name, config FROM payment_methods ORDER BY id ASC');
    console.log('Successfully seeded configurations:', res.rows);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding config:', err);
    process.exit(1);
  }
}

seedConfigs();
