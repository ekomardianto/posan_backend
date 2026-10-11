const pool = require('../../db');

async function updateImages() {
  const images = {
    'butterscotch latte': 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=80',
    'taro latte': 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500&auto=format&fit=crop&q=80',
    'coffe cheescake': 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500&auto=format&fit=crop&q=80',
    'cheesecake': 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500&auto=format&fit=crop&q=80',
    'americano': 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80',
    'iced americano': 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=500&auto=format&fit=crop&q=80',
    'kopi susu aren': 'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?w=500&auto=format&fit=crop&q=80',
    'caramel macchiato': 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=500&auto=format&fit=crop&q=80',
    'matcha latte': 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&auto=format&fit=crop&q=80',
    'butter croissant': 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=80',
    'almond croissant': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=80'
  };

  const prods = await pool.query('SELECT id, name, image_url FROM products;');
  for (const p of prods.rows) {
    if (!p.image_url || p.image_url.trim() === '') {
      const lower = p.name.toLowerCase();
      let matched = null;
      for (const [k, v] of Object.entries(images)) {
        if (lower.includes(k) || k.includes(lower)) {
          matched = v;
          break;
        }
      }
      if (!matched) {
        if (lower.includes('latte') || lower.includes('kopi') || lower.includes('coffee') || lower.includes('coffe') || lower.includes('cappuccino') || lower.includes('espresso')) {
          matched = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=80';
        } else if (lower.includes('tea') || lower.includes('teh') || lower.includes('matcha') || lower.includes('taro') || lower.includes('chocolate') || lower.includes('cokelat')) {
          matched = 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500&auto=format&fit=crop&q=80';
        } else {
          matched = 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=80';
        }
      }
      await pool.query('UPDATE products SET image_url = $1 WHERE id = $2;', [matched, p.id]);
      console.log(`Updated product ID ${p.id} (${p.name}) with photo`);
    }
  }

  const check = await pool.query('SELECT id, name, merchant_id, image_url FROM products ORDER BY id ASC;');
  console.log(check.rows);
  process.exit(0);
}

updateImages().catch(e => {
  console.error(e);
  process.exit(1);
});
