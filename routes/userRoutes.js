const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verifyToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

const VALID_ROLES = ['kasir', 'admin', 'super_admin', 'barista', 'kitchen'];

// GET /api/users: Mengambil seluruh pengguna terisolasi per Coffee Shop (Admin Cafe & Super Admin)
router.get('/', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { role } = req.query;
    const merchantId = getTenantMerchantId(req);

    let query = `
      SELECT u.id, u.name, u.email, u.role, u.merchant_id, u.is_active, u.created_at,
             m.name AS merchant_name, m.slug AS merchant_slug
      FROM users u
      LEFT JOIN merchants m ON m.id = u.merchant_id
    `;
    const whereConditions = [];
    const params = [];

    // Filter berdasarkan merchant
    if (merchantId && req.user.role !== 'super_admin') {
      params.push(merchantId);
      whereConditions.push(`u.merchant_id = $${params.length}`);
    } else if (req.query.merchant_id && req.user.role === 'super_admin') {
      params.push(req.query.merchant_id);
      whereConditions.push(`u.merchant_id = $${params.length}`);
    }

    // Jika user adalah Admin Cafe, batasi agar tidak dapat melihat akun Super Admin
    if (req.user.role === 'admin') {
      params.push('super_admin');
      whereConditions.push(`u.role != $${params.length}`);
    }

    if (role && VALID_ROLES.includes(role)) {
      params.push(role);
      whereConditions.push(`u.role = $${params.length}`);
    }

    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }

    query += ' ORDER BY u.id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch users error:', error.message);
    res.status(500).json({ message: 'Gagal memuat data pengguna.' });
  }
});

// GET /api/users/:id: Mengambil profil satu pengguna
router.get('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = getTenantMerchantId(req);

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.merchant_id, u.is_active, u.created_at,
              m.name AS merchant_name
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       WHERE u.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }

    const targetUser = result.rows[0];

    // Proteksi: Admin Cafe dilarang melihat data Coffee Shop lain atau akun Super Admin
    if (req.user.role !== 'super_admin') {
      if (targetUser.role === 'super_admin' || (merchantId && targetUser.merchant_id !== merchantId)) {
        return res.status(403).json({
          message: 'Akses ditolak. Anda tidak memiliki izin mengakses data pengguna ini.',
        });
      }
    }

    res.json(targetUser);
  } catch (error) {
    console.error('Fetch user detail error:', error.message);
    res.status(500).json({ message: 'Gagal memuat detail pengguna.' });
  }
});

// POST /api/users: Menambahkan staf baru (Kasir, Barista, Kitchen, Admin Cafe)
router.post('/', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, email, password, role, merchant_id } = req.body;
    let targetMerchantId = req.user.merchant_id || 1;

    // Super Admin bisa memilih merchant_id saat membuat user
    if (req.user.role === 'super_admin') {
      if (role === 'super_admin') {
        targetMerchantId = null;
      } else if (merchant_id) {
        targetMerchantId = parseInt(merchant_id, 10);
      }
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nama lengkap wajib diisi.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Alamat email wajib diisi.' });
    }
    if (!password || password.trim().length < 6) {
      return res.status(400).json({ message: 'Kata sandi minimal 6 karakter.' });
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Role tidak valid. Pilihan role: ${VALID_ROLES.join(', ')}`,
      });
    }

    // Role escalation protection: Admin Cafe tidak boleh membuat Super Admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        message: 'Akses ditolak. Hanya Super Admin yang dapat membuat akun Super Admin baru.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password.trim(), 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, merchant_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, name, email, role, merchant_id, is_active, created_at`,
      [name.trim(), cleanEmail, passwordHash, role, targetMerchantId]
    );

    res.status(201).json({
      message: `Akun ${role} "${name}" berhasil dibuat.`,
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Create user error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email sudah terdaftar di sistem.' });
    }
    res.status(500).json({ message: 'Gagal membuat akun staf baru.' });
  }
});

// PUT /api/users/:id: Mengedit pengguna
router.put('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password, is_active, merchant_id } = req.body;
    const currentMerchantId = getTenantMerchantId(req);

    if (!name || !name.trim() || !email || !email.trim() || !role) {
      return res.status(400).json({ message: 'Nama, email, dan role wajib diisi.' });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid.' });
    }

    // Cek data target user di database terlebih dahulu
    const targetUserRes = await pool.query('SELECT id, role, email, merchant_id FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }
    const targetUser = targetUserRes.rows[0];

    // Proteksi: Admin Cafe tidak boleh mengedit akun Super Admin atau user merchant lain
    if (req.user.role !== 'super_admin') {
      if (targetUser.role === 'super_admin' || (currentMerchantId && targetUser.merchant_id !== currentMerchantId)) {
        return res.status(403).json({
          message: 'Akses ditolak. Anda tidak memiliki izin untuk mengedit pengguna ini.',
        });
      }
    }

    // Proteksi: Admin Cafe tidak boleh mengubah role user menjadi Super Admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        message: 'Akses ditolak. Admin Cafe tidak memiliki izin menetapkan role Super Admin.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    let targetMerchant = targetUser.merchant_id;
    if (req.user.role === 'super_admin' && merchant_id !== undefined) {
      targetMerchant = merchant_id ? parseInt(merchant_id, 10) : null;
    }

    let query, params;
    if (password && password.trim().length >= 6) {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      query = `
        UPDATE users
        SET name = $1, email = $2, role = $3, password_hash = $4, is_active = $5, merchant_id = $6
        WHERE id = $7
        RETURNING id, name, email, role, merchant_id, is_active, created_at
      `;
      params = [name.trim(), cleanEmail, role, passwordHash, is_active !== false, targetMerchant, id];
    } else {
      query = `
        UPDATE users
        SET name = $1, email = $2, role = $3, is_active = $4, merchant_id = $5
        WHERE id = $6
        RETURNING id, name, email, role, merchant_id, is_active, created_at
      `;
      params = [name.trim(), cleanEmail, role, is_active !== false, targetMerchant, id];
    }

    const result = await pool.query(query, params);

    res.json({
      message: 'Data staf berhasil diperbarui.',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Update user error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email sudah terdaftar.' });
    }
    res.status(500).json({ message: 'Gagal memperbarui pengguna.' });
  }
});

// PATCH /api/users/:id/status: Toggle status aktif/nonaktif
router.patch('/:id/status', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    const merchantId = getTenantMerchantId(req);

    const targetUserRes = await pool.query('SELECT id, role, merchant_id FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }
    const targetUser = targetUserRes.rows[0];

    if (req.user.role !== 'super_admin') {
      if (targetUser.role === 'super_admin' || (merchantId && targetUser.merchant_id !== merchantId)) {
        return res.status(403).json({ message: 'Akses ditolak.' });
      }
    }

    if (Number(id) === Number(req.user.id) && is_active === false) {
      return res.status(400).json({ message: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
    }

    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, name, email, role, merchant_id, is_active, created_at`,
      [Boolean(is_active), id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Toggle user status error:', error.message);
    res.status(500).json({ message: 'Gagal mengubah status pengguna.' });
  }
});

// DELETE /api/users/:id: Hapus pengguna secara aman
router.delete('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = getTenantMerchantId(req);

    const targetUserRes = await pool.query('SELECT id, role, name, merchant_id FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }
    const targetUser = targetUserRes.rows[0];

    if (req.user.role !== 'super_admin') {
      if (targetUser.role === 'super_admin' || (merchantId && targetUser.merchant_id !== merchantId)) {
        return res.status(403).json({ message: 'Akses ditolak.' });
      }
    }

    if (Number(id) === Number(req.user.id)) {
      return res.status(400).json({ message: 'Anda tidak dapat menghapus akun Anda sendiri.' });
    }

    const trxCheck = await pool.query(
      'SELECT COUNT(*)::int AS count FROM sales_transactions WHERE cashier_id = $1',
      [id]
    );

    if (trxCheck.rows[0].count > 0) {
      return res.status(409).json({
        message: 'Pengguna tidak dapat dihapus karena tercatat dalam riwayat transaksi. Anda dapat menonaktifkannya.',
      });
    }

    const deleteRes = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, name', [id]);

    res.json({
      message: `Pengguna "${deleteRes.rows[0].name}" berhasil dihapus.`,
      id: deleteRes.rows[0].id,
    });
  } catch (error) {
    console.error('Delete user error:', error.message);
    res.status(500).json({ message: 'Gagal menghapus pengguna.' });
  }
});

module.exports = router;
