const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// Helper function to determine UI helper fields based on name
function getPaymentMethodMeta(name = '') {
  const lower = name.toLowerCase();
  if (lower.includes('tunai') || lower.includes('cash')) {
    return {
      type: 'Tunai',
      iconType: 'Banknote',
      provider: 'Kasir POSAN (Cash)',
      description: 'Pembayaran tunai langsung di kasir',
      fee: '0%',
    };
  }
  if (lower.includes('qris')) {
    return {
      type: 'QRIS',
      iconType: 'QrCode',
      provider: 'QRIS Standar Bank Indonesia',
      description: 'Pembayaran digital scan QRIS dinamis/statis',
      fee: '0.3% MDR',
    };
  }
  if (
    lower.includes('bank') ||
    lower.includes('transfer') ||
    lower.includes('debit') ||
    lower.includes('kartu') ||
    lower.includes('bca') ||
    lower.includes('mandiri') ||
    lower.includes('bni') ||
    lower.includes('bri')
  ) {
    return {
      type: 'Kartu',
      iconType: 'Building2',
      provider: 'EDC & Transfer Perbankan',
      description: 'Transfer bank / kartu debit EDC',
      fee: '0%',
    };
  }
  if (lower.includes('wallet') || lower.includes('gopay') || lower.includes('ovo') || lower.includes('dana') || lower.includes('shopeepay')) {
    return {
      type: 'E-Wallet',
      iconType: 'Smartphone',
      provider: 'Digital Wallet Gateway',
      description: 'Dompet digital e-wallet',
      fee: '1.5%',
    };
  }
  return {
    type: 'Lainnya',
    iconType: 'CreditCard',
    provider: 'Kanal Pembayaran POSAN',
    description: 'Metode pembayaran terdaftar',
    fee: '0%',
  };
}

// GET: Mengambil semua metode pembayaran (Global Master Data)
router.get('/', optionalToken, async (req, res) => {
  try {
    let query = `
      SELECT pm.id,
             pm.name,
             pm.is_active,
             pm.config,
             pm.created_at,
             COUNT(st.id)::int AS transaction_count
      FROM payment_methods pm
      LEFT JOIN sales_transactions st ON st.payment_method_id = pm.id
      GROUP BY pm.id, pm.name, pm.is_active, pm.config, pm.created_at
      ORDER BY pm.id ASC
    `;

    const result = await pool.query(query);

    const data = result.rows.map((row) => {
      const meta = getPaymentMethodMeta(row.name);
      return {
        id: row.id,
        name: row.name,
        is_active: row.is_active,
        status: row.is_active ? 'Active' : 'Inactive',
        type: meta.type,
        iconType: meta.iconType,
        provider: meta.provider,
        description: meta.description,
        fee: meta.fee,
        config: row.config || {},
        transaction_count: row.transaction_count,
        usedByCount: row.is_active ? 1 : 0,
        created_at: row.created_at,
      };
    });

    res.json(data);
  } catch (error) {
    console.error('Gagal mengambil metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal mengambil data metode pembayaran.' });
  }
});

// GET: Mengambil detail satu metode pembayaran
router.get('/:id', optionalToken, async (req, res) => {
  try {
    let query = `
      SELECT pm.id,
             pm.name,
             pm.is_active,
             pm.config,
             pm.created_at,
             COUNT(st.id)::int AS transaction_count
      FROM payment_methods pm
      LEFT JOIN sales_transactions st ON st.payment_method_id = pm.id
      WHERE pm.id = $1
      GROUP BY pm.id, pm.name, pm.is_active, pm.config, pm.created_at
    `;
    const params = [req.params.id];

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
    }

    const row = result.rows[0];
    const meta = getPaymentMethodMeta(row.name);

    res.json({
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      status: row.is_active ? 'Active' : 'Inactive',
      type: meta.type,
      iconType: meta.iconType,
      provider: meta.provider,
      description: meta.description,
      fee: meta.fee,
      config: row.config || {},
      transaction_count: row.transaction_count,
      usedByCount: row.is_active ? 1 : 0,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('Gagal mengambil detail metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal mengambil detail metode pembayaran.' });
  }
});

// POST: Menambahkan metode pembayaran baru (Global)
router.post('/', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, is_active, status, config } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: 'Nama metode pembayaran wajib diisi.',
      });
    }

    let isActive = true;
    if (typeof is_active === 'boolean') {
      isActive = is_active;
    } else if (typeof status === 'string') {
      isActive = status.toLowerCase() === 'active' || status.toLowerCase() === 'aktif';
    }

    const result = await pool.query(
      `INSERT INTO payment_methods (name, is_active, config)
       VALUES ($1, $2, $3)
       RETURNING id, name, is_active, config, created_at`,
      [name.trim(), isActive, JSON.stringify(config || {})]
    );

    const row = result.rows[0];
    const meta = getPaymentMethodMeta(row.name);

    res.status(201).json({
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      status: row.is_active ? 'Active' : 'Inactive',
      type: meta.type,
      iconType: meta.iconType,
      provider: meta.provider,
      description: meta.description,
      fee: meta.fee,
      config: row.config || {},
      transaction_count: 0,
      usedByCount: row.is_active ? 1 : 0,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('Gagal menambahkan metode pembayaran:', error.message);

    if (error.code === '23505') {
      return res.status(409).json({
        message: 'Nama metode pembayaran sudah digunakan.',
      });
    }

    res.status(500).json({ message: 'Gagal menambahkan metode pembayaran.' });
  }
});

// PUT: Mengedit metode pembayaran berdasarkan ID
router.put('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active, status, config } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: 'Nama metode pembayaran wajib diisi.',
      });
    }

    let isActive = true;
    if (typeof is_active === 'boolean') {
      isActive = is_active;
    } else if (typeof status === 'string') {
      isActive = status.toLowerCase() === 'active' || status.toLowerCase() === 'aktif';
    }

    let query = `
      UPDATE payment_methods
      SET name = $1, is_active = $2
    `;
    const params = [name.trim(), isActive];

    if (config !== undefined) {
      params.push(JSON.stringify(config));
      query += `, config = $${params.length}`;
    }

    params.push(id);
    query += ` WHERE id = $${params.length} RETURNING id, name, is_active, config, created_at`;

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
    }

    const row = result.rows[0];
    const meta = getPaymentMethodMeta(row.name);

    res.json({
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      status: row.is_active ? 'Active' : 'Inactive',
      type: meta.type,
      iconType: meta.iconType,
      provider: meta.provider,
      description: meta.description,
      fee: meta.fee,
      config: row.config || {},
      usedByCount: row.is_active ? 1 : 0,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('Gagal mengedit metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui metode pembayaran.' });
  }
});

// PUT: Memperbarui konfigurasi gateway/parameter payment method
router.put('/:id/config', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { config } = req.body;

    const result = await pool.query(
      'UPDATE payment_methods SET config = $1 WHERE id = $2 RETURNING id, name, is_active, config',
      [JSON.stringify(config || {}), id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
    }

    res.json({
      message: 'Konfigurasi metode pembayaran berhasil disimpan.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Gagal memperbarui config metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui konfigurasi metode pembayaran.' });
  }
});

// PATCH: Mengubah status aktif/nonaktif
router.patch('/:id/status', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, status } = req.body;

    let isActive = true;
    if (typeof is_active === 'boolean') {
      isActive = is_active;
    } else if (typeof status === 'string') {
      isActive = status.toLowerCase() === 'active' || status.toLowerCase() === 'aktif';
    }

    let query = `UPDATE payment_methods SET is_active = $1 WHERE id = $2 RETURNING id, name, is_active, created_at`;
    const params = [isActive, id];

    const result = await pool.query(query, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
    }

    const row = result.rows[0];
    const meta = getPaymentMethodMeta(row.name);

    res.json({
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      status: row.is_active ? 'Active' : 'Inactive',
      type: meta.type,
      iconType: meta.iconType,
      provider: meta.provider,
      description: meta.description,
      fee: meta.fee,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('Gagal mengubah status metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal mengubah status metode pembayaran.' });
  }
});

// DELETE: Menghapus metode pembayaran
router.delete('/:id', verifyToken, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const trxCheck = await pool.query(
      'SELECT COUNT(*)::int AS count FROM sales_transactions WHERE payment_method_id = $1',
      [id]
    );

    if (trxCheck.rows[0].count > 0) {
      return res.status(409).json({
        message: 'Metode pembayaran tidak dapat dihapus karena sudah memiliki riwayat transaksi penjualan.',
      });
    }

    let query = 'DELETE FROM payment_methods WHERE id = $1 RETURNING id, name';
    const params = [id];

    const deleteResult = await pool.query(query, params);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
    }

    res.json({
      message: `Metode pembayaran "${deleteResult.rows[0].name}" berhasil dihapus.`,
      id: deleteResult.rows[0].id,
    });
  } catch (error) {
    console.error('Gagal menghapus metode pembayaran:', error.message);
    res.status(500).json({ message: 'Gagal menghapus metode pembayaran.' });
  }
});

module.exports = router;
