const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// Helper function to resolve category_id from category_id or category name scoped to merchant
async function resolveCategoryId(categoryId, categoryName, merchantId) {
  if (categoryId) {
    let query = 'SELECT id FROM categories WHERE id = $1';
    const params = [categoryId];
    if (merchantId) {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }
    const catCheck = await pool.query(query, params);
    if (catCheck.rows.length > 0) {
      return catCheck.rows[0].id;
    }
  }

  if (categoryName && typeof categoryName === 'string' && categoryName.trim() && categoryName !== 'all') {
    let query = 'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)';
    const params = [categoryName.trim()];
    if (merchantId) {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }
    query += ' LIMIT 1';
    const catCheck = await pool.query(query, params);
    if (catCheck.rows.length > 0) {
      return catCheck.rows[0].id;
    }
  }

  return null;
}

// GET: Mengambil daftar produk beserta nama kategorinya (Multi-Tenant)
router.get('/', optionalToken, async (req, res) => {
  try {
    const { category_id, categoryId, station, is_active, status, search, limit, offset } = req.query;
    const merchantId = getTenantMerchantId(req);

    let query = `
      SELECT p.id,
             p.name,
             p.price,
             p.description,
             p.is_active,
             p.category_id,
             p.merchant_id,
             p.image_url,
             c.name AS category_name,
             COALESCE(p.station, c.station, 'barista') AS station,
             p.created_at
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
    `;

    const whereParts = [];
    const params = [];

    if (merchantId) {
      params.push(merchantId);
      whereParts.push(`p.merchant_id = $${params.length}`);
    }

    const targetCatId = category_id || categoryId;
    if (targetCatId) {
      params.push(targetCatId);
      whereParts.push(`p.category_id = $${params.length}`);
    }

    if (station) {
      const sLower = station.toLowerCase();
      if (['barista', 'kitchen', 'none'].includes(sLower)) {
        params.push(sLower);
        whereParts.push(`(p.station = $${params.length} OR (p.station IS NULL AND c.station = $${params.length}))`);
      }
    }

    if (is_active !== undefined) {
      const activeBool = is_active === true || is_active === 'true' || is_active === 1 || is_active === '1';
      params.push(activeBool);
      whereParts.push(`p.is_active = $${params.length}`);
    } else if (status) {
      const activeBool = status.toLowerCase() === 'aktif' || status.toLowerCase() === 'active';
      params.push(activeBool);
      whereParts.push(`p.is_active = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereParts.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }

    if (whereParts.length > 0) {
      query += ' WHERE ' + whereParts.join(' AND ');
    }

    query += ' ORDER BY p.id DESC';

    if (limit && Number(limit) > 0) {
      params.push(Number(limit));
      query += ` LIMIT $${params.length}`;
    }

    if (offset && Number(offset) >= 0) {
      params.push(Number(offset));
      query += ` OFFSET $${params.length}`;
    }

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Gagal mengambil produk:', error.message);
    res.status(500).json({ message: 'Gagal mengambil data produk.' });
  }
});

// GET: Mengambil detail satu produk berdasarkan ID
router.get('/:id', optionalToken, async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req);
    let query = `
      SELECT p.id,
             p.name,
             p.price,
             p.description,
             p.is_active,
             p.category_id,
             p.merchant_id,
             p.image_url,
             c.name AS category_name,
             COALESCE(p.station, c.station, 'barista') AS station,
             p.created_at
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
    `;
    const params = [req.params.id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND p.merchant_id = $${params.length}`;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Gagal mengambil detail produk:', error.message);
    res.status(500).json({ message: 'Gagal mengambil detail produk.' });
  }
});

// POST: Menambahkan produk baru (HANYA Admin Cafe / Super Admin)
router.post('/', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, price, category_id, categoryId, category, category_name, description, is_active, status, station, image_url, imageUrl, image } = req.body;
    const merchantId = getTenantMerchantId(req) || 1;

    // 1. Validasi nama produk
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nama produk wajib diisi.' });
    }

    // 2. Validasi harga
    const numericPrice = Number(price);
    if (price === undefined || price === null || isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ message: 'Harga produk harus berupa angka valid dan tidak boleh negatif.' });
    }

    // 3. Resolve category_id
    const targetCatId = category_id || categoryId;
    const targetCatName = category || category_name;
    const resolvedCatId = await resolveCategoryId(targetCatId, targetCatName, merchantId);

    // 4. Resolve is_active
    let isActive = true;
    if (typeof is_active === 'boolean') {
      isActive = is_active;
    } else if (typeof status === 'string') {
      isActive = status.toLowerCase() !== 'nonaktif';
    }

    // 5. Resolve station
    let targetStation = null;
    if (station) {
      const sLower = station.toLowerCase();
      if (['barista', 'kitchen', 'none'].includes(sLower)) {
        targetStation = sLower;
      }
    }

    // 6. Resolve image_url
    const finalImageUrl = image_url || imageUrl || image || null;

    const insertResult = await pool.query(
      `INSERT INTO products (name, price, category_id, description, is_active, station, merchant_id, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, price, category_id, description, is_active, station, merchant_id, image_url, created_at`,
      [name.trim(), numericPrice, resolvedCatId, description?.trim() || null, isActive, targetStation, merchantId, finalImageUrl]
    );

    const newProduct = insertResult.rows[0];

    // Ambil nama kategori untuk respons lengkap
    let catName = null;
    let finalStation = newProduct.station;
    if (newProduct.category_id) {
      const catRes = await pool.query('SELECT name, station FROM categories WHERE id = $1', [newProduct.category_id]);
      if (catRes.rows.length > 0) {
        catName = catRes.rows[0].name;
        if (!finalStation) finalStation = catRes.rows[0].station;
      }
    }

    res.status(201).json({
      ...newProduct,
      category_name: catName,
      station: finalStation || 'barista',
    });
  } catch (error) {
    console.error('Gagal menambahkan produk:', error.message);
    res.status(500).json({ message: 'Gagal menambahkan produk baru.' });
  }
});

// PUT: Mengedit data produk berdasarkan ID (HANYA Admin Cafe / Super Admin)
router.put('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category_id, categoryId, category, category_name, description, is_active, status, station, image_url, imageUrl, image } = req.body;
    const merchantId = getTenantMerchantId(req);

    // 1. Validasi nama produk
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nama produk wajib diisi.' });
    }

    // 2. Validasi harga
    const numericPrice = Number(price);
    if (price === undefined || price === null || isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ message: 'Harga produk harus berupa angka valid dan tidak boleh negatif.' });
    }

    // 3. Resolve category_id
    const targetCatId = category_id || categoryId;
    const targetCatName = category || category_name;
    const resolvedCatId = await resolveCategoryId(targetCatId, targetCatName, merchantId);

    // 4. Resolve is_active
    let isActive = true;
    if (typeof is_active === 'boolean') {
      isActive = is_active;
    } else if (typeof status === 'string') {
      isActive = status.toLowerCase() !== 'nonaktif';
    }

    // 5. Resolve station
    let targetStation = null;
    if (station) {
      const sLower = station.toLowerCase();
      if (['barista', 'kitchen', 'none'].includes(sLower)) {
        targetStation = sLower;
      }
    }

    const finalImageUrl = image_url !== undefined ? image_url : (imageUrl !== undefined ? imageUrl : (image !== undefined ? image : null));

    let query = `
      UPDATE products
      SET name = $1,
          price = $2,
          category_id = $3,
          description = $4,
          is_active = $5,
          station = $6,
          image_url = COALESCE($7, image_url)
      WHERE id = $8
    `;
    const params = [name.trim(), numericPrice, resolvedCatId, description?.trim() || null, isActive, targetStation, finalImageUrl, id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }

    query += ` RETURNING id, name, price, category_id, description, is_active, station, merchant_id, image_url, created_at`;

    const updateResult = await pool.query(query, params);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan.' });
    }

    const updatedProduct = updateResult.rows[0];

    let catName = null;
    let finalStation = updatedProduct.station;
    if (updatedProduct.category_id) {
      const catRes = await pool.query('SELECT name, station FROM categories WHERE id = $1', [updatedProduct.category_id]);
      if (catRes.rows.length > 0) {
        catName = catRes.rows[0].name;
        if (!finalStation) finalStation = catRes.rows[0].station;
      }
    }

    res.json({
      ...updatedProduct,
      category_name: catName,
      station: finalStation || 'barista',
    });
  } catch (error) {
    console.error('Gagal mengedit produk:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui produk.' });
  }
});

// PATCH: Mengubah status aktif/nonaktif produk
router.patch('/:id/status', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const merchantId = getTenantMerchantId(req);

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ message: 'Status is_active harus berupa boolean (true/false).' });
    }

    let query = 'UPDATE products SET is_active = $1 WHERE id = $2';
    const params = [is_active, id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }
    query += ' RETURNING id, name, price, is_active, station, image_url, merchant_id';

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Gagal mengubah status produk:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui status produk.' });
  }
});

// DELETE: Menghapus produk (HANYA Admin Cafe / Super Admin)
router.delete('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = getTenantMerchantId(req);

    // Cek apakah produk sedang digunakan di order_items yang belum selesai
    const itemCheck = await pool.query(
      `SELECT COUNT(*)::int AS count 
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.product_id = $1 AND o.status IN ('pending', 'processing', 'preparing', 'ready')`,
      [id]
    );

    if (itemCheck.rows[0].count > 0) {
      return res.status(409).json({
        message: 'Produk tidak dapat dihapus karena sedang berada dalam antrean pesanan aktif.',
      });
    }

    let query = 'DELETE FROM products WHERE id = $1';
    const params = [id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }
    query += ' RETURNING id, name';

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Produk tidak ditemukan.' });
    }

    res.json({ message: `Produk "${result.rows[0].name}" berhasil dihapus dari database.` });
  } catch (error) {
    console.error('Gagal menghapus produk:', error.message);
    res.status(500).json({ message: 'Gagal menghapus produk.' });
  }
});

module.exports = router;
