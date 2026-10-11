const pool = require('../db');

const VERSION = '001_initial_schema';

const tables = [
  {
    name: 'merchants',
    create: `CREATE TABLE IF NOT EXISTS merchants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(100) UNIQUE,
      category VARCHAR(100) DEFAULT 'Coffee Shop',
      address TEXT,
      city VARCHAR(100),
      phone VARCHAR(50),
      email VARCHAR(150),
      logo_url TEXT,
      color VARCHAR(80) DEFAULT 'bg-amber-100 text-amber-700',
      plan VARCHAR(100) DEFAULT 'Enterprise Multi-Outlet Plan',
      billing_cycle VARCHAR(50) DEFAULT 'Tahunan',
      status VARCHAR(30) DEFAULT 'Active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      name: "VARCHAR(150) NOT NULL DEFAULT ''",
      slug: 'VARCHAR(100)',
      category: "VARCHAR(100) DEFAULT 'Coffee Shop'",
      address: 'TEXT', city: 'VARCHAR(100)', phone: 'VARCHAR(50)',
      email: 'VARCHAR(150)', logo_url: 'TEXT', color: 'VARCHAR(80)',
      plan: 'VARCHAR(100)', billing_cycle: 'VARCHAR(50)',
      status: "VARCHAR(30) DEFAULT 'Active'",
      is_active: 'BOOLEAN NOT NULL DEFAULT TRUE',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'users',
    create: `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(30) NOT NULL CHECK (role IN ('kasir', 'admin', 'super_admin', 'barista', 'kitchen')),
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      phone VARCHAR(50),
      shift VARCHAR(100),
      auth_pin VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      name: "VARCHAR(150) NOT NULL DEFAULT ''",
      email: "VARCHAR(255) NOT NULL DEFAULT ''",
      password_hash: "TEXT NOT NULL DEFAULT ''",
      role: "VARCHAR(30) NOT NULL DEFAULT 'kasir'",
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE SET NULL',
      is_active: 'BOOLEAN NOT NULL DEFAULT TRUE', phone: 'VARCHAR(50)',
      shift: 'VARCHAR(100)', auth_pin: 'VARCHAR(20)',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'categories',
    create: `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      station VARCHAR(20) NOT NULL DEFAULT 'barista' CHECK (station IN ('barista', 'kitchen', 'none')),
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      name: "VARCHAR(150) NOT NULL DEFAULT ''", description: 'TEXT',
      station: "VARCHAR(20) NOT NULL DEFAULT 'barista'",
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'products',
    create: `CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      station VARCHAR(20) CHECK (station IN ('barista', 'kitchen', 'none')),
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      name: "VARCHAR(200) NOT NULL DEFAULT ''", price: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      category_id: 'INTEGER REFERENCES categories(id) ON DELETE SET NULL',
      description: 'TEXT', is_active: 'BOOLEAN NOT NULL DEFAULT TRUE',
      station: 'VARCHAR(20)',
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE', image_url: 'TEXT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'payment_methods',
    create: `CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      name: "VARCHAR(100) NOT NULL DEFAULT ''", is_active: 'BOOLEAN NOT NULL DEFAULT TRUE',
      config: "JSONB NOT NULL DEFAULT '{}'::jsonb",
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'sales_transactions',
    create: `CREATE TABLE IF NOT EXISTS sales_transactions (
      id SERIAL PRIMARY KEY,
      receipt_number VARCHAR(100) NOT NULL,
      cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      payment_method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
      total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
      change_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'completed',
      customer_name VARCHAR(150),
      notes TEXT,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at_millis BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      receipt_number: "VARCHAR(100) NOT NULL DEFAULT ''",
      cashier_id: 'INTEGER REFERENCES users(id) ON DELETE SET NULL',
      payment_method_id: 'INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL',
      total_amount: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      amount_paid: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      change_amount: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      status: "VARCHAR(30) NOT NULL DEFAULT 'completed'",
      customer_name: 'VARCHAR(150)', notes: 'TEXT',
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE SET NULL',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()', created_at_millis: 'BIGINT',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'transaction_items',
    create: `CREATE TABLE IF NOT EXISTS transaction_items (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name VARCHAR(200) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
      station VARCHAR(20) NOT NULL DEFAULT 'barista' CHECK (station IN ('barista', 'kitchen', 'none')),
      item_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (item_status IN ('pending', 'processing', 'completed', 'cancelled')),
      processed_by VARCHAR(150),
      notes TEXT,
      created_at_millis BIGINT,
      processing_at_millis BIGINT,
      completed_at_millis BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      transaction_id: 'INTEGER REFERENCES sales_transactions(id) ON DELETE CASCADE',
      product_id: 'INTEGER REFERENCES products(id) ON DELETE SET NULL',
      product_name: "VARCHAR(200) NOT NULL DEFAULT ''",
      quantity: 'INTEGER NOT NULL DEFAULT 1', unit_price: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      subtotal: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      station: "VARCHAR(20) NOT NULL DEFAULT 'barista'",
      item_status: "VARCHAR(20) NOT NULL DEFAULT 'pending'", processed_by: 'VARCHAR(150)',
      notes: 'TEXT', created_at_millis: 'BIGINT', processing_at_millis: 'BIGINT',
      completed_at_millis: 'BIGINT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'order_logs',
    create: `CREATE TABLE IF NOT EXISTS order_logs (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER REFERENCES sales_transactions(id) ON DELETE CASCADE,
      item_id INTEGER REFERENCES transaction_items(id) ON DELETE CASCADE,
      receipt_number VARCHAR(100) NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      station VARCHAR(20) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'masuk',
      created_at_millis BIGINT NOT NULL,
      processing_at_millis BIGINT,
      completed_at_millis BIGINT,
      updated_by VARCHAR(150),
      notes TEXT,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT order_logs_station_check CHECK (station IN ('barista', 'kitchen', 'none'))
    )`,
    columns: {
      transaction_id: 'INTEGER REFERENCES sales_transactions(id) ON DELETE CASCADE',
      item_id: 'INTEGER REFERENCES transaction_items(id) ON DELETE CASCADE',
      receipt_number: "VARCHAR(100) NOT NULL DEFAULT ''",
      product_name: "VARCHAR(200) NOT NULL DEFAULT ''", station: "VARCHAR(20) NOT NULL DEFAULT 'barista'",
      status: "VARCHAR(30) NOT NULL DEFAULT 'masuk'", created_at_millis: 'BIGINT NOT NULL DEFAULT 0',
      processing_at_millis: 'BIGINT', completed_at_millis: 'BIGINT',
      updated_by: 'VARCHAR(150)', notes: 'TEXT',
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE SET NULL',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'receipt_settings',
    create: `CREATE TABLE IF NOT EXISTS receipt_settings (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      cafe_name VARCHAR(150),
      address TEXT,
      phone_number VARCHAR(50),
      header_note TEXT,
      store_name VARCHAR(150) NOT NULL DEFAULT 'POSAN Coffee',
      store_address TEXT NOT NULL DEFAULT '',
      store_phone VARCHAR(50) NOT NULL DEFAULT '',
      header_title VARCHAR(150) NOT NULL DEFAULT 'POSAN Coffee',
      header_subtitle TEXT NOT NULL DEFAULT '',
      show_logo BOOLEAN NOT NULL DEFAULT TRUE,
      logo_url TEXT NOT NULL DEFAULT '',
      show_order_type BOOLEAN NOT NULL DEFAULT TRUE,
      show_cashier_name BOOLEAN NOT NULL DEFAULT TRUE,
      show_date_time BOOLEAN NOT NULL DEFAULT TRUE,
      bank_info TEXT NOT NULL DEFAULT '',
      thank_you_message TEXT NOT NULL DEFAULT 'Terima kasih.',
      footer_note TEXT NOT NULL DEFAULT 'Powered by POSAN POS',
      paper_size VARCHAR(10) NOT NULL DEFAULT '58mm',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      cafe_name: 'VARCHAR(150)', address: 'TEXT', phone_number: 'VARCHAR(50)',
      header_note: 'TEXT',
      store_name: "VARCHAR(150) NOT NULL DEFAULT 'POSAN Coffee'",
      store_address: "TEXT NOT NULL DEFAULT ''", store_phone: "VARCHAR(50) NOT NULL DEFAULT ''",
      header_title: "VARCHAR(150) NOT NULL DEFAULT 'POSAN Coffee'",
      header_subtitle: "TEXT NOT NULL DEFAULT ''", show_logo: 'BOOLEAN NOT NULL DEFAULT TRUE',
      logo_url: "TEXT NOT NULL DEFAULT ''", show_order_type: 'BOOLEAN NOT NULL DEFAULT TRUE',
      show_cashier_name: 'BOOLEAN NOT NULL DEFAULT TRUE', show_date_time: 'BOOLEAN NOT NULL DEFAULT TRUE',
      bank_info: "TEXT NOT NULL DEFAULT ''", thank_you_message: "TEXT NOT NULL DEFAULT 'Terima kasih.'",
      footer_note: "TEXT NOT NULL DEFAULT 'Powered by POSAN POS'", paper_size: "VARCHAR(10) NOT NULL DEFAULT '58mm'",
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
];

async function ensureAndVerifyColumns(client) {
  for (const table of tables) {
    await client.query(table.create);
    for (const [column, definition] of Object.entries(table.columns)) {
      await client.query(`ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const result = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1`,
      [table.name]
    );
    const existingColumns = new Set(result.rows.map((row) => row.column_name));
    const expectedColumns = ['id', ...Object.keys(table.columns)];
    const missing = expectedColumns.filter((column) => !existingColumns.has(column));
    if (missing.length > 0) {
      throw new Error(`Schema check failed for ${table.name}; missing columns: ${missing.join(', ')}`);
    }
  }
}

async function runInitialSchemaMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(790241, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(150) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [VERSION]);
    // Reconcile missing tables/columns on every deploy. Existing data and present columns are preserved.
    await ensureAndVerifyColumns(client);

    if (applied.rowCount > 0) {
      await client.query('COMMIT');
      console.log(`Migration ${VERSION} already applied; checked tables and columns.`);
      return;
    }

    // Merchant 1 is the default tenant used by the existing API for new installations.
    await client.query(`
      INSERT INTO merchants (id, name, slug, category, status, is_active)
      VALUES (1, 'POSAN Coffee', 'posan-utama', 'Coffee Shop', 'Active', TRUE)
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO merchants (id, name, slug, category, status, is_active)
      VALUES (2, 'POSAN Artisan Dago', 'posan-dago', 'Coffee Shop', 'Active', TRUE)
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('merchants', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM merchants), 1), 1),
        EXISTS (SELECT 1 FROM merchants)
      )
    `);

    // Existing single-tenant rows belong to the default merchant, as in the previous multi-tenant migration.
    await client.query("UPDATE users SET merchant_id = 1 WHERE merchant_id IS NULL AND role <> 'super_admin'");
    for (const table of ['categories', 'products', 'payment_methods', 'sales_transactions', 'receipt_settings', 'order_logs']) {
      await client.query(`UPDATE ${table} SET merchant_id = 1 WHERE merchant_id IS NULL`);
    }

    // Normalize known constraints to the roles/stations accepted by the current API.
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('kasir', 'admin', 'super_admin', 'barista', 'kitchen'))`);
    await client.query('ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_station_check');
    await client.query(`ALTER TABLE categories ADD CONSTRAINT categories_station_check
      CHECK (station IN ('barista', 'kitchen', 'none'))`);
    await client.query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_station_check');
    await client.query(`ALTER TABLE products ADD CONSTRAINT products_station_check
      CHECK (station IS NULL OR station IN ('barista', 'kitchen', 'none'))`);
    await client.query('ALTER TABLE transaction_items DROP CONSTRAINT IF EXISTS transaction_items_station_check');
    await client.query(`ALTER TABLE transaction_items ADD CONSTRAINT transaction_items_station_check
      CHECK (station IN ('barista', 'kitchen', 'none'))`);
    await client.query('ALTER TABLE transaction_items DROP CONSTRAINT IF EXISTS transaction_items_item_status_check');
    await client.query(`ALTER TABLE transaction_items ADD CONSTRAINT transaction_items_item_status_check
      CHECK (item_status IN ('pending', 'processing', 'completed', 'cancelled'))`);
    await client.query('ALTER TABLE order_logs DROP CONSTRAINT IF EXISTS order_logs_station_check');
    await client.query(`ALTER TABLE order_logs ADD CONSTRAINT order_logs_station_check
      CHECK (station IN ('barista', 'kitchen', 'none'))`);

    // Replace old global uniqueness constraints with tenant-scoped indexes.
    await client.query('ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key');
    await client.query('ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_name_key');
    await client.query('ALTER TABLE sales_transactions DROP CONSTRAINT IF EXISTS sales_transactions_receipt_number_key');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS categories_merchant_name_unique ON categories (merchant_id, name)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_merchant_name_unique ON payment_methods (merchant_id, name)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS sales_transactions_merchant_receipt_unique ON sales_transactions (merchant_id, receipt_number)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email))');

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_merchant_id ON users (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_categories_merchant_id ON categories (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_sales_transactions_merchant_id ON sales_transactions (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_sales_transactions_created_at ON sales_transactions (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items (transaction_id)',
      'CREATE INDEX IF NOT EXISTS idx_transaction_items_station_status ON transaction_items (station, item_status)',
      'CREATE INDEX IF NOT EXISTS idx_order_logs_receipt ON order_logs (receipt_number)',
      'CREATE INDEX IF NOT EXISTS idx_order_logs_station_status ON order_logs (station, status)',
      'CREATE INDEX IF NOT EXISTS idx_order_logs_merchant_id ON order_logs (merchant_id)',
    ];
    for (const index of indexes) await client.query(index);

    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [VERSION]);
    await client.query('COMMIT');
    console.log(`Migration ${VERSION} applied successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database migration failed; transaction rolled back:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runInitialSchemaMigration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
