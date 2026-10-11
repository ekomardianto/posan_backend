const pool = require('../../db');

async function runMultiTenantMigration() {
  console.log('=== RUNNING MULTI-TENANT (MERCHANT/COFFEESHOP) MIGRATION ===');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create merchants table
    console.log('1. Creating merchants table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(100) UNIQUE,
        category VARCHAR(50) DEFAULT 'Coffee Shop',
        address TEXT,
        city VARCHAR(100),
        phone VARCHAR(50),
        email VARCHAR(100),
        logo_url TEXT,
        color VARCHAR(50) DEFAULT 'bg-amber-100 text-amber-700',
        plan VARCHAR(50) DEFAULT 'Enterprise Multi-Outlet Plan',
        billing_cycle VARCHAR(50) DEFAULT 'Tahunan',
        status VARCHAR(20) DEFAULT 'Active',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Seed Default Merchants if empty
    console.log('2. Seeding default merchants...');
    await client.query(`
      INSERT INTO merchants (id, name, slug, category, address, city, phone, email, color, status, is_active)
      VALUES 
        (1, 'POSAN Coffee & Roastery Utama', 'posan-utama', 'Specialty Coffee & Eatery', 'Jl. Senopati Raya No. 45, Kebayoran Baru', 'Jakarta Selatan', '+62 812-3456-7890', 'admin@posan.com', 'bg-amber-100 text-amber-700', 'Active', true),
        (2, 'POSAN Artisan Dago', 'posan-dago', 'Specialty Coffee & Pastry', 'Jl. Ir. H. Juanda No. 102, Dago', 'Bandung', '+62 813-9876-5432', 'dago@posan.com', 'bg-emerald-100 text-emerald-700', 'Active', true)
      ON CONFLICT (id) DO NOTHING;

      -- Reset sequence if needed
      SELECT setval(pg_get_serial_sequence('merchants', 'id'), COALESCE((SELECT MAX(id) FROM merchants), 1));
    `);

    // 3. Add merchant_id to users
    console.log('3. Adding merchant_id to users...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL DEFAULT 1;
      UPDATE users SET merchant_id = 1 WHERE merchant_id IS NULL AND role != 'super_admin';
      CREATE INDEX IF NOT EXISTS idx_users_merchant_id ON users (merchant_id);
    `);

    // 4. Add merchant_id to categories
    console.log('4. Adding merchant_id to categories...');
    await client.query(`
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE categories SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_categories_merchant_id ON categories (merchant_id);
    `);

    // 5. Add merchant_id to products
    console.log('5. Adding merchant_id to products...');
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE products SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products (merchant_id);
    `);

    // 6. Add merchant_id to payment_methods
    console.log('6. Adding merchant_id to payment_methods...');
    await client.query(`
      ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE payment_methods SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_payment_methods_merchant_id ON payment_methods (merchant_id);
    `);

    // 7. Add merchant_id to sales_transactions
    console.log('7. Adding merchant_id to sales_transactions...');
    await client.query(`
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE sales_transactions SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_sales_transactions_merchant_id ON sales_transactions (merchant_id);
    `);

    // 8. Add merchant_id to receipt_settings
    console.log('8. Adding merchant_id to receipt_settings...');
    await client.query(`
      ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE receipt_settings SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_receipt_settings_merchant_id ON receipt_settings (merchant_id);
    `);

    // 9. Add merchant_id to order_logs
    console.log('9. Adding merchant_id to order_logs...');
    await client.query(`
      ALTER TABLE order_logs ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE DEFAULT 1;
      UPDATE order_logs SET merchant_id = 1 WHERE merchant_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_order_logs_merchant_id ON order_logs (merchant_id);
    `);

    // 10. Update UNIQUE constraints to be per-merchant (Multi-tenant isolated)
    console.log('10. Updating constraints to per-merchant unique...');
    await client.query(`
      ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key CASCADE;
      ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_merchant_name_unique CASCADE;
      ALTER TABLE categories ADD CONSTRAINT categories_merchant_name_unique UNIQUE (merchant_id, name);

      ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_name_key CASCADE;
      ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_merchant_name_unique CASCADE;
      ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_merchant_name_unique UNIQUE (merchant_id, name);

      ALTER TABLE sales_transactions DROP CONSTRAINT IF EXISTS sales_transactions_receipt_number_key CASCADE;
      ALTER TABLE sales_transactions DROP CONSTRAINT IF EXISTS sales_transactions_merchant_receipt_unique CASCADE;
      ALTER TABLE sales_transactions ADD CONSTRAINT sales_transactions_merchant_receipt_unique UNIQUE (merchant_id, receipt_number);
    `);

    await client.query('COMMIT');
    console.log('=== MULTI-TENANT MIGRATION COMPLETED SUCCESSFULLY! ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMultiTenantMigration();
