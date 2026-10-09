
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const paymentMethodRoutes = require('./routes/paymentMethodRoutes');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingRoutes = require('./routes/settingRoutes');
const merchantRoutes = require('./routes/merchantRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Endpoint utama
app.get('/', (req, res) => {
  res.json({
    message: 'Backend POSAN berhasil berjalan!',
    engine: 'POSAN 5-Role Auth & Kitchen/Barista Order System v2.0',
  });
});

// Endpoint status /api
app.get('/api', (req, res) => {
  res.json({
    status: 'online',
    message: 'POSAN REST API Server v2.0 Online',
    endpoints: {
      health: '/api/health/db',
      auth: '/api/auth/login',
      categories: '/api/categories',
      products: '/api/products',
      orders: '/api/orders',
      transactions: '/api/transactions',
      settings: '/api/settings',
    },
  });
});

// Pemeriksaan koneksi database
app.get('/api/health/db', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database, NOW() AS server_time'
    );

    res.json({
      connected: true,
      database: result.rows[0].database,
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error('Koneksi database gagal:', error.message);

    res.status(500).json({
      connected: false,
      message: 'Koneksi ke database gagal.',
    });
  }
});

// API Autentikasi: Login & Sesi
app.use('/api/auth', authRoutes);

// API Pesanan: Barista & Kitchen Stasiun
app.use('/api/orders', orderRoutes);

// API Transaksi Penjualan: Kasir & Riwayat
app.use('/api/transactions', transactionRoutes);

// API Dashboard & Statistik Cafe: Admin Cafe & Super Admin
app.use('/api/dashboard', dashboardRoutes);

// API Manajemen Pengguna / Staf
app.use('/api/users', userRoutes);

// API kategori: GET, POST, PUT, DELETE
app.use('/api/categories', categoryRoutes);

// API produk: GET, POST, PUT, PATCH, DELETE
app.use('/api/products', productRoutes);

// API metode pembayaran: GET, POST, PUT, PATCH, DELETE
app.use('/api/payment-methods', paymentMethodRoutes);

// API Pengaturan: Struk Transaksi (Header & Footer) & Toko
app.use('/api/settings', settingRoutes);

// API Merchant / Coffee Shop: Multi-Tenant Outlet
app.use('/api/merchants', merchantRoutes);

// Menangani endpoint yang tidak ditemukan
app.use((req, res) => {
  res.status(404).json({
    message: 'Endpoint tidak ditemukan.',
    path: req.originalUrl,
  });
});

// Penanganan error umum
app.use((err, req, res, next) => {
  console.error('Terjadi kesalahan:', err.message);

  res.status(500).json({
    message: 'Terjadi kesalahan pada server.',
  });
});

// Menjalankan server
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 POSAN Backend Server Berjalan!`);
  console.log(`   - Local:   http://localhost:${PORT}`);
  console.log(`   - Network: http://192.168.1.10:${PORT}`);
  console.log(`   - Status:  http://localhost:${PORT}/api/health/db`);
  console.log(`======================================================\n`);
});