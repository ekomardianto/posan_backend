const pool = require('../../db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('=== Checking and Updating Station Constraints ===');

    // 1. Inspect existing constraints on categories
    const catConstraints = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'categories' AND c.contype = 'c'
    `);
    console.log('Categories check constraints:', catConstraints.rows);

    for (const row of catConstraints.rows) {
      if (row.conname.includes('station')) {
        console.log(`Dropping constraint ${row.conname}...`);
        await client.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
    }

    console.log('Adding updated categories_station_check constraint...');
    await client.query(`
      ALTER TABLE categories 
      ADD CONSTRAINT categories_station_check 
      CHECK (station IN ('barista', 'kitchen', 'none'))
    `);
    console.log('✓ categories_station_check updated to allow barista, kitchen, none.');

    // 2. Inspect and update products table
    const prodConstraints = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'products' AND c.contype = 'c'
    `);
    console.log('Products check constraints:', prodConstraints.rows);

    for (const row of prodConstraints.rows) {
      if (row.conname.includes('station')) {
        console.log(`Dropping constraint ${row.conname}...`);
        await client.query(`ALTER TABLE products DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
    }

    await client.query(`
      ALTER TABLE products 
      ADD CONSTRAINT products_station_check 
      CHECK (station IS NULL OR station IN ('barista', 'kitchen', 'none'))
    `);
    console.log('✓ products_station_check updated.');

    // 3. Inspect and update transaction_items table
    const tiConstraints = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'transaction_items' AND c.contype = 'c'
    `);
    for (const row of tiConstraints.rows) {
      if (row.conname.includes('station')) {
        console.log(`Dropping constraint ${row.conname}...`);
        await client.query(`ALTER TABLE transaction_items DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
    }
    await client.query(`
      ALTER TABLE transaction_items 
      ADD CONSTRAINT transaction_items_station_check 
      CHECK (station IS NULL OR station IN ('barista', 'kitchen', 'none'))
    `);
    console.log('✓ transaction_items_station_check updated.');

    // 4. Inspect and update order_logs table
    const olConstraints = await client.query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'order_logs' AND c.contype = 'c'
    `);
    for (const row of olConstraints.rows) {
      if (row.conname.includes('station')) {
        console.log(`Dropping constraint ${row.conname}...`);
        await client.query(`ALTER TABLE order_logs DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      }
    }
    await client.query(`
      ALTER TABLE order_logs 
      ADD CONSTRAINT order_logs_station_check 
      CHECK (station IS NULL OR station IN ('barista', 'kitchen', 'none'))
    `);
    console.log('✓ order_logs_station_check updated.');

    console.log('=== Migration Complete! ===');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
