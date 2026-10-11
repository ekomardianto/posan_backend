const express = require('express');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dashboard', dashboardRoutes);

let server;
let baseUrl = '';

async function makeReq(method, path, body = null, token = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return { status: res.status, data };
}

async function runTest() {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on port ${port}\n`);

  try {
    // 1. Reset password for testing
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
    if (!adminPassword || !superAdminPassword) {
      throw new Error('SEED_ADMIN_PASSWORD dan SEED_SUPER_ADMIN_PASSWORD wajib diatur');
    }
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email IN ('admindago@posan.com', 'admin@posan.com', 'kasir@posan.com', 'teja@gmail.com')", [hash]);

    // 2. Login as Admin Utama (Merchant 1), Admin Dago (Merchant 2), Super Admin
    const loginUtama = await makeReq('POST', '/api/auth/login', { email: 'admin@posan.com', password: adminPassword });
    const loginDago = await makeReq('POST', '/api/auth/login', { email: 'admindago@posan.com', password: adminPassword });
    const loginSA = await makeReq('POST', '/api/auth/login', { email: 'superadmin@posan.com', password: superAdminPassword });

    console.log('Login Utama:', loginUtama.data.user?.merchant?.name, 'ID:', loginUtama.data.user?.merchant_id);
    console.log('Login Dago:', loginDago.data.user?.merchant?.name, 'ID:', loginDago.data.user?.merchant_id);

    // 3. Create a transaction for Cafe 2 (Dago)
    const newDagoTrx = await makeReq('POST', '/api/transactions', {
      receipt_number: `TRX-DAGO-${Date.now()}`,
      total_amount: 75000,
      amount_paid: 100000,
      change_amount: 25000,
      customer_name: 'Pelanggan Kafe Dago',
      items: [
        { product_name: 'Dago Nitro Cold Brew', quantity: 2, unit_price: 25000, station: 'barista' },
        { product_name: 'Dago Croissant', quantity: 1, unit_price: 25000, station: 'kitchen' },
      ],
    }, loginDago.data.token);

    console.log('\n=== TRANSAKSI DIBUAT UNTUK KAFE 2 (DAGO) ===');
    console.log('Status:', newDagoTrx.status, 'Trx ID:', newDagoTrx.data.transaction?.id, 'Merchant ID:', newDagoTrx.data.transaction?.merchant_id);

    // 4. Admin Cafe 2 (Dago) fetches transactions
    const dagoList = await makeReq('GET', '/api/transactions', null, loginDago.data.token);
    console.log('\n=== TRANSAKSI YANG DILIHAT ADMIN KAFE 2 (DAGO) ===');
    console.log('Total Transaksi Dago:', dagoList.data.length);
    console.table(dagoList.data.map(t => ({ id: t.id, receipt: t.receipt_number, cafe: t.merchant_name, total: t.total_amount, merchant_id: t.merchant_id })));
    const allDagoMatch = dagoList.data.every(t => t.merchant_id === 2);
    console.log('✅ Semua transaksi Dago murni milik Kafe Dago (merchant_id = 2):', allDagoMatch);

    // 5. Admin Cafe 1 (Utama) fetches transactions
    const utamaList = await makeReq('GET', '/api/transactions', null, loginUtama.data.token);
    console.log('\n=== TRANSAKSI YANG DILIHAT ADMIN KAFE 1 (UTAMA) ===');
    console.log('Total Transaksi Utama:', utamaList.data.length);
    const allUtamaMatch = utamaList.data.every(t => t.merchant_id === 1);
    console.log('✅ Semua transaksi Utama murni milik Kafe Utama (merchant_id = 1):', allUtamaMatch);

    // 6. Super Admin fetches all transactions (Global multi-outlet view)
    const saList = await makeReq('GET', '/api/transactions', null, loginSA.data.token);
    console.log('\n=== TRANSAKSI YANG DILIHAT SUPER ADMIN (GLOBAL SEMUA KAFE) ===');
    console.log('Total Transaksi Global:', saList.data.length);
    const hasBothMerchants = saList.data.some(t => t.merchant_id === 1) && saList.data.some(t => t.merchant_id === 2);
    console.log('✅ Super Admin dapat memantau transaksi dari kedua kafe:', hasBothMerchants);

    // 7. Super Admin filters by merchant 2
    const saDagoOnly = await makeReq('GET', '/api/transactions?merchant_id=2', null, loginSA.data.token);
    console.log('Super Admin filter Dago count:', saDagoOnly.data.length, 'All merchant_id = 2:', saDagoOnly.data.every(t => t.merchant_id === 2));

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (server) server.close();
    await pool.end();
  }
}

runTest();
