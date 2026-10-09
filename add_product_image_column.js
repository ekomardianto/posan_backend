const pool = require('./db');

async function migrate() {
  try {
    console.log('Adding image_url column to products table if not exists...');
    await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;');
    
    console.log('Updating sample products with photos...');
    await pool.query(`
      UPDATE products 
      SET image_url = 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=400&auto=format&fit=crop&q=80' 
      WHERE LOWER(name) LIKE '%matcha%' AND (image_url IS NULL OR image_url = '');
    `);

    await pool.query(`
      UPDATE products 
      SET image_url = 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80' 
      WHERE LOWER(name) LIKE '%americano%' AND (image_url IS NULL OR image_url = '');
    `);

    await pool.query(`
      UPDATE products 
      SET image_url = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=400&auto=format&fit=crop&q=80' 
      WHERE LOWER(name) LIKE '%espresso%' AND (image_url IS NULL OR image_url = '');
    `);

    await pool.query(`
      UPDATE products 
      SET image_url = 'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=400&auto=format&fit=crop&q=80' 
      WHERE (LOWER(name) LIKE '%latte%' OR LOWER(name) LIKE '%cappuccino%') AND (image_url IS NULL OR image_url = '');
    `);

    console.log('Checking updated products...');
    const result = await pool.query('SELECT id, name, image_url FROM products ORDER BY id ASC;');
    console.log(result.rows);

    console.log('Migration & sample photos update completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
