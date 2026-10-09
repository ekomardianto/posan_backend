const pool = require('./db');

async function seedFullMenu() {
  console.log('Seeding PostgreSQL with full POS catalog...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Categories
    const categories = [
      { name: 'Coffee', description: 'Aneka minuman kopi pilihan espresso, latte, & aren', station: 'barista' },
      { name: 'Non-Coffee', description: 'Aneka minuman teh, cokelat, matcha & mocktail', station: 'barista' },
      { name: 'Pastry', description: 'Aneka roti, croissant & bakery fresh', station: 'kitchen' },
      { name: 'Makanan', description: 'Menu makanan utama & hidangan cafe', station: 'kitchen' },
      { name: 'Snack', description: 'Camilan ringan & dessert', station: 'kitchen' },
    ];

    const catMap = {};

    for (const c of categories) {
      const existing = await client.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [c.name]);
      if (existing.rows.length > 0) {
        await client.query(
          'UPDATE categories SET description = $1, station = $2 WHERE id = $3',
          [c.description, c.station, existing.rows[0].id]
        );
        catMap[c.name.toLowerCase()] = existing.rows[0].id;
      } else {
        const res = await client.query(
          'INSERT INTO categories (name, description, station) VALUES ($1, $2, $3) RETURNING id',
          [c.name, c.description, c.station]
        );
        catMap[c.name.toLowerCase()] = res.rows[0].id;
      }
    }

    console.log('Categories synced:', catMap);

    // 2. Products
    const products = [
      { name: 'Kopi Susu Aren', cat: 'coffee', price: 18000, desc: 'Espresso dengan susu segar dan gula aren asli', station: 'barista' },
      { name: 'Butter Croissant', cat: 'pastry', price: 15000, desc: 'Croissant renyah berlapis mentega pilihan', station: 'kitchen' },
      { name: 'Caramel Latte', cat: 'coffee', price: 20000, desc: 'Espresso dengan foam susu dan sirup caramel premium', station: 'barista' },
      { name: 'Iced Matcha Latte', cat: 'non-coffee', price: 17000, desc: 'Matcha jepang autentik dengan fresh milk dingin', station: 'barista' },
      { name: 'Almond Croissant', cat: 'pastry', price: 18000, desc: 'Croissant panggang dengan taburan almond renyah', station: 'kitchen' },
      { name: 'Iced Americano', cat: 'coffee', price: 15000, desc: 'Double espresso dengan air dingin dan es segar', station: 'barista' },
      { name: 'Nasi Goreng Spesial', cat: 'makanan', price: 25000, desc: 'Nasi goreng cafe dengan telur mata sapi & ayam suwir', station: 'kitchen' },
      { name: 'Mie Goreng Posan', cat: 'makanan', price: 22000, desc: 'Mie goreng bumbu rempah khas cafe', station: 'kitchen' },
      { name: 'French Fries Crispy', cat: 'snack', price: 14000, desc: 'Kentang goreng renyah dengan saus cocolan', station: 'kitchen' },
      { name: 'Earl Grey Milk Tea', cat: 'non-coffee', price: 16000, desc: 'Teh Earl Grey aromatik dengan susu segar', station: 'barista' },
    ];

    for (const p of products) {
      const catId = catMap[p.cat] || Object.values(catMap)[0];
      const existing = await client.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1)', [p.name]);
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE products 
           SET category_id = $1, price = $2, description = $3, station = $4, is_active = true 
           WHERE id = $5`,
          [catId, p.price, p.desc, p.station, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO products (name, category_id, price, description, is_active, station)
           VALUES ($1, $2, $3, $4, true, $5)`,
          [p.name, catId, p.price, p.desc, p.station]
        );
      }
    }

    console.log(`Successfully seeded ${products.length} products to PostgreSQL.`);

    // 3. Payment Methods
    const paymentMethods = [
      { name: 'Tunai', is_active: true },
      { name: 'QRIS', is_active: true },
      { name: 'Transfer & EDC Bank', is_active: true },
      { name: 'Debit Card', is_active: true },
    ];

    for (const pm of paymentMethods) {
      const existing = await client.query('SELECT id FROM payment_methods WHERE LOWER(name) = LOWER($1)', [pm.name]);
      if (existing.rows.length > 0) {
        await client.query('UPDATE payment_methods SET is_active = $1 WHERE id = $2', [pm.is_active, existing.rows[0].id]);
      } else {
        await client.query('INSERT INTO payment_methods (name, is_active) VALUES ($1, $2)', [pm.name, pm.is_active]);
      }
    }

    await client.query('COMMIT');
    console.log('Seeding complete successfully!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seeding error:', e.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

seedFullMenu();
