const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { JWT_SECRET, verifyToken, requireRole } = require('../middleware/authMiddleware');

const VALID_ROLES = ['kasir', 'admin', 'super_admin', 'barista', 'kitchen'];

// POST: Login untuk semua 5 role (kasir, admin, super_admin, barista, kitchen)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.trim() || !password || !password.trim()) {
      return res.status(400).json({
        message: 'Email dan kata sandi wajib diisi.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    console.log(`[AUTH LOGIN ATTEMPT] email: "${cleanEmail}", password length: ${password ? password.length : 0}`);

    // Query user dari database PostgreSQL beserta data Coffee Shop / Merchant
    const userRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.merchant_id, u.is_active, u.phone, u.shift, u.auth_pin, u.created_at,
              m.name AS merchant_name, m.slug AS merchant_slug, m.category AS merchant_category, m.color AS merchant_color,
              m.address AS merchant_address, m.phone AS merchant_phone
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       WHERE LOWER(u.email) = $1`,
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      console.log(`[AUTH LOGIN FAILED] Email "${cleanEmail}" TIDAK DITEMUKAN di database PostgreSQL.`);
      return res.status(401).json({
        message: 'Email atau kata sandi tidak sesuai.',
      });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      console.log(`[AUTH LOGIN FAILED] Akun "${cleanEmail}" dinonaktifkan.`);
      return res.status(403).json({
        message: 'Akun ini telah dinonaktifkan. Silakan hubungi Administrator.',
      });
    }

    // Verifikasi password menggunakan bcrypt
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password.trim(), user.password_hash);
    } catch (cmpErr) {
      isMatch = false;
    }

    // Fallback 1: Cocokkan dengan PIN kasir / staf (auth_pin)
    if (!isMatch && user.auth_pin && user.auth_pin.trim() === password.trim()) {
      isMatch = true;
    }

    // Fallback 2: Legacy plain text password matching
    if (!isMatch && user.password_hash === password.trim()) {
      isMatch = true;
      // Re-hash password for security
      const newHash = await bcrypt.hash(password.trim(), 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    }

    if (!isMatch) {
      console.log(`[AUTH LOGIN FAILED] Kata sandi tidak cocok untuk email "${cleanEmail}".`);
      return res.status(401).json({
        message: 'Email atau kata sandi tidak sesuai.',
      });
    }

    console.log(`[AUTH LOGIN SUCCESS] Berhasil login: "${cleanEmail}" (Role: ${user.role}, Merchant: ${user.merchant_id})`);

    // Buat JWT Token aman
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        merchant_id: user.merchant_id,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: `Login berhasil sebagai ${user.role}.`,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        merchant_id: user.merchant_id,
        phone: user.phone || '',
        shift: user.shift || 'Shift Utama (08:00 - 17:00 WIB)',
        auth_pin: user.auth_pin || '889900',
        merchant: user.merchant_id
          ? {
              id: user.merchant_id,
              name: user.merchant_name || 'Coffee Shop POSAN',
              slug: user.merchant_slug,
              category: user.merchant_category,
              color: user.merchant_color,
              address: user.merchant_address,
              phone: user.merchant_phone,
            }
          : null,
        is_active: user.is_active,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Terjadi kesalahan pada server saat proses login.' });
  }
});

// GET: Mendapatkan profil user saat ini berdasarkan token
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.merchant_id, u.is_active, u.phone, u.shift, u.auth_pin, u.created_at,
              m.name AS merchant_name, m.slug AS merchant_slug, m.category AS merchant_category, m.color AS merchant_color,
              m.address AS merchant_address, m.phone AS merchant_phone
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }

    const u = userRes.rows[0];
    res.json({
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        merchant_id: u.merchant_id,
        phone: u.phone || '',
        shift: u.shift || 'Shift Utama (08:00 - 17:00 WIB)',
        auth_pin: u.auth_pin || '889900',
        merchant: u.merchant_id
          ? {
              id: u.merchant_id,
              name: u.merchant_name || 'Coffee Shop POSAN',
              slug: u.merchant_slug,
              category: u.merchant_category,
              color: u.merchant_color,
              address: u.merchant_address,
              phone: u.merchant_phone,
            }
          : null,
        is_active: u.is_active,
        created_at: u.created_at,
      },
    });
  } catch (error) {
    console.error('Me endpoint error:', error.message);
    res.status(500).json({ message: 'Gagal mengambil data profil.' });
  }
});

// PUT /api/auth/profile: Mengubah profil mandiri (Nama, Telepon, Shift, PIN)
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, phone, shift, auth_pin } = req.body;
    const userId = req.user.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nama lengkap tidak boleh kosong.' });
    }

    const updateRes = await pool.query(
      `UPDATE users 
       SET 
         name = $1,
         phone = COALESCE($2, phone),
         shift = COALESCE($3, shift),
         auth_pin = COALESCE($4, auth_pin)
       WHERE id = $5
       RETURNING id, name, email, role, merchant_id, phone, shift, auth_pin, is_active, created_at`,
      [name.trim(), phone ? phone.trim() : null, shift ? shift.trim() : null, auth_pin ? auth_pin.trim() : null, userId]
    );

    res.json({
      message: 'Profil berhasil diperbarui.',
      user: updateRes.rows[0],
    });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui profil: ' + error.message });
  }
});

// PUT /api/auth/change-password: Mengubah kata sandi akun
router.put('/change-password', verifyToken, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const userId = req.user.id;

    if (!new_password || new_password.trim().length < 6) {
      return res.status(400).json({ message: 'Kata sandi baru minimal 6 karakter.' });
    }

    if (old_password) {
      const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        const isMatch = await bcrypt.compare(old_password.trim(), userRes.rows[0].password_hash);
        if (!isMatch && userRes.rows[0].password_hash !== old_password.trim()) {
          return res.status(400).json({ message: 'Kata sandi lama tidak sesuai.' });
        }
      }
    }

    const newHash = await bcrypt.hash(new_password.trim(), 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    res.json({ message: 'Kata sandi berhasil diubah.' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ message: 'Gagal mengubah kata sandi.' });
  }
});

// POST: Pendaftaran akun staf baru oleh Admin/Super Admin
router.post('/create-user', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

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

    // Admin cafe tidak boleh membuat akun super_admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        message: 'Hanya Super Admin yang dapat membuat akun Super Admin baru.',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password.trim(), 10);

    const insertResult = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email, role, is_active, created_at`,
      [name.trim(), cleanEmail, passwordHash, role]
    );

    res.status(201).json({
      message: `Akun staf ${role} berhasil dibuat.`,
      user: insertResult.rows[0],
    });
  } catch (error) {
    console.error('Create user error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email sudah terdaftar di sistem POSAN.' });
    }
    res.status(500).json({ message: 'Gagal membuat akun staf baru.' });
  }
});

module.exports = router;
