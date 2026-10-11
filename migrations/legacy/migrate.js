const pool = require('../../db');

async function runMigration() {
  console.log('=== RUNNING DATABASE MIGRATION ===');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update users_role_check constraint to support 5 roles
    console.log('1. Updating users.role check constraint...');
    await client.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('kasir', 'admin', 'super_admin', 'barista', 'kitchen'));
    `);

    // 2. Add station to categories
    console.log('2. Adding station column to categories...');
    await client.query(`
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS station VARCHAR(20) DEFAULT 'barista';
      ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_station_check;
      ALTER TABLE categories ADD CONSTRAINT categories_station_check 
        CHECK (station IN ('barista', 'kitchen'));
    `);

    // Update existing category stations
    await client.query(`
      UPDATE categories SET station = 'barista' 
      WHERE LOWER(name) LIKE '%coffe%' OR LOWER(name) LIKE '%kopi%' OR LOWER(name) LIKE '%mocktail%' 
         OR LOWER(name) LIKE '%drink%' OR LOWER(name) LIKE '%minum%' OR LOWER(name) LIKE '%tea%';
         
      UPDATE categories SET station = 'kitchen' 
      WHERE LOWER(name) LIKE '%makan%' OR LOWER(name) LIKE '%food%' OR LOWER(name) LIKE '%pastry%' 
         OR LOWER(name) LIKE '%bakery%' OR LOWER(name) LIKE '%snack%' OR LOWER(name) LIKE '%dessert%';
    `);

    // 3. Add station to products (optional override)
    console.log('3. Adding station column to products...');
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS station VARCHAR(20) DEFAULT NULL;
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_station_check;
      ALTER TABLE products ADD CONSTRAINT products_station_check 
        CHECK (station IS NULL OR station IN ('barista', 'kitchen'));
    `);

    // 4. Add station, item_status, notes to transaction_items
    console.log('4. Adding station, item_status, notes to transaction_items...');
    await client.query(`
      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS station VARCHAR(20) NOT NULL DEFAULT 'barista';
      ALTER TABLE transaction_items DROP CONSTRAINT IF EXISTS transaction_items_station_check;
      ALTER TABLE transaction_items ADD CONSTRAINT transaction_items_station_check 
        CHECK (station IN ('barista', 'kitchen'));

      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS item_status VARCHAR(20) NOT NULL DEFAULT 'pending';
      ALTER TABLE transaction_items DROP CONSTRAINT IF EXISTS transaction_items_item_status_check;
      ALTER TABLE transaction_items ADD CONSTRAINT transaction_items_item_status_check 
        CHECK (item_status IN ('pending', 'processing', 'completed'));

      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_transaction_items_station_status ON transaction_items (station, item_status);
      CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items (transaction_id);
    `);

    // 5. Add customer_name & notes to sales_transactions
    console.log('5. Adding customer_name & notes to sales_transactions...');
    await client.query(`
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS customer_name VARCHAR(100) DEFAULT NULL;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;
    `);

    // 6. Add order_logs table and timestamp millis columns
    console.log('6. Adding order_logs table and currentmillis tracking...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_logs (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER REFERENCES sales_transactions (id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES transaction_items (id) ON DELETE CASCADE,
        receipt_number VARCHAR(100) NOT NULL,
        product_name VARCHAR(150) NOT NULL,
        station VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'masuk',
        created_at_millis BIGINT NOT NULL,
        processing_at_millis BIGINT DEFAULT NULL,
        completed_at_millis BIGINT DEFAULT NULL,
        updated_by VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS created_at_millis BIGINT;
      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS processing_at_millis BIGINT;
      ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS completed_at_millis BIGINT;

      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS created_at_millis BIGINT;

      CREATE INDEX IF NOT EXISTS idx_order_logs_receipt ON order_logs (receipt_number);
      CREATE INDEX IF NOT EXISTS idx_order_logs_station_status ON order_logs (station, status);
      CREATE INDEX IF NOT EXISTS idx_order_logs_created_millis ON order_logs (created_at_millis);
    `);

    await client.query('COMMIT');
    console.log('=== MIGRATION COMPLETED SUCCESSFULLY! ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

