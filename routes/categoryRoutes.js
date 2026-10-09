const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// GET: melihat semua kategori (Publik & Terautentikasi untuk offline sync)
router.get('/', optionalToken, async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req);
    const whereClause = merchantId ? 'WHERE c.merchant_id = $1' : '';
    const params = merchantId ? [merchantId] : [];

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.station, c.merchant_id, c.created_at,
              COUNT(p.id)::int AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       ${whereClause}
       GROUP BY c.id, c.name, c.description, c.station, c.merchant_id, c.created_at
       ORDER BY c.id ASC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Gagal mengambil kategori:', error.message);
    res.status(500).json({ message: 'Gagal mengambil kategori.' });
  }
});

// GET: melihat detail satu kategori berdasarkan ID
router.get('/:id', optionalToken, async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = getTenantMerchantId(req);

    let query = `
      SELECT c.id, c.name, c.description, c.station, c.merchant_id, c.created_at,
             COUNT(p.id)::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      WHERE c.id = $1
    `;
    const params = [id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND c.merchant_id = $${params.length}`;
    }

    query += ` GROUP BY c.id, c.name, c.description, c.station, c.merchant_id, c.created_at`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Kategori tidak ditemukan.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Gagal mengambil detail kategori:', error.message);
    res.status(500).json({ message: 'Gagal mengambil detail kategori.' });
  }
});

// POST: menambahkan kategori baru (HANYA Admin Cafe / Super Admin)
router.post('/', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, description, station } = req.body;
    const merchantId = getTenantMerchantId(req) || 1;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: 'Nama kategori wajib diisi.',
      });
    }

    let targetStation = 'barista';
    const sLower = (station || '').toString().toLowerCase().trim();
    if (['barista', 'kitchen', 'none'].includes(sLower)) {
      targetStation = sLower;
    } else if (['tidak', 'no', 'kasir', 'false', 'tanpa_dapur', 'no_kitchen'].includes(sLower)) {
      targetStation = 'none';
    } else {
      const lower = name.trim().toLowerCase();
      if (lower.includes('makan') || lower.includes('food') || lower.includes('pastry') || lower.includes('snack') || lower.includes('mie') || lower.includes('nasi') || lower.includes('roti')) {
        targetStation = 'kitchen';
      } else if (lower.includes('rokok') || lower.includes('merch') || lower.includes('retail') || lower.includes('voucher')) {
        targetStation = 'none';
      }
    }

    const result = await pool.query(
      `INSERT INTO categories (name, description, station, merchant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, station, merchant_id, created_at`,
      [name.trim(), description?.trim() || null, targetStation, merchantId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Gagal menambahkan kategori:', error.message);

    if (error.code === '23505') {
      return res.status(409).json({
        message: 'Nama kategori sudah digunakan pada Coffee Shop ini.',
      });
    }

    res.status(500).json({ message: 'Gagal menambahkan kategori.' });
  }
});

// PUT: mengedit kategori (HANYA Admin Cafe / Super Admin)
router.put('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, description, station } = req.body;
    const merchantId = getTenantMerchantId(req);

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: 'Nama kategori wajib diisi.',
      });
    }

    let targetStation = null;
    if (station !== undefined && station !== null) {
      const sLower = station.toString().toLowerCase().trim();
      if (['barista', 'kitchen', 'none'].includes(sLower)) {
        targetStation = sLower;
      } else if (['tidak', 'no', 'kasir', 'false', 'tanpa_dapur', 'no_kitchen'].includes(sLower)) {
        targetStation = 'none';
      }
    }

    let query, params;
    if (targetStation) {
      query = `UPDATE categories
               SET name = $1, description = $2, station = $3
               WHERE id = $4`;
      params = [name.trim(), description?.trim() || null, targetStation, req.params.id];
    } else {
      query = `UPDATE categories
               SET name = $1, description = $2
               WHERE id = $3`;
      params = [name.trim(), description?.trim() || null, req.params.id];
    }

    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }

    query += ` RETURNING id, name, description, station, merchant_id, created_at`;

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Kategori tidak ditemukan.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Gagal mengedit kategori:', error.message);
    res.status(500).json({ message: 'Gagal mengedit kategori.' });
  }
});

// DELETE: menghapus kategori (HANYA Admin Cafe / Super Admin)
router.delete('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = getTenantMerchantId(req);

    // Cek apakah masih ada produk yang menggunakan kategori ini
    const prodCheck = await pool.query(
      'SELECT COUNT(*)::int AS count FROM products WHERE category_id = $1',
      [id]
    );

    if (prodCheck.rows[0].count > 0) {
      return res.status(409).json({
        message: 'Kategori tidak dapat dihapus karena masih memiliki produk yang terkait.',
      });
    }

    let query = 'DELETE FROM categories WHERE id = $1';
    const params = [id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND merchant_id = $${params.length}`;
    }
    query += ' RETURNING id, name';

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Kategori tidak ditemukan.' });
    }

    res.json({ message: `Kategori "${result.rows[0].name}" berhasil dihapus.` });
  } catch (error) {
    console.error('Gagal menghapus kategori:', error.message);
    res.status(500).json({ message: 'Gagal menghapus kategori.' });
  }
});

module.exports = router;