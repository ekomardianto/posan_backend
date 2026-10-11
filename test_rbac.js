const express = require('express');
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const paymentMethodRoutes = require('./routes/paymentMethodRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingRoutes = require('./routes/settingRoutes');
const pool = require('./db');

const app = express();
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/settings', settingRoutes);

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

async function runTests() {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on port ${port}\n`);

  const results = [];
  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      results.push({ name, passed: true });
    } else {
      console.error(`❌ [FAIL] ${name} -> ${details}`);
      results.push({ name, passed: false, details });
    }
  }

  try {
    // 1. LOGIN TESTS & AUTHENTICATION AUDIT
    console.log('=== 1. TESTING LOGIN & AUTHENTICATION AUDIT ===');
    const roles = [
      { role: 'super_admin', email: 'superadmin@posan.com', pass: process.env.SEED_SUPER_ADMIN_PASSWORD },
      { role: 'admin', email: 'admin@posan.com', pass: process.env.SEED_ADMIN_PASSWORD },
      { role: 'kasir', email: 'kasir@posan.com', pass: process.env.SEED_KASIR_PASSWORD },
      { role: 'barista', email: 'barista@posan.com', pass: process.env.SEED_BARISTA_PASSWORD },
      { role: 'kitchen', email: 'kitchen@posan.com', pass: process.env.SEED_KITCHEN_PASSWORD },
    ];
    const testTempPassword = process.env.TEST_TEMP_PASSWORD;
    if (roles.some((user) => !user.pass) || !testTempPassword) {
      throw new Error('SEED_*_PASSWORD dan TEST_TEMP_PASSWORD wajib diatur sebelum menjalankan test_rbac.js');
    }

    const tokens = {};
    const userProfiles = {};
    for (const r of roles) {
      const loginRes = await makeReq('POST', '/api/auth/login', { email: r.email, password: r.pass });
      assert(`Login as ${r.role} with valid credentials`, loginRes.status === 200 && loginRes.data.token && loginRes.data.user.role === r.role, JSON.stringify(loginRes.data));
      tokens[r.role] = loginRes.data.token;
      userProfiles[r.role] = loginRes.data.user;
    }

    // Test invalid password
    const badLoginRes = await makeReq('POST', '/api/auth/login', { email: 'admin@posan.com', password: 'wrongpassword' });
    assert('Login with invalid password returns 401 Unauthorized', badLoginRes.status === 401, `status: ${badLoginRes.status}`);

    // Test /api/auth/me profile retrieval
    const meRes = await makeReq('GET', '/api/auth/me', null, tokens.admin);
    assert('Admin profile retrieved from database via /api/auth/me', meRes.status === 200 && meRes.data.user.email === 'admin@posan.com' && meRes.data.user.role === 'admin', JSON.stringify(meRes.data));

    // 2. DASHBOARD & CAFE STATISTICS (ADMIN CAFE ACCESS)
    console.log('\n=== 2. TESTING DASHBOARD & CAFE STATISTICS ===');
    const adminDashboardRes = await makeReq('GET', '/api/dashboard/stats', null, tokens.admin);
    assert('Admin Cafe can access /api/dashboard/stats', adminDashboardRes.status === 200 && adminDashboardRes.data.summary && adminDashboardRes.data.master_data, JSON.stringify(adminDashboardRes.data?.summary));

    const kasirDashboardRes = await makeReq('GET', '/api/dashboard/stats', null, tokens.kasir);
    assert('Kasir cannot access /api/dashboard/stats (403 Forbidden)', kasirDashboardRes.status === 403, `status: ${kasirDashboardRes.status}`);

    const baristaDashboardRes = await makeReq('GET', '/api/dashboard/stats', null, tokens.barista);
    assert('Barista cannot access /api/dashboard/stats (403 Forbidden)', baristaDashboardRes.status === 403, `status: ${baristaDashboardRes.status}`);

    const saDashboardRes = await makeReq('GET', '/api/dashboard/stats', null, tokens.super_admin);
    assert('Super Admin can access /api/dashboard/stats', saDashboardRes.status === 200, `status: ${saDashboardRes.status}`);

    // 3. PRODUCT MANAGEMENT & RBAC
    console.log('\n=== 3. TESTING PRODUCT MANAGEMENT ===');
    const getAllProds = await makeReq('GET', '/api/products', null, tokens.admin);
    assert('Admin Cafe can GET /api/products', getAllProds.status === 200 && Array.isArray(getAllProds.data), `status: ${getAllProds.status}`);

    const newProd = { name: 'Kopi Susu Uji RBAC Admin', price: 25000, station: 'barista', description: 'Menu uji coba admin' };
    const superAdminPostProd = await makeReq('POST', '/api/products', newProd, tokens.super_admin);
    assert('Super Admin cannot create product (403 Forbidden)', superAdminPostProd.status === 403, `status: ${superAdminPostProd.status}`);

    const kasirPostProd = await makeReq('POST', '/api/products', newProd, tokens.kasir);
    assert('Kasir cannot create product (403 Forbidden)', kasirPostProd.status === 403, `status: ${kasirPostProd.status}`);

    const adminPostProd = await makeReq('POST', '/api/products', newProd, tokens.admin);
    assert('Admin Cafe can create product (201 Created)', adminPostProd.status === 201 && adminPostProd.data.id && adminPostProd.data.station === 'barista', JSON.stringify(adminPostProd.data));
    const createdProdId = adminPostProd.data?.id;

    if (createdProdId) {
      // Get detail
      const getDetailProd = await makeReq('GET', `/api/products/${createdProdId}`, null, tokens.admin);
      assert('Admin Cafe can GET /api/products/:id', getDetailProd.status === 200 && getDetailProd.data.id === createdProdId, `status: ${getDetailProd.status}`);

      // Update product
      const adminPutProd = await makeReq('PUT', `/api/products/${createdProdId}`, { name: 'Kopi Susu Edit Admin', price: 28000, station: 'barista' }, tokens.admin);
      assert('Admin Cafe can update product (200 OK)', adminPutProd.status === 200 && Number(adminPutProd.data.price) === 28000, `status: ${adminPutProd.status}`);

      // Toggle status
      const patchProdStatus = await makeReq('PATCH', `/api/products/${createdProdId}/status`, { is_active: false }, tokens.admin);
      assert('Admin Cafe can toggle product status (200 OK)', patchProdStatus.status === 200 && patchProdStatus.data.is_active === false, `status: ${patchProdStatus.status}`);

      // Filter products
      const filterProds = await makeReq('GET', `/api/products?station=barista&search=Kopi`, null, tokens.admin);
      assert('Admin Cafe can filter products by station and search', filterProds.status === 200 && Array.isArray(filterProds.data), `status: ${filterProds.status}`);

      // Delete product
      const adminDeleteProd = await makeReq('DELETE', `/api/products/${createdProdId}`, null, tokens.admin);
      assert('Admin Cafe can delete unused product (200 OK)', adminDeleteProd.status === 200, `status: ${adminDeleteProd.status}`);
    }

    // 4. CATEGORY MANAGEMENT
    console.log('\n=== 4. TESTING CATEGORY MANAGEMENT ===');
    const saCatPost = await makeReq('POST', '/api/categories', { name: 'Kategori SA Test' }, tokens.super_admin);
    assert('Super Admin cannot create category (403 Forbidden)', saCatPost.status === 403, `status: ${saCatPost.status}`);

    const adminCatPost = await makeReq('POST', '/api/categories', { name: 'Kategori Admin Test', station: 'kitchen', description: 'Kategori makanan uji' }, tokens.admin);
    assert('Admin Cafe can create category (201 Created)', adminCatPost.status === 201 && adminCatPost.data.id && adminCatPost.data.station === 'kitchen', JSON.stringify(adminCatPost.data));
    const createdCatId = adminCatPost.data?.id;

    if (createdCatId) {
      const getCatDetail = await makeReq('GET', `/api/categories/${createdCatId}`, null, tokens.admin);
      assert('Admin Cafe can GET /api/categories/:id', getCatDetail.status === 200 && getCatDetail.data.id === createdCatId, `status: ${getCatDetail.status}`);

      const updateCat = await makeReq('PUT', `/api/categories/${createdCatId}`, { name: 'Kategori Admin Test Update', station: 'kitchen', description: 'Updated desc' }, tokens.admin);
      assert('Admin Cafe can update category (200 OK)', updateCat.status === 200 && updateCat.data.name === 'Kategori Admin Test Update', `status: ${updateCat.status}`);

      const kasirCatDel = await makeReq('DELETE', `/api/categories/${createdCatId}`, null, tokens.kasir);
      assert('Kasir cannot delete category (403 Forbidden)', kasirCatDel.status === 403, `status: ${kasirCatDel.status}`);

      const adminCatDel = await makeReq('DELETE', `/api/categories/${createdCatId}`, null, tokens.admin);
      assert('Admin Cafe can delete category (200 OK)', adminCatDel.status === 200, `status: ${adminCatDel.status}`);
    }

    // 5. PAYMENT METHODS MANAGEMENT
    console.log('\n=== 5. TESTING PAYMENT METHODS MANAGEMENT ===');
    const saGetPm = await makeReq('GET', '/api/payment-methods', null, tokens.super_admin);
    assert('Super Admin can view payment methods (200 OK)', saGetPm.status === 200, `status: ${saGetPm.status}`);

    const adminGetPm = await makeReq('GET', '/api/payment-methods', null, tokens.admin);
    assert('Admin Cafe can view payment methods (200 OK)', adminGetPm.status === 200, `status: ${adminGetPm.status}`);

    const baristaGetPm = await makeReq('GET', '/api/payment-methods', null, tokens.barista);
    assert('Barista CANNOT view payment methods (403 Forbidden)', baristaGetPm.status === 403, `status: ${baristaGetPm.status}`);

    const adminPostPm = await makeReq('POST', '/api/payment-methods', { name: `Voucher Promo ${Date.now()}` }, tokens.admin);
    assert('Admin Cafe can create payment method (201 Created)', adminPostPm.status === 201 && adminPostPm.data.id, JSON.stringify(adminPostPm.data));
    const createdPmId = adminPostPm.data?.id;

    if (createdPmId) {
      const getPmDetail = await makeReq('GET', `/api/payment-methods/${createdPmId}`, null, tokens.admin);
      assert('Admin Cafe can GET /api/payment-methods/:id', getPmDetail.status === 200 && getPmDetail.data.id === createdPmId, `status: ${getPmDetail.status}`);

      const updatePm = await makeReq('PUT', `/api/payment-methods/${createdPmId}`, { name: `Voucher Promo Edited ${Date.now()}` }, tokens.admin);
      assert('Admin Cafe can update payment method (200 OK)', updatePm.status === 200, `status: ${updatePm.status}`);

      const patchPm = await makeReq('PATCH', `/api/payment-methods/${createdPmId}/status`, { is_active: false }, tokens.admin);
      assert('Admin Cafe can toggle payment method status (200 OK)', patchPm.status === 200 && patchPm.data.is_active === false, `status: ${patchPm.status}`);

      const adminDelPm = await makeReq('DELETE', `/api/payment-methods/${createdPmId}`, null, tokens.admin);
      assert('Admin Cafe can delete payment method (200 OK)', adminDelPm.status === 200, `status: ${adminDelPm.status}`);
    }

    // 6. STAFF ACCOUNT MANAGEMENT & SUPER ADMIN ISOLATION
    console.log('\n=== 6. TESTING STAFF MANAGEMENT & SUPER ADMIN ISOLATION ===');
    const adminGetUsers = await makeReq('GET', '/api/users', null, tokens.admin);
    assert('Admin Cafe can view users list (200 OK)', adminGetUsers.status === 200 && Array.isArray(adminGetUsers.data), `status: ${adminGetUsers.status}`);
    const hasSAInAdminList = adminGetUsers.data.some(u => u.role === 'super_admin');
    assert('Super Admin accounts are hidden from Admin Cafe staff list', !hasSAInAdminList, 'Super Admin found in Admin user list!');

    // Admin tries to create Super Admin -> 403 Forbidden
    const adminCreateSA = await makeReq('POST', '/api/users', { name: 'Illegal SA', email: `sa-illegal-${Date.now()}@test.com`, password: testTempPassword, role: 'super_admin' }, tokens.admin);
    assert('Admin Cafe CANNOT create Super Admin account (403 Forbidden)', adminCreateSA.status === 403, `status: ${adminCreateSA.status}`);

    // Admin creates Kasir, Barista, Kitchen
    const testKasirEmail = `kasir-new-${Date.now()}@posan.com`;
    const adminCreateKasir = await makeReq('POST', '/api/users', { name: 'Kasir Shift Pagi', email: testKasirEmail, password: testTempPassword, role: 'kasir' }, tokens.admin);
    assert('Admin Cafe can create Kasir account (201 Created)', adminCreateKasir.status === 201 && adminCreateKasir.data.user.id, JSON.stringify(adminCreateKasir.data));
    const newKasirId = adminCreateKasir.data?.user?.id;

    if (newKasirId) {
      const getSingleKasir = await makeReq('GET', `/api/users/${newKasirId}`, null, tokens.admin);
      assert('Admin Cafe can GET /api/users/:id for staff', getSingleKasir.status === 200 && getSingleKasir.data.id === newKasirId, `status: ${getSingleKasir.status}`);

      const adminUpdateKasir = await makeReq('PUT', `/api/users/${newKasirId}`, { name: 'Kasir Shift Pagi Update', email: testKasirEmail, role: 'kasir' }, tokens.admin);
      assert('Admin Cafe can update Kasir account (200 OK)', adminUpdateKasir.status === 200, `status: ${adminUpdateKasir.status}`);

      const adminPromoteKasir = await makeReq('PUT', `/api/users/${newKasirId}`, { name: 'Kasir Escalate', email: testKasirEmail, role: 'super_admin' }, tokens.admin);
      assert('Admin Cafe CANNOT escalate Kasir to Super Admin (403 Forbidden)', adminPromoteKasir.status === 403, `status: ${adminPromoteKasir.status}`);

      const adminDeactivateKasir = await makeReq('PATCH', `/api/users/${newKasirId}/status`, { is_active: false }, tokens.admin);
      assert('Admin Cafe can deactivate Kasir account (200 OK)', adminDeactivateKasir.status === 200 && adminDeactivateKasir.data.is_active === false, `status: ${adminDeactivateKasir.status}`);

      const adminDeleteKasir = await makeReq('DELETE', `/api/users/${newKasirId}`, null, tokens.admin);
      assert('Admin Cafe can delete temporary kasir (200 OK)', adminDeleteKasir.status === 200, `status: ${adminDeleteKasir.status}`);
    }

    // Admin Cafe tries to view / edit / delete Super Admin (ID 1 / SA ID)
    const saId = userProfiles.super_admin.id;
    const adminGetSA = await makeReq('GET', `/api/users/${saId}`, null, tokens.admin);
    assert('Admin Cafe CANNOT view Super Admin profile (403 Forbidden)', adminGetSA.status === 403, `status: ${adminGetSA.status}`);

    const adminEditSA = await makeReq('PUT', `/api/users/${saId}`, { name: 'Hacked SA', email: 'hacked@sa.com', role: 'admin' }, tokens.admin);
    assert('Admin Cafe CANNOT edit Super Admin account (403 Forbidden)', adminEditSA.status === 403, `status: ${adminEditSA.status}`);

    const adminDeleteSA = await makeReq('DELETE', `/api/users/${saId}`, null, tokens.admin);
    assert('Admin Cafe CANNOT delete Super Admin account (403 Forbidden)', adminDeleteSA.status === 403, `status: ${adminDeleteSA.status}`);

    const adminDeactSA = await makeReq('PATCH', `/api/users/${saId}/status`, { is_active: false }, tokens.admin);
    assert('Admin Cafe CANNOT deactivate Super Admin account (403 Forbidden)', adminDeactSA.status === 403, `status: ${adminDeactSA.status}`);

    // Admin Cafe tries to deactivate self -> 400 Bad Request
    const adminSelfId = userProfiles.admin.id;
    const adminDeactSelf = await makeReq('PATCH', `/api/users/${adminSelfId}/status`, { is_active: false }, tokens.admin);
    assert('Admin Cafe CANNOT deactivate their own account (400 Bad Request)', adminDeactSelf.status === 400, `status: ${adminDeactSelf.status}`);

    // 7. TRANSACTIONS, STATS, AND REPORTS
    console.log('\n=== 7. TESTING TRANSACTIONS, STATS, AND REPORTS ===');
    const randomReceipt = `TRX-ADMIN-${Date.now()}`;
    const trxData = {
      receipt_number: randomReceipt,
      total_amount: 60000,
      amount_paid: 100000,
      change_amount: 40000,
      customer_name: 'Pelanggan Cafe VIP',
      items: [
        { product_name: 'Caramel Macchiato', quantity: 2, unit_price: 20000, station: 'barista' },
        { product_name: 'Croissant Coklat', quantity: 1, unit_price: 20000, station: 'kitchen' },
      ],
    };

    const adminCreateTrx = await makeReq('POST', '/api/transactions', trxData, tokens.admin);
    assert('Admin Cafe can create transaction (201 Created)', adminCreateTrx.status === 201 && adminCreateTrx.data.transaction.id, JSON.stringify(adminCreateTrx.data));
    const createdTrx = adminCreateTrx.data?.transaction;

    // View Transactions
    const adminGetTrx = await makeReq('GET', '/api/transactions?search=VIP', null, tokens.admin);
    assert('Admin Cafe can GET /api/transactions with search filter', adminGetTrx.status === 200 && Array.isArray(adminGetTrx.data) && adminGetTrx.data.length > 0, `status: ${adminGetTrx.status}`);

    // View Transaction Details
    if (createdTrx) {
      const getTrxDetail = await makeReq('GET', `/api/transactions/${createdTrx.id}`, null, tokens.admin);
      assert('Admin Cafe can GET /api/transactions/:id with item breakdown', getTrxDetail.status === 200 && getTrxDetail.data.items && getTrxDetail.data.items.length === 2, `status: ${getTrxDetail.status}`);
    }

    // View Transaction Stats
    const getTrxStats = await makeReq('GET', '/api/transactions/stats', null, tokens.admin);
    assert('Admin Cafe can GET /api/transactions/stats', getTrxStats.status === 200 && getTrxStats.data.summary && getTrxStats.data.payment_methods, JSON.stringify(getTrxStats.data?.summary));

    // View Transaction Reports
    const getTrxReports = await makeReq('GET', '/api/transactions/reports', null, tokens.admin);
    assert('Admin Cafe can GET /api/transactions/reports', getTrxReports.status === 200 && getTrxReports.data.summary && Array.isArray(getTrxReports.data.daily_trend), JSON.stringify(getTrxReports.data?.summary));

    // Kasir cannot view reports (requireRole('super_admin', 'admin'))
    const kasirGetReports = await makeReq('GET', '/api/transactions/reports', null, tokens.kasir);
    assert('Kasir CANNOT access /api/transactions/reports (403 Forbidden)', kasirGetReports.status === 403, `status: ${kasirGetReports.status}`);

    // 8. BARISTA & KITCHEN KDS ACCESS CONTROL & WORKFLOW
    console.log('\n=== 8. TESTING BARISTA & KITCHEN KDS ACCESS CONTROL & STATUS FLOW ===');
    const baristaGetBaristaOrders = await makeReq('GET', '/api/orders/barista', null, tokens.barista);
    assert('Barista can view barista orders (200 OK)', baristaGetBaristaOrders.status === 200, `status: ${baristaGetBaristaOrders.status}`);

    const baristaGetKitchenOrders = await makeReq('GET', '/api/orders/kitchen', null, tokens.barista);
    assert('Barista CANNOT view kitchen orders (403 Forbidden)', baristaGetKitchenOrders.status === 403, `status: ${baristaGetKitchenOrders.status}`);

    const kitchenGetKitchenOrders = await makeReq('GET', '/api/orders/kitchen', null, tokens.kitchen);
    assert('Kitchen can view kitchen orders (200 OK)', kitchenGetKitchenOrders.status === 200, `status: ${kitchenGetKitchenOrders.status}`);

    const kitchenGetBaristaOrders = await makeReq('GET', '/api/orders/barista', null, tokens.kitchen);
    assert('Kitchen CANNOT view barista orders (403 Forbidden)', kitchenGetBaristaOrders.status === 403, `status: ${kitchenGetBaristaOrders.status}`);

    // Admin can view both orders
    const adminGetBaristaOrders = await makeReq('GET', '/api/orders/barista', null, tokens.admin);
    assert('Admin Cafe can view barista orders (200 OK)', adminGetBaristaOrders.status === 200, `status: ${adminGetBaristaOrders.status}`);

    const adminGetKitchenOrders = await makeReq('GET', '/api/orders/kitchen', null, tokens.admin);
    assert('Admin Cafe can view kitchen orders (200 OK)', adminGetKitchenOrders.status === 200, `status: ${adminGetKitchenOrders.status}`);

    const adminGetKdsStats = await makeReq('GET', '/api/orders/stats', null, tokens.admin);
    assert('Admin Cafe can view KDS station stats (200 OK)', adminGetKdsStats.status === 200 && adminGetKdsStats.data.overview, JSON.stringify(adminGetKdsStats.data));

    // KDS workflow transitions
    if (createdTrx && createdTrx.items && createdTrx.items.length === 2) {
      const baristaItem = createdTrx.items.find(i => i.station === 'barista');
      const kitchenItem = createdTrx.items.find(i => i.station === 'kitchen');

      if (baristaItem && kitchenItem) {
        // Kitchen trying to update Barista item -> 403 Forbidden
        const kitchenUpdateBaristaItem = await makeReq('PATCH', `/api/orders/items/${baristaItem.id}/status`, { next_status: 'processing' }, tokens.kitchen);
        assert('Kitchen CANNOT update barista item (403 Forbidden)', kitchenUpdateBaristaItem.status === 403, `status: ${kitchenUpdateBaristaItem.status}`);

        // Barista updating Barista item to processing -> 200 OK
        const baristaUpdateBaristaItem = await makeReq('PATCH', `/api/orders/items/${baristaItem.id}/status`, { next_status: 'processing' }, tokens.barista);
        assert('Barista can update barista item to processing (200 OK)', baristaUpdateBaristaItem.status === 200 && baristaUpdateBaristaItem.data.item.item_status === 'processing', JSON.stringify(baristaUpdateBaristaItem.data));

        // Barista updating Barista item to completed -> 200 OK
        const baristaCompleteBaristaItem = await makeReq('PATCH', `/api/orders/items/${baristaItem.id}/status`, { next_status: 'completed' }, tokens.barista);
        assert('Barista can complete barista item (200 OK)', baristaCompleteBaristaItem.status === 200 && baristaCompleteBaristaItem.data.item.item_status === 'completed', JSON.stringify(baristaCompleteBaristaItem.data));

        // Kitchen updating Kitchen item to processing -> 200 OK
        const kitchenUpdateKitchenItem = await makeReq('PATCH', `/api/orders/items/${kitchenItem.id}/status`, { next_status: 'processing' }, tokens.kitchen);
        assert('Kitchen can update kitchen item to processing (200 OK)', kitchenUpdateKitchenItem.status === 200 && kitchenUpdateKitchenItem.data.item.item_status === 'processing', JSON.stringify(kitchenUpdateKitchenItem.data));

        // Kitchen updating Kitchen item to completed -> 200 OK
        const kitchenCompleteKitchenItem = await makeReq('PATCH', `/api/orders/items/${kitchenItem.id}/status`, { next_status: 'completed' }, tokens.kitchen);
        assert('Kitchen can complete kitchen item (200 OK)', kitchenCompleteKitchenItem.status === 200 && kitchenCompleteKitchenItem.data.item.item_status === 'completed', JSON.stringify(kitchenCompleteKitchenItem.data));
      }
    }

    // === 9. TESTING MOBILE OFFLINE SQLITE SYNC & CATALOG SNAPSHOT ===
    console.log('\n=== 9. TESTING MOBILE OFFLINE SQLITE SYNC & CATALOG SNAPSHOT ===');
    const catalogSnapshotRes = await makeReq('GET', '/api/transactions/catalog/snapshot', null, tokens.kasir);
    assert('Kasir can fetch catalog snapshot for offline SQLite (200 OK)', catalogSnapshotRes.status === 200 && Array.isArray(catalogSnapshotRes.data.products) && Array.isArray(catalogSnapshotRes.data.categories), JSON.stringify(catalogSnapshotRes.data));

    const syncBatchRes = await makeReq('POST', '/api/transactions/sync-batch', {
      transactions: [
        {
          receipt_number: `TRX-OFFLINE-${Date.now()}-1`,
          payment_method_name: 'Tunai',
          total_amount: 35000,
          amount_paid: 50000,
          change_amount: 15000,
          customer_name: 'Offline Customer A',
          order_type: 'Take Away',
          created_at: new Date(Date.now() - 120000).toISOString(),
          items: [
            { product_name: 'Kopi Susu Aren Offline', quantity: 1, unit_price: 20000, subtotal: 20000, station: 'barista', notes: 'Less sugar' },
            { product_name: 'Kentang Goreng Offline', quantity: 1, unit_price: 15000, subtotal: 15000, station: 'kitchen', notes: 'Extra sauce' }
          ]
        },
        {
          receipt_number: `TRX-OFFLINE-${Date.now()}-2`,
          payment_method_name: 'QRIS',
          total_amount: 25000,
          amount_paid: 25000,
          change_amount: 0,
          customer_name: 'Offline Customer B',
          order_type: 'Dine In',
          created_at: new Date(Date.now() - 60000).toISOString(),
          items: [
            { product_name: 'Matcha Latte Offline', quantity: 1, unit_price: 25000, subtotal: 25000, station: 'barista' }
          ]
        }
      ]
    }, tokens.kasir);
    assert('Kasir can batch sync offline transactions to PostgreSQL (200 OK)', syncBatchRes.status === 200 && syncBatchRes.data.syncedCount === 2, JSON.stringify(syncBatchRes.data));

    // Test idempotency (syncing the same transactions again should skip gracefully)
    const syncBatchRetryRes = await makeReq('POST', '/api/transactions/sync-batch', {
      transactions: [
        {
          receipt_number: syncBatchRes.data.results[0].receipt_number,
          payment_method_name: 'Tunai',
          total_amount: 35000,
          amount_paid: 50000,
          change_amount: 15000,
          items: []
        }
      ]
    }, tokens.kasir);
    // === 10. TESTING RECEIPT SETTINGS (HEADER & FOOTER) RBAC ===
    console.log('\n=== 10. TESTING RECEIPT SETTINGS (HEADER & FOOTER) RBAC ===');
    const getReceiptRes = await makeReq('GET', '/api/settings/receipt', null, tokens.kasir);
    assert('Kasir & anyone can view receipt settings (200 OK)', getReceiptRes.status === 200 && getReceiptRes.data.header_title, JSON.stringify(getReceiptRes.data));

    const updateReceiptByKasirRes = await makeReq('PUT', '/api/settings/receipt', {
      header_title: 'Hacked by Kasir',
    }, tokens.kasir);
    assert('Kasir is FORBIDDEN from updating receipt settings (403 Forbidden)', updateReceiptByKasirRes.status === 403, JSON.stringify(updateReceiptByKasirRes.data));

    const updateReceiptByAdminRes = await makeReq('PUT', '/api/settings/receipt', {
      header_title: 'CIP Coffee Admin',
      thank_you_message: 'Terimakasih Admin Kak.',
    }, tokens.admin);
    assert('Admin Cafe CAN update receipt settings for their outlet (200 OK)', updateReceiptByAdminRes.status === 200 && updateReceiptByAdminRes.data.settings.header_title === 'CIP Coffee Admin', JSON.stringify(updateReceiptByAdminRes.data));

    const updateReceiptBySuperAdminRes = await makeReq('PUT', '/api/settings/receipt', {
      header_title: 'CIP Coffee Super',
      thank_you_message: 'Terimakasih Super Kak.',
    }, tokens.super_admin);
    assert('Super Admin CAN update receipt settings (200 OK)', updateReceiptBySuperAdminRes.status === 200 && updateReceiptBySuperAdminRes.data.settings.header_title === 'CIP Coffee Super', JSON.stringify(updateReceiptBySuperAdminRes.data));

    // === 11. TESTING PROFILE UPDATE & CHANGE PASSWORD ===
    console.log('\n=== 11. TESTING PROFILE UPDATE & CHANGE PASSWORD ===');
    const updateProfileRes = await makeReq('PUT', '/api/auth/profile', {
      name: 'Admin Dago Updated',
      phone: '081234567890',
      shift: 'Shift Siang (11:00 - 19:00 WIB)',
      auth_pin: '123456',
    }, tokens.admin);
    assert('Admin can update own profile data via PUT /api/auth/profile (200 OK)', updateProfileRes.status === 200 && updateProfileRes.data.user.name === 'Admin Dago Updated' && updateProfileRes.data.user.phone === '081234567890', JSON.stringify(updateProfileRes.data));

    const checkMeAfterUpdate = await makeReq('GET', '/api/auth/me', null, tokens.admin);
    assert('GET /api/auth/me returns updated profile data and merchant details', checkMeAfterUpdate.status === 200 && checkMeAfterUpdate.data.user.phone === '081234567890' && checkMeAfterUpdate.data.user.role === 'admin' && checkMeAfterUpdate.data.user.merchant, JSON.stringify(checkMeAfterUpdate.data));

    const changePasswordRes = await makeReq('PUT', '/api/auth/change-password', {
      current_password: process.env.SEED_ADMIN_PASSWORD,
      new_password: testTempPassword,
    }, tokens.admin);
    assert('Admin can change password via PUT /api/auth/change-password (200 OK)', changePasswordRes.status === 200, JSON.stringify(changePasswordRes.data));

    // Revert password back
    const revertPasswordRes = await makeReq('PUT', '/api/auth/change-password', {
      current_password: testTempPassword,
      new_password: process.env.SEED_ADMIN_PASSWORD,
    }, tokens.admin);
    assert('Admin can revert password back (200 OK)', revertPasswordRes.status === 200, JSON.stringify(revertPasswordRes.data));

    console.log('\n=== TEST SUMMARY ===');
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;
    console.log(`Total: ${results.length} tests | Passed: ${passedCount} | Failed: ${failedCount}`);

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution exception:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    await pool.end();
  }
}

runTests();
