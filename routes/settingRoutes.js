const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// GET /api/settings/receipt: Ambil konfigurasi header & footer struk transaksi per Coffee Shop
router.get('/receipt', optionalToken, async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req) || 1;
    const result = await pool.query(
      `SELECT id, merchant_id, store_name, store_address, store_phone, header_title, header_subtitle,
              show_logo, logo_url,
              show_order_type, show_cashier_name, show_date_time,
              bank_info, thank_you_message, footer_note, paper_size, updated_at
       FROM receipt_settings
       WHERE merchant_id = $1
       ORDER BY id ASC
       LIMIT 1`,
      [merchantId]
    );

    if (result.rows.length === 0) {
      // Fallback default
      return res.json({
        id: 1,
        merchant_id: merchantId,
        store_name: 'POSAN Coffee',
        store_address: '',
        store_phone: '',
        header_title: 'POSAN Coffee',
        header_subtitle: '',
        show_logo: true,
        logo_url: '',
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
    console.error('Fetch receipt settings error:', error.message);
    res.status(500).json({ message: 'Gagal mengambil pengaturan struk.' });
  }
});

// PUT /api/settings/receipt: Update konfigurasi header & footer struk
router.put('/receipt', verifyToken, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req) || 1;
    const {
      store_name = 'POSAN Coffee',
      store_address = '',
      store_phone = '',
      header_title = 'POSAN Coffee',
      header_subtitle = '',
      show_logo = true,
      logo_url = '',
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
          show_logo, logo_url,
          show_order_type, show_cashier_name, show_date_time,
          bank_info, thank_you_message, footer_note, paper_size, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        RETURNING *`,
        [
          merchantId,
          store_name,
          store_address,
          store_phone,
          header_title,
          header_subtitle,
          Boolean(show_logo),
          logo_url,
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
      // Catatan kaki / Powered by Branding hanya dapat diubah oleh super_admin
      const finalFooterNote = isSuperAdmin
        ? footer_note
        : (checkRes.rows[0].footer_note || 'Powered by POSAN POS');

      result = await pool.query(
        `UPDATE receipt_settings
         SET store_name = $1,
             store_address = $2,
             store_phone = $3,
             header_title = $4,
             header_subtitle = $5,
             show_logo = $6,
             logo_url = $7,
             show_order_type = $8,
             show_cashier_name = $9,
             show_date_time = $10,
             bank_info = $11,
             thank_you_message = $12,
             footer_note = $13,
             paper_size = $14,
             updated_at = NOW()
         WHERE id = $15
         RETURNING *`,
        [
          store_name,
          store_address,
          store_phone,
          header_title,
          header_subtitle,
          Boolean(show_logo),
          logo_url,
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
    console.error('Update receipt settings error:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui pengaturan struk.' });
  }
});

// POST /api/settings/receipt/reset: Reset ke template standar
router.post('/receipt/reset', verifyToken, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req) || 1;
    const defaultSettings = {
      store_name: 'POSAN Coffee',
      store_address: '',
      store_phone: '',
      header_title: 'POSAN Coffee',
      header_subtitle: '',
      show_order_type: true,
      show_cashier_name: true,
      show_date_time: true,
      bank_info: 'BCA : 034-392-4680\nA.N POSAN Cafe',
      thank_you_message: 'Terimakasih Kak.',
      footer_note: 'Powered by POSAN POS',
      paper_size: '58mm',
    };

    await pool.query('DELETE FROM receipt_settings WHERE merchant_id = $1', [merchantId]);
    const result = await pool.query(
      `INSERT INTO receipt_settings (
        merchant_id, store_name, store_address, store_phone, header_title, header_subtitle,
        show_order_type, show_cashier_name, show_date_time,
        bank_info, thank_you_message, footer_note, paper_size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        merchantId,
        defaultSettings.store_name,
        defaultSettings.store_address,
        defaultSettings.store_phone,
        defaultSettings.header_title,
        defaultSettings.header_subtitle,
        defaultSettings.show_order_type,
        defaultSettings.show_cashier_name,
        defaultSettings.show_date_time,
        defaultSettings.bank_info,
        defaultSettings.thank_you_message,
        defaultSettings.footer_note,
        defaultSettings.paper_size,
      ]
    );

    res.json({
      message: 'Pengaturan struk berhasil di-reset ke template standar.',
      settings: result.rows[0],
    });
  } catch (error) {
    console.error('Reset receipt settings error:', error.message);
    res.status(500).json({ message: 'Gagal mereset pengaturan struk.' });
  }
});

module.exports = router;
