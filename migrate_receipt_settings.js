const pool = require('./db');

async function migrateReceiptSettings() {
  console.log('=== RUNNING RECEIPT SETTINGS MIGRATION ===');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS receipt_settings (
        id SERIAL PRIMARY KEY,
        store_name VARCHAR(150) NOT NULL DEFAULT 'CIP Coffee',
        store_address TEXT DEFAULT '',
        store_phone VARCHAR(50) DEFAULT '',
        header_title VARCHAR(150) DEFAULT 'CIP Coffee',
        header_subtitle TEXT DEFAULT '',
        show_order_type BOOLEAN DEFAULT TRUE,
        show_cashier_name BOOLEAN DEFAULT TRUE,
        show_date_time BOOLEAN DEFAULT TRUE,
        bank_info TEXT DEFAULT 'BRK : 165-27-00044\nBCA : 034-392-4680\nA.N Nacha Soraya',
        thank_you_message TEXT DEFAULT 'Terimakasih Kak.',
        footer_note TEXT DEFAULT 'Powered by POSAN POS',
        paper_size VARCHAR(10) DEFAULT '58mm',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Ensure at least one default row exists
    const checkRes = await client.query('SELECT id FROM receipt_settings LIMIT 1');
    if (checkRes.rows.length === 0) {
      await client.query(`
        INSERT INTO receipt_settings (
          store_name, header_title, show_order_type, show_cashier_name, show_date_time,
          bank_info, thank_you_message, footer_note, paper_size
        ) VALUES (
          'CIP Coffee', 'CIP Coffee', true, true, true,
          'BRK : 165-27-00044\nBCA : 034-392-4680\nA.N Nacha Soraya',
          'Terimakasih Kak.',
          'Powered by POSAN POS',
          '58mm'
        );
      `);
      console.log('Inserted default receipt_settings.');
    }

    await client.query('COMMIT');
    console.log('=== RECEIPT SETTINGS MIGRATION COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateReceiptSettings();
