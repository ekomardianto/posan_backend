const bcrypt = require('bcryptjs');
const pool = require('./db');

async function createCleanCafeAdmin() {
  try {
    const merchantId = 2; // POSAN Artisan Dago

    console.log('=== 1. BERSIHKAN DATA MENU/KASIR/BARISTA DI CAFE 2 ===');
    // Hapus data uji coba sebelumnya agar cafe 2 benar-benar kosong
    await pool.query('DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM sales_transactions WHERE merchant_id = $1)', [merchantId]);
    await pool.query('DELETE FROM order_logs WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM sales_transactions WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM categories WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM users WHERE merchant_id = $1', [merchantId]);

    console.log('=== 2. BUAT SATU AKUN ADMIN KHUSUS CAFE 2 ===');
    const adminName = 'Admin POSAN Dago';
    const adminEmail = 'admindago@posan.com';
    const adminPassword = 'admindago123';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, merchant_id, is_active)
       VALUES ($1, $2, $3, 'admin', $4, true)
       RETURNING id, name, email, role, merchant_id, is_active, created_at`,
      [adminName, adminEmail, passwordHash, merchantId]
    );

    console.log('Akun Admin Cafe 2 Berhasil Dibuat:');
    console.table(userRes.rows);

    console.log('\n=== 3. VERIFIKASI KEBERADAAN DATA DI CAFE 2 (HARUS KOSONG) ===');
    const totalUsers = await pool.query('SELECT role, count(*)::int FROM users WHERE merchant_id = $1 GROUP BY role', [merchantId]);
    const totalProd = await pool.query('SELECT count(*)::int FROM products WHERE merchant_id = $1', [merchantId]);
    const totalCat = await pool.query('SELECT count(*)::int FROM categories WHERE merchant_id = $1', [merchantId]);
    const totalTrx = await pool.query('SELECT count(*)::int FROM sales_transactions WHERE merchant_id = $1', [merchantId]);

    console.log('Daftar Role Akun di Cafe 2:');
    console.table(totalUsers.rows);
    console.log(`Total Menu/Produk: ${totalProd.rows[0].count}`);
    console.log(`Total Kategori: ${totalCat.rows[0].count}`);
    console.log(`Total Transaksi: ${totalTrx.rows[0].count}`);

  } catch (err) {
    console.error('Error creating clean cafe admin:', err);
  } finally {
    await pool.end();
  }
}

createCleanCafeAdmin();
