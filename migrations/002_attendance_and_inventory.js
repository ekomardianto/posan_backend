const pool = require('../db');

const VERSION = '002_attendance_and_inventory';

const tables = [
  {
    name: 'attendances',
    create: `CREATE TABLE IF NOT EXISTS attendances (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      user_id VARCHAR(50) NOT NULL,
      user_name VARCHAR(150) NOT NULL,
      role VARCHAR(50) NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      check_in_time TIMESTAMPTZ,
      check_out_time TIMESTAMPTZ,
      status VARCHAR(50) NOT NULL DEFAULT 'working',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      user_id: "VARCHAR(50) NOT NULL DEFAULT ''",
      user_name: "VARCHAR(150) NOT NULL DEFAULT ''",
      role: "VARCHAR(50) NOT NULL DEFAULT ''",
      date: 'DATE NOT NULL DEFAULT CURRENT_DATE',
      check_in_time: 'TIMESTAMPTZ',
      check_out_time: 'TIMESTAMPTZ',
      status: "VARCHAR(50) NOT NULL DEFAULT 'working'",
      notes: 'TEXT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'raw_materials',
    create: `CREATE TABLE IF NOT EXISTS raw_materials (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      sku VARCHAR(100),
      name VARCHAR(200) NOT NULL,
      category VARCHAR(100) DEFAULT 'Bahan Umum',
      unit VARCHAR(50) NOT NULL DEFAULT 'gram',
      current_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
      minimum_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
      cost_per_unit NUMERIC(14, 2) NOT NULL DEFAULT 0,
      supplier VARCHAR(150),
      description TEXT,
      status VARCHAR(50) DEFAULT 'Aman',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      sku: 'VARCHAR(100)',
      name: "VARCHAR(200) NOT NULL DEFAULT ''",
      category: "VARCHAR(100) DEFAULT 'Bahan Umum'",
      unit: "VARCHAR(50) NOT NULL DEFAULT 'gram'",
      current_stock: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      minimum_stock: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      cost_per_unit: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      supplier: 'VARCHAR(150)',
      description: 'TEXT',
      status: "VARCHAR(50) DEFAULT 'Aman'",
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'product_recipes',
    create: `CREATE TABLE IF NOT EXISTS product_recipes (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      product_name VARCHAR(200),
      raw_material_id INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE,
      quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
      unit VARCHAR(50) NOT NULL DEFAULT 'gram',
      custom_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      product_id: 'INTEGER REFERENCES products(id) ON DELETE CASCADE',
      product_name: 'VARCHAR(200)',
      raw_material_id: 'INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE',
      quantity: 'NUMERIC(10, 2) NOT NULL DEFAULT 1',
      unit: "VARCHAR(50) NOT NULL DEFAULT 'gram'",
      custom_note: 'TEXT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'stock_opname_sessions',
    create: `CREATE TABLE IF NOT EXISTS stock_opname_sessions (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      code VARCHAR(100) NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checker VARCHAR(150) NOT NULL,
      notes TEXT,
      total_items_checked INTEGER NOT NULL DEFAULT 0,
      items_with_diff INTEGER NOT NULL DEFAULT 0,
      total_loss_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'completed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      code: "VARCHAR(100) NOT NULL DEFAULT ''",
      date: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      checker: "VARCHAR(150) NOT NULL DEFAULT 'Admin'",
      notes: 'TEXT',
      total_items_checked: 'INTEGER NOT NULL DEFAULT 0',
      items_with_diff: 'INTEGER NOT NULL DEFAULT 0',
      total_loss_value: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      status: "VARCHAR(50) NOT NULL DEFAULT 'completed'",
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      updated_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'stock_opname_items',
    create: `CREATE TABLE IF NOT EXISTS stock_opname_items (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES stock_opname_sessions(id) ON DELETE CASCADE,
      raw_material_id INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE,
      raw_material_name VARCHAR(200),
      unit VARCHAR(50),
      cost_per_unit NUMERIC(14, 2) NOT NULL DEFAULT 0,
      system_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
      physical_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
      difference NUMERIC(14, 2) NOT NULL DEFAULT 0,
      loss_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
      beban_category VARCHAR(100),
      reason_label VARCHAR(150),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      session_id: 'INTEGER REFERENCES stock_opname_sessions(id) ON DELETE CASCADE',
      raw_material_id: 'INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE',
      raw_material_name: 'VARCHAR(200)',
      unit: 'VARCHAR(50)',
      cost_per_unit: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      system_stock: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      physical_stock: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      difference: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      loss_value: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      beban_category: 'VARCHAR(100)',
      reason_label: 'VARCHAR(150)',
      notes: 'TEXT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
  {
    name: 'stock_mutations',
    create: `CREATE TABLE IF NOT EXISTS stock_mutations (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      raw_material_id INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE,
      raw_material_name VARCHAR(200),
      type VARCHAR(50) NOT NULL,
      change_amount NUMERIC(14, 2) NOT NULL,
      current_stock NUMERIC(14, 2) NOT NULL DEFAULT 0,
      unit VARCHAR(50),
      cost_per_unit NUMERIC(14, 2) DEFAULT 0,
      beban_category VARCHAR(100),
      beban_amount NUMERIC(14, 2) DEFAULT 0,
      reference VARCHAR(150),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    columns: {
      merchant_id: 'INTEGER REFERENCES merchants(id) ON DELETE CASCADE',
      raw_material_id: 'INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE',
      raw_material_name: 'VARCHAR(200)',
      type: "VARCHAR(50) NOT NULL DEFAULT 'adjustment'",
      change_amount: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      current_stock: 'NUMERIC(14, 2) NOT NULL DEFAULT 0',
      unit: 'VARCHAR(50)',
      cost_per_unit: 'NUMERIC(14, 2) DEFAULT 0',
      beban_category: 'VARCHAR(100)',
      beban_amount: 'NUMERIC(14, 2) DEFAULT 0',
      reference: 'VARCHAR(150)',
      notes: 'TEXT',
      created_at: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    },
  },
];

async function ensureAndVerifyColumns(client) {
  for (const table of tables) {
    await client.query(table.create);
    for (const [column, definition] of Object.entries(table.columns)) {
      await client.query(
        `ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${column} ${definition}`
      );
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

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(790241, 2)');

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(150) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [VERSION]
    );

    // Reconcile missing tables/columns
    await ensureAndVerifyColumns(client);

    if (applied.rowCount > 0) {
      await client.query('COMMIT');
      console.log(`Migration ${VERSION} already applied; checked tables and columns.`);
      return;
    }

    // Indexes & Constraints for Attendance
    const attendanceIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_attendances_merchant_id ON attendances (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances (date)',
      'CREATE INDEX IF NOT EXISTS idx_attendances_user_id ON attendances (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_attendances_merchant_date ON attendances (merchant_id, date)',
    ];
    for (const index of attendanceIndexes) await client.query(index);

    // Indexes & Constraints for Inventory (Raw Materials & Recipes)
    const inventoryIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_raw_materials_merchant_id ON raw_materials (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_raw_materials_category ON raw_materials (category)',
      'CREATE INDEX IF NOT EXISTS idx_product_recipes_merchant_id ON product_recipes (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_product_recipes_product_id ON product_recipes (product_id)',
      'CREATE INDEX IF NOT EXISTS idx_product_recipes_material_id ON product_recipes (raw_material_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS product_recipes_unique_item ON product_recipes (merchant_id, product_id, raw_material_id)',
    ];
    for (const index of inventoryIndexes) await client.query(index);

    // Indexes & Constraints for Stock Opname & Mutations
    const opnameIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_opname_sessions_merchant_id ON stock_opname_sessions (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_opname_sessions_date ON stock_opname_sessions (date)',
      'CREATE INDEX IF NOT EXISTS idx_opname_items_session_id ON stock_opname_items (session_id)',
      'CREATE INDEX IF NOT EXISTS idx_opname_items_material_id ON stock_opname_items (raw_material_id)',
      'CREATE INDEX IF NOT EXISTS idx_stock_mutations_merchant_id ON stock_mutations (merchant_id)',
      'CREATE INDEX IF NOT EXISTS idx_stock_mutations_material_id ON stock_mutations (raw_material_id)',
      'CREATE INDEX IF NOT EXISTS idx_stock_mutations_type ON stock_mutations (type)',
      'CREATE INDEX IF NOT EXISTS idx_stock_mutations_created_at ON stock_mutations (created_at)',
    ];
    for (const index of opnameIndexes) await client.query(index);

    // Seed default Café Raw Materials for existing merchants if raw_materials is empty
    const checkMatRes = await client.query('SELECT COUNT(*) FROM raw_materials');
    if (parseInt(checkMatRes.rows[0].count, 10) === 0) {
      console.log('Seeding initial raw materials for merchant 1...');
      const defaultMaterials = [
        ['BHK-KOP-01', 'Biji Kopi Arabika House Blend', 'Biji Kopi & Espresso', 'gram', 3500, 1000, 280, 'Roastery Nusantara', 'Campuran Arabika Gayo & Mandheling medium-dark roast', 'Aman'],
        ['BHK-MILK-01', 'Susu Fresh Milk Full Cream', 'Susu & Dairy', 'ml', 12000, 4000, 24, 'Greenfield Dairy', 'Fresh pasteurized milk kemasan 1 Liter', 'Aman'],
        ['BHK-SYR-01', 'Sirup Karamel Gourmet', 'Sirup & Perisa', 'ml', 450, 600, 85, 'Monin Official', 'Sirup karamel botol 750ml untuk macchiato', 'Menipis'],
        ['BHK-SYR-02', 'Sirup Vanilla Madagaskar', 'Sirup & Perisa', 'ml', 1400, 600, 85, 'Monin Official', 'Sirup perisa vanila lembut premium', 'Aman'],
        ['BHK-SWT-01', 'Gula Aren Cair Organik', 'Pemanis & Gula', 'ml', 2800, 1000, 35, 'Aren Manis Lestari', 'Gula aren nira murni kental tanpa pemanis buatan', 'Aman'],
        ['BHK-POW-01', 'Matcha Uji Premium Powder', 'Powder & Bubuk', 'gram', 180, 300, 480, 'Kyoto Import Tea', 'Bubuk green tea matcha asli Kyoto ceremonial grade', 'Menipis'],
        ['BHK-POW-02', 'Cokelat Bubuk Belgia Dark', 'Powder & Bubuk', 'gram', 1100, 500, 220, 'Barry Callebaut', 'Pure cocoa powder dark 100% tanpa ampas', 'Aman'],
        ['BHK-PKG-01', 'Paper Cup Hot 8oz', 'Packaging & Kemasan', 'pcs', 420, 150, 850, 'Mitra Kemasan Utama', 'Gelas kertas kraft double wall tahan panas', 'Aman'],
        ['BHK-PKG-02', 'Plastic Cup Cold 12oz & Strawless Lid', 'Packaging & Kemasan', 'pcs', 85, 200, 1250, 'Mitra Kemasan Utama', 'Cup plastik tebal cold drink + tutup sips lid', 'Menipis'],
        ['BHK-PKG-03', 'Sedotan Kertas Steril 8mm', 'Packaging & Kemasan', 'pcs', 0, 100, 180, 'Eco Straw Nusantara', 'Sedotan ramah lingkungan steril bungkus kertas', 'Habis'],
      ];

      for (const m of defaultMaterials) {
        await client.query(
          `INSERT INTO raw_materials (merchant_id, sku, name, category, unit, current_stock, minimum_stock, cost_per_unit, supplier, description, status)
           VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT DO NOTHING`,
          m
        );
      }

      // Record initial stock mutations
      await client.query(`
        INSERT INTO stock_mutations (merchant_id, raw_material_id, raw_material_name, type, change_amount, current_stock, unit, cost_per_unit, reference, notes)
        SELECT merchant_id, id, name, 'initial_stock', current_stock, current_stock, unit, cost_per_unit, 'INIT-MIGRATION', 'Stok awal sistem inventori'
        FROM raw_materials
        WHERE current_stock > 0
      `);

      console.log('Seeded 10 standard raw materials successfully.');
    }

    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [VERSION]);
    await client.query('COMMIT');
    console.log(`Migration ${VERSION} applied successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed; transaction rolled back:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
