const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/merchants: Mengambil seluruh daftar coffee shop / merchant beserta statistik live
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = `
      SELECT 
        m.id,
        m.name,
        m.slug,
        m.category,
        m.address,
        m.city,
        m.phone,
        m.email,
        m.logo_url,
        m.color,
        m.plan,
        m.billing_cycle,
        m.status,
        m.is_active,
        m.created_at,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'admin') AS admin_count,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role IN ('kasir', 'barista', 'kitchen')) AS cashier_count,
        COUNT(DISTINCT p.id) AS total_products,
        COUNT(DISTINCT st.id) AS total_transactions,
        COALESCE(SUM(st.total_amount), 0) AS total_revenue
      FROM merchants m
      LEFT JOIN users u ON u.merchant_id = m.id AND u.is_active = true
      LEFT JOIN products p ON p.merchant_id = m.id
      LEFT JOIN sales_transactions st ON st.merchant_id = m.id
    `;

    const params = [];
    // Jika bukan super_admin, hanya bisa melihat merchant miliknya sendiri
    if (req.user.role !== 'super_admin') {
      params.push(req.user.merchant_id || 1);
      query += ` WHERE m.id = $${params.length}`;
    }

    query += `
      GROUP BY m.id
      ORDER BY m.id ASC
    `;

    const result = await pool.query(query, params);

    const formatted = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category || 'Coffee Shop',
      address: row.address,
      city: row.city,
      phone: row.phone,
      email: row.email,
      logoUrl: row.logo_url,
      color: row.color || 'bg-amber-100 text-amber-700',
      logoText: (row.name || 'PO').substring(0, 2).toUpperCase(),
      plan: row.plan || 'Enterprise Multi-Outlet Plan',
      billingCycle: row.billing_cycle || 'Tahunan',
      status: row.is_active ? 'Active' : 'Inactive',
      isActive: row.is_active,
      adminCount: parseInt(row.admin_count, 10) || 0,
      cashierCount: parseInt(row.cashier_count, 10) || 0,
      maxCashiers: 10,
      terminalCount: 3,
      maxTerminals: 5,
      totalProducts: parseInt(row.total_products, 10) || 0,
      totalTransactions: parseInt(row.total_transactions, 10) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      subscriptionExpiry: 'Aktif (Enterprise)',
      joinedDate: new Date(row.created_at).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching merchants:', error.message);
    res.status(500).json({ message: 'Gagal memuat daftar coffee shop.' });
  }
});

// GET /api/merchants/:id: Detail satu merchant
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validasi otorisasi
    if (req.user.role !== 'super_admin' && req.user.merchant_id !== parseInt(id, 10)) {
      return res.status(403).json({ message: 'Akses ditolak ke data coffee shop ini.' });
    }

    const query = `
      SELECT 
        m.*,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'admin') AS admin_count,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role IN ('kasir', 'barista', 'kitchen')) AS cashier_count,
        COUNT(DISTINCT p.id) AS total_products,
        COUNT(DISTINCT st.id) AS total_transactions,
        COALESCE(SUM(st.total_amount), 0) AS total_revenue
      FROM merchants m
      LEFT JOIN users u ON u.merchant_id = m.id AND u.is_active = true
      LEFT JOIN products p ON p.merchant_id = m.id
      LEFT JOIN sales_transactions st ON st.merchant_id = m.id
      WHERE m.id = $1
      GROUP BY m.id
    `;

    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Coffee shop tidak ditemukan.' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      address: row.address,
      city: row.city,
      phone: row.phone,
      email: row.email,
      logoUrl: row.logo_url,
      color: row.color,
      plan: row.plan,
      billingCycle: row.billing_cycle,
      status: row.is_active ? 'Active' : 'Inactive',
      isActive: row.is_active,
      adminCount: parseInt(row.admin_count, 10) || 0,
      cashierCount: parseInt(row.cashier_count, 10) || 0,
      totalProducts: parseInt(row.total_products, 10) || 0,
      totalTransactions: parseInt(row.total_transactions, 10) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('Error fetching merchant detail:', error.message);
    res.status(500).json({ message: 'Gagal memuat detail coffee shop.' });
  }
});

// POST /api/merchants: Membuat Coffee Shop / Merchant Baru (Super Admin Only)
router.post('/', verifyToken, requireRole('super_admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      name,
      category,
      city,
      address,
      phone,
      email,
      color,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nama Coffee Shop wajib diisi.' });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

    const insertMerchant = await client.query(
      `INSERT INTO merchants (name, slug, category, address, city, phone, email, color, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', true)
       RETURNING *`,
      [
        name.trim(),
        slug,
        category || 'Coffee Shop',
        address || '',
        city || '',
        phone || '',
        email || adminEmail || '',
        color || 'bg-amber-100 text-amber-700',
      ]
    );

    const newMerchant = insertMerchant.rows[0];

    // Buat akun Admin Cafe untuk merchant baru jika email & password diisi
    let createdAdmin = null;
    const targetAdminEmail = adminEmail || email;
    if (targetAdminEmail && targetAdminEmail.trim()) {
      const passwordToHash = adminPassword || 'admin123';
      const hash = await bcrypt.hash(passwordToHash.trim(), 10);
      const insertUser = await client.query(
        `INSERT INTO users (name, email, password_hash, role, merchant_id, is_active)
         VALUES ($1, $2, $3, 'admin', $4, true)
         RETURNING id, name, email, role, merchant_id`,
        [
          adminName || `Admin ${name.trim()}`,
          targetAdminEmail.trim().toLowerCase(),
          hash,
          newMerchant.id,
        ]
      );
      createdAdmin = insertUser.rows[0];
    }

    // Buat default receipt settings untuk merchant baru
    await client.query(
      `INSERT INTO receipt_settings (merchant_id, cafe_name, address, phone_number, header_note, footer_note)
       VALUES ($1, $2, $3, $4, 'Selamat Menikmati', 'Terima Kasih Telah Berkunjung')
       ON CONFLICT DO NOTHING`,
      [newMerchant.id, name.trim(), address || '', phone || '']
    );

    // Salin kategori default dasar (Minuman Barista & Makanan Dapur)
    const catBarista = await client.query(
      `INSERT INTO categories (name, description, station, merchant_id)
       VALUES ('Coffee & Beverages', 'Kategori Minuman Kopi & Non-Kopi', 'barista', $1)
       RETURNING id`,
      [newMerchant.id]
    );
    const catKitchen = await client.query(
      `INSERT INTO categories (name, description, station, merchant_id)
       VALUES ('Food & Pastry', 'Kategori Makanan & Camilan Dapur', 'kitchen', $1)
       RETURNING id`,
      [newMerchant.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Coffee Shop dan ekosistem merchant berhasil dibuat.',
      merchant: newMerchant,
      admin: createdAdmin,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating merchant:', error);
    res.status(500).json({ message: 'Gagal membuat merchant baru: ' + error.message });
  } finally {
    client.release();
  }
});

// PUT /api/merchants/:id: Update Coffee Shop
router.put('/:id', verifyToken, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, city, address, phone, email, color, plan, billing_cycle } = req.body;

    // Admin hanya bisa update merchant miliknya
    if (req.user.role !== 'super_admin' && req.user.merchant_id !== parseInt(id, 10)) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    const result = await pool.query(
      `UPDATE merchants 
       SET 
         name = COALESCE($1, name),
         category = COALESCE($2, category),
         city = COALESCE($3, city),
         address = COALESCE($4, address),
         phone = COALESCE($5, phone),
         email = COALESCE($6, email),
         color = COALESCE($7, color),
         plan = COALESCE($8, plan),
         billing_cycle = COALESCE($9, billing_cycle),
         updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [name, category, city, address, phone, email, color, plan, billing_cycle, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Coffee shop tidak ditemukan.' });
    }

    res.json({
      message: 'Data coffee shop berhasil diperbarui.',
      merchant: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating merchant:', error);
    res.status(500).json({ message: 'Gagal memperbarui data coffee shop.' });
  }
});

// PATCH /api/merchants/:id/status: Mengubah status aktif/nonaktif merchant (Super Admin)
router.patch('/:id/status', verifyToken, requireRole('super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await pool.query(
      `UPDATE merchants 
       SET is_active = $1, status = CASE WHEN $1 = true THEN 'Active' ELSE 'Inactive' END, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, name, is_active, status`,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Coffee shop tidak ditemukan.' });
    }

    res.json({
      message: `Status coffee shop ${result.rows[0].name} berhasil diubah menjadi ${result.rows[0].status}.`,
      merchant: result.rows[0],
    });
  } catch (error) {
    console.error('Error toggling merchant status:', error);
    res.status(500).json({ message: 'Gagal mengubah status coffee shop.' });
  }
});

// GET /api/merchants/:id/receipt-settings: Ambil pengaturan struk merchant
router.get('/:id/receipt-settings', verifyToken, async (req, res) => {
  try {
    const merchantId = req.params.id;
    const result = await pool.query(
      `SELECT * FROM receipt_settings WHERE merchant_id = $1 ORDER BY id ASC LIMIT 1`,
      [merchantId]
    );
    if (result.rows.length === 0) {
      return res.json({
        merchant_id: parseInt(merchantId, 10),
        store_name: 'POSAN Coffee',
        header_title: 'POSAN Coffee',
        store_address: '',
        store_phone: '',
        header_subtitle: '',
        show_order_type: true,
        show_cashier_name: true,
        show_date_time: true,
        bank_info: 'BCA : 034-392-4680\nA.N POSAN Cafe',
        thank_you_message: 'Terimakasih Kak.',
        footer_note: 'Powered by POSAN POS',
        paper_size: '58mm',
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fetch merchant receipt settings error:', error);
    res.status(500).json({ message: 'Gagal mengambil pengaturan struk.' });
  }
});

// PUT /api/merchants/:id/receipt-settings: Update pengaturan struk merchant
router.put('/:id/receipt-settings', verifyToken, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const merchantId = req.params.id;
    const {
      store_name = 'POSAN Coffee',
      store_address = '',
      store_phone = '',
      header_title = 'POSAN Coffee',
      header_subtitle = '',
      show_order_type = true,
      show_cashier_name = true,
      show_date_time = true,
      bank_info = 'BCA : 034-392-4680\nA.N POSAN Cafe',
      thank_you_message = 'Terimakasih Kak.',
      footer_note = 'Powered by POSAN POS',
      paper_size = '58mm',
    } = req.body;

    const checkRes = await pool.query('SELECT id, footer_note FROM receipt_settings WHERE merchant_id = $1 LIMIT 1', [merchantId]);
    const isSuperAdmin = req.user && (req.user.role === 'super_admin' || req.user.role === 'superadmin');

    let result;
    if (checkRes.rows.length === 0) {
      const finalFooterNote = isSuperAdmin ? footer_note : 'Powered by POSAN POS';
      result = await pool.query(
        `INSERT INTO receipt_settings (
          merchant_id, store_name, store_address, store_phone, header_title, header_subtitle,
          show_order_type, show_cashier_name, show_date_time,
          bank_info, thank_you_message, footer_note, paper_size, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        RETURNING *`,
        [
          merchantId,
          store_name,
          store_address,
          store_phone,
          header_title,
          header_subtitle,
          Boolean(show_order_type),
          Boolean(show_cashier_name),
          Boolean(show_date_time),
          bank_info,
          thank_you_message,
          finalFooterNote,
          paper_size,
        ]
      );
    } else {
      const existingId = checkRes.rows[0].id;
      const finalFooterNote = isSuperAdmin ? footer_note : (checkRes.rows[0].footer_note || 'Powered by POSAN POS');

      result = await pool.query(
        `UPDATE receipt_settings
         SET store_name = $1,
             store_address = $2,
             store_phone = $3,
             header_title = $4,
             header_subtitle = $5,
             show_order_type = $6,
             show_cashier_name = $7,
             show_date_time = $8,
             bank_info = $9,
             thank_you_message = $10,
             footer_note = $11,
             paper_size = $12,
             updated_at = NOW()
         WHERE id = $13
         RETURNING *`,
        [
          store_name,
          store_address,
          store_phone,
          header_title,
          header_subtitle,
          Boolean(show_order_type),
          Boolean(show_cashier_name),
          Boolean(show_date_time),
          bank_info,
          thank_you_message,
          finalFooterNote,
          paper_size,
          existingId,
        ]
      );
    }

    res.json({
      message: 'Pengaturan header & footer struk berhasil disimpan.',
      settings: result.rows[0],
    });
  } catch (error) {
    console.error('Update merchant receipt settings error:', error);
    res.status(500).json({ message: 'Gagal memperbarui pengaturan struk.' });
  }
});

module.exports = router;
