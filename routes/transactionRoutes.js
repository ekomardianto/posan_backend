const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// Helper to generate transaction/receipt code: [DAY]-[DDMMYY]-[RANDOM]
function generateReceiptCode(date = new Date()) {
  const days = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
  const dayName = days[date.getDay()] || 'POS';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${dayName}-${dd}${mm}${yy}-${randomNum}`;
}

// Helper to determine station from product or category
async function resolveItemStation(productId, productName) {
  if (productId) {
    const prodRes = await pool.query(
      `SELECT p.station AS prod_station, c.station AS cat_station, c.name AS cat_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [productId]
    );

    if (prodRes.rows.length > 0) {
      const row = prodRes.rows[0];
      if (row.prod_station) return row.prod_station;
      if (row.cat_station) return row.cat_station;
      const catLower = (row.cat_name || '').toLowerCase();
      if (catLower.includes('makan') || catLower.includes('food') || catLower.includes('pastry') || catLower.includes('snack') || catLower.includes('mie') || catLower.includes('nasi') || catLower.includes('roti')) {
        return 'kitchen';
      } else if (catLower.includes('rokok') || catLower.includes('merch') || catLower.includes('retail') || catLower.includes('voucher')) {
        return 'none';
      }
      return 'barista';
    }
  }

  const nameLower = (productName || '').toLowerCase();
  if (
    nameLower.includes('nasi') ||
    nameLower.includes('mie') ||
    nameLower.includes('ayam') ||
    nameLower.includes('burger') ||
    nameLower.includes('roti') ||
    nameLower.includes('croissant') ||
    nameLower.includes('snack') ||
    nameLower.includes('kentang') ||
    nameLower.includes('makan')
  ) {
    return 'kitchen';
  }

  return 'barista';
}

// GET /api/transactions/stats: Ringkasan statistik penjualan per Coffee Shop
router.get('/stats', verifyToken, requireRole('super_admin', 'admin', 'kasir'), async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req);
    const mCond = merchantId ? `AND st.merchant_id = ${merchantId}` : '';

    const summaryRes = await pool.query(`
      SELECT 
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_revenue,
        COUNT(*)::int AS total_transactions,
        COALESCE(AVG(st.total_amount), 0)::numeric AS average_order_value,
        COALESCE(SUM(CASE WHEN st.created_at >= CURRENT_DATE AND st.created_at < CURRENT_DATE + INTERVAL '1 day' THEN st.total_amount ELSE 0 END), 0)::numeric AS today_revenue,
        COUNT(CASE WHEN st.created_at >= CURRENT_DATE AND st.created_at < CURRENT_DATE + INTERVAL '1 day' THEN 1 END)::int AS today_transactions,
        COALESCE(SUM(CASE WHEN st.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN st.total_amount ELSE 0 END), 0)::numeric AS month_revenue,
        COUNT(CASE WHEN st.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END)::int AS month_transactions
      FROM sales_transactions st
      WHERE st.status = 'completed' ${mCond}
    `);

    const pmRes = await pool.query(`
      SELECT 
        COALESCE(pm.name, 'Lainnya') AS name,
        COUNT(st.id)::int AS transaction_count,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_revenue
      FROM sales_transactions st
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      WHERE st.status = 'completed' ${mCond}
      GROUP BY pm.name
      ORDER BY total_revenue DESC
    `);

    const topItemsRes = await pool.query(`
      SELECT 
        ti.product_name,
        ti.station,
        SUM(ti.quantity)::int AS total_quantity,
        SUM(ti.subtotal)::numeric AS total_sales
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      WHERE st.status = 'completed' ${mCond}
      GROUP BY ti.product_name, ti.station
      ORDER BY total_quantity DESC, total_sales DESC
      LIMIT 5
    `);

    const summary = summaryRes.rows[0];

    res.json({
      summary: {
        total_revenue: Number(summary.total_revenue),
        total_transactions: summary.total_transactions,
        average_order_value: Number(Number(summary.average_order_value).toFixed(2)),
        today_revenue: Number(summary.today_revenue),
        today_transactions: summary.today_transactions,
        month_revenue: Number(summary.month_revenue),
        month_transactions: summary.month_transactions,
      },
      payment_methods: pmRes.rows.map(pm => ({
        name: pm.name,
        count: pm.transaction_count,
        revenue: Number(pm.total_revenue),
      })),
      top_items: topItemsRes.rows.map(item => ({
        name: item.product_name,
        station: item.station,
        quantity: item.total_quantity,
        sales: Number(item.total_sales),
      })),
    });
  } catch (error) {
    console.error('Fetch transaction stats error:', error.message);
    res.status(500).json({ message: 'Gagal memuat statistik transaksi.' });
  }
});

// GET /api/transactions/reports: Laporan penjualan per Coffee Shop
router.get('/reports', verifyToken, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { startDate, start_date, endDate, end_date, paymentMethodId, payment_method_id, cashierId, cashier_id } = req.query;
    const merchantId = getTenantMerchantId(req);
    
    const start = startDate || start_date || null;
    const end = endDate || end_date || null;
    const pmId = paymentMethodId || payment_method_id || null;
    const cId = cashierId || cashier_id || null;

    let whereClause = "WHERE st.status = 'completed'";
    const params = [];

    if (merchantId) {
      params.push(merchantId);
      whereClause += ` AND st.merchant_id = $${params.length}`;
    }
    if (start) {
      params.push(start);
      whereClause += ` AND st.created_at >= $${params.length}::timestamp`;
    }
    if (end) {
      params.push(end);
      whereClause += ` AND st.created_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (pmId) {
      params.push(pmId);
      whereClause += ` AND st.payment_method_id = $${params.length}`;
    }
    if (cId) {
      params.push(cId);
      whereClause += ` AND st.cashier_id = $${params.length}`;
    }

    // 1. Agregasi Ringkasan Periode
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_revenue,
        COUNT(st.id)::int AS total_transactions,
        COALESCE(AVG(st.total_amount), 0)::numeric AS average_ticket_size,
        COALESCE(SUM(st.amount_paid), 0)::numeric AS total_paid,
        COALESCE(SUM(st.change_amount), 0)::numeric AS total_change
      FROM sales_transactions st
      ${whereClause}
    `;
    const summaryRes = await pool.query(summaryQuery, params);

    // 2. Tren Penjualan Harian
    const trendQuery = `
      SELECT 
        TO_CHAR(st.created_at, 'YYYY-MM-DD') AS date,
        COUNT(st.id)::int AS transaction_count,
        COALESCE(SUM(st.total_amount), 0)::numeric AS daily_revenue
      FROM sales_transactions st
      ${whereClause}
      GROUP BY TO_CHAR(st.created_at, 'YYYY-MM-DD')
      ORDER BY date ASC
    `;
    const trendRes = await pool.query(trendQuery, params);

    // 3. Breakdown per Metode Pembayaran
    const pmBreakdownQuery = `
      SELECT 
        COALESCE(pm.name, 'Lainnya') AS payment_method,
        COUNT(st.id)::int AS transaction_count,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_amount
      FROM sales_transactions st
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      ${whereClause}
      GROUP BY pm.name
      ORDER BY total_amount DESC
    `;
    const pmBreakdownRes = await pool.query(pmBreakdownQuery, params);

    // 4. Kinerja Kasir
    const cashierQuery = `
      SELECT 
        u.id AS cashier_id,
        COALESCE(u.name, 'Unknown') AS cashier_name,
        COUNT(st.id)::int AS transaction_count,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_revenue
      FROM sales_transactions st
      LEFT JOIN users u ON u.id = st.cashier_id
      ${whereClause}
      GROUP BY u.id, u.name
      ORDER BY total_revenue DESC
    `;
    const cashierRes = await pool.query(cashierQuery, params);

    // 5. Item Terlaris dalam Periode
    const topItemsQuery = `
      SELECT 
        ti.product_name,
        ti.station,
        SUM(ti.quantity)::int AS total_quantity_sold,
        SUM(ti.subtotal)::numeric AS total_sales_amount
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      ${whereClause}
      GROUP BY ti.product_name, ti.station
      ORDER BY total_quantity_sold DESC, total_sales_amount DESC
      LIMIT 10
    `;
    const topItemsRes = await pool.query(topItemsQuery, params);

    const summary = summaryRes.rows[0];

    res.json({
      filters: {
        start_date: start,
        end_date: end,
        payment_method_id: pmId,
        cashier_id: cId,
      },
      summary: {
        total_revenue: Number(summary.total_revenue),
        total_transactions: summary.total_transactions,
        average_ticket_size: Number(Number(summary.average_ticket_size).toFixed(2)),
        total_paid: Number(summary.total_paid),
        total_change: Number(summary.total_change),
      },
      daily_trend: trendRes.rows.map(r => ({
        date: r.date,
        transaction_count: r.transaction_count,
        daily_revenue: Number(r.daily_revenue),
      })),
      payment_method_breakdown: pmBreakdownRes.rows.map(r => ({
        payment_method: r.payment_method,
        transaction_count: r.transaction_count,
        total_amount: Number(r.total_amount),
      })),
      cashier_performance: cashierRes.rows.map(r => ({
        cashier_id: r.cashier_id,
        cashier_name: r.cashier_name,
        transaction_count: r.transaction_count,
        total_revenue: Number(r.total_revenue),
      })),
      top_selling_items: topItemsRes.rows.map(r => ({
        product_name: r.product_name,
        station: r.station,
        quantity_sold: r.total_quantity_sold,
        total_sales: Number(r.total_sales_amount),
      })),
    });
  } catch (error) {
    console.error('Fetch transaction reports error:', error.message);
    res.status(500).json({ message: 'Gagal memuat laporan transaksi.' });
  }
});

// GET /api/transactions: Mengambil riwayat seluruh transaksi per Coffee Shop
router.get('/', verifyToken, requireRole('super_admin', 'admin', 'kasir'), async (req, res) => {
  try {
    const { startDate, start_date, endDate, end_date, paymentMethodId, payment_method_id, cashierId, cashier_id, status, search, limit, offset } = req.query;
    const merchantId = getTenantMerchantId(req);

    let query = `
      SELECT st.id,
             st.receipt_number,
             st.cashier_id,
             st.merchant_id,
             m.name AS merchant_name,
             m.slug AS merchant_slug,
             u.name AS cashier_name,
             st.payment_method_id,
             pm.name AS payment_method_name,
             st.total_amount,
             st.amount_paid,
             st.change_amount,
             st.status,
             st.customer_name,
             st.notes,
             st.created_at,
             COUNT(ti.id)::int AS item_count,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', ti.id,
                   'product_id', ti.product_id,
                   'product_name', ti.product_name,
                   'name', ti.product_name,
                   'quantity', ti.quantity,
                   'qty', ti.quantity,
                   'unit_price', ti.unit_price,
                   'price', ti.unit_price,
                   'subtotal', ti.subtotal,
                   'station', ti.station,
                   'item_status', ti.item_status,
                    'processed_by', ti.processed_by,
                   'notes', ti.notes,
                   'category', COALESCE(c.name, 'Menu Kafe')
                 ) ORDER BY ti.id ASC
               ) FILTER (WHERE ti.id IS NOT NULL),
               '[]'::json
             ) AS items
      FROM sales_transactions st
      LEFT JOIN merchants m ON m.id = st.merchant_id
      LEFT JOIN users u ON u.id = st.cashier_id
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      LEFT JOIN transaction_items ti ON ti.transaction_id = st.id
      LEFT JOIN products p ON p.id = ti.product_id
      LEFT JOIN categories c ON c.id = p.category_id
    `;

    const whereParts = [];
    const params = [];

    if (merchantId) {
      params.push(merchantId);
      whereParts.push(`st.merchant_id = $${params.length}`);
    }

    const start = startDate || start_date;
    if (start) {
      params.push(start);
      whereParts.push(`st.created_at >= $${params.length}::timestamp`);
    }

    const end = endDate || end_date;
    if (end) {
      params.push(end);
      whereParts.push(`st.created_at <= ($${params.length}::date + INTERVAL '1 day')`);
    }

    const pmId = paymentMethodId || payment_method_id;
    if (pmId) {
      params.push(pmId);
      whereParts.push(`st.payment_method_id = $${params.length}`);
    }

    const cId = cashierId || cashier_id;
    if (cId) {
      params.push(cId);
      whereParts.push(`st.cashier_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      whereParts.push(`st.status = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereParts.push(`(st.receipt_number ILIKE $${params.length} OR st.customer_name ILIKE $${params.length} OR u.name ILIKE $${params.length} OR m.name ILIKE $${params.length})`);
    }

    if (whereParts.length > 0) {
      query += ' WHERE ' + whereParts.join(' AND ');
    }

    query += `
      GROUP BY st.id, u.name, pm.name, m.name, m.slug
      ORDER BY st.id DESC
    `;

    if (limit && Number(limit) > 0) {
      params.push(Number(limit));
      query += ` LIMIT $${params.length}`;
    }

    if (offset && Number(offset) >= 0) {
      params.push(Number(offset));
      query += ` OFFSET $${params.length}`;
    }

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Fetch transactions error:', error.message);
    res.status(500).json({ message: 'Gagal memuat data riwayat transaksi.' });
  }
});

// GET /api/transactions/:id: Detail transaksi
router.get('/:id', verifyToken, requireRole('super_admin', 'admin', 'kasir'), async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req);
    let query = `
      SELECT st.id,
             st.receipt_number,
             st.cashier_id,
             st.merchant_id,
             m.name AS merchant_name,
             m.slug AS merchant_slug,
             u.name AS cashier_name,
             st.payment_method_id,
             pm.name AS payment_method_name,
             st.total_amount,
             st.amount_paid,
             st.change_amount,
             st.status,
             st.customer_name,
             st.notes,
             st.created_at
      FROM sales_transactions st
      LEFT JOIN merchants m ON m.id = st.merchant_id
      LEFT JOIN users u ON u.id = st.cashier_id
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      WHERE st.id = $1
    `;
    const params = [req.params.id];
    if (merchantId && req.user?.role !== 'super_admin') {
      params.push(merchantId);
      query += ` AND st.merchant_id = $${params.length}`;
    }

    const trxRes = await pool.query(query, params);

    if (trxRes.rows.length === 0) {
      return res.status(404).json({ message: 'Transaksi tidak ditemukan.' });
    }

    const itemsRes = await pool.query(
      `SELECT id, product_id, product_name, quantity, unit_price, subtotal, station, item_status, processed_by, notes,
              created_at_millis, processing_at_millis, completed_at_millis
       FROM transaction_items
       WHERE transaction_id = $1
       ORDER BY id ASC`,
      [req.params.id]
    );

    const logsRes = await pool.query(
      `SELECT id, transaction_id, item_id, receipt_number, product_name, station, status,
              created_at_millis, processing_at_millis, completed_at_millis, updated_by, notes, created_at
       FROM order_logs
       WHERE transaction_id = $1
       ORDER BY id ASC`,
      [req.params.id]
    );

    res.json({
      ...trxRes.rows[0],
      items: itemsRes.rows,
      order_logs: logsRes.rows,
    });
  } catch (error) {
    console.error('Fetch transaction detail error:', error.message);
    res.status(500).json({ message: 'Gagal memuat detail transaksi.' });
  }
});

// POST /api/transactions: Menyimpan transaksi baru dari kasir/admin
router.post('/', verifyToken, requireRole('kasir', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      receipt_number,
      payment_method_id,
      total_amount,
      amount_paid,
      change_amount,
      customer_name,
      notes,
      items,
      created_at_millis,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Item pesanan tidak boleh kosong.' });
    }

    const finalReceiptNumber = (receipt_number && receipt_number.trim()) ? receipt_number.trim() : generateReceiptCode();

    const validCashierId = req.user.id;
    const targetMerchantId = req.user.merchant_id || 1;
    const nowMillis = Number(created_at_millis) || Date.now();

    await client.query('BEGIN');

    // Resolve / validasi payment_method_id
    let validPmId = payment_method_id;
    if (validPmId) {
      const pmCheck = await client.query('SELECT id FROM payment_methods WHERE id = $1', [validPmId]);
      if (pmCheck.rows.length === 0) {
        validPmId = null;
      }
    }

    if (!validPmId) {
      const pmRes = await client.query('SELECT id FROM payment_methods WHERE is_active = true AND merchant_id = $1 ORDER BY id ASC LIMIT 1', [targetMerchantId]);
      if (pmRes.rows.length > 0) {
        validPmId = pmRes.rows[0].id;
      } else {
        const anyPm = await client.query('SELECT id FROM payment_methods WHERE is_active = true ORDER BY id ASC LIMIT 1');
        validPmId = anyPm.rows.length > 0 ? anyPm.rows[0].id : null;
      }
    }

    // Insert sales_transactions with merchant_id
    const trxInsert = await client.query(
      `INSERT INTO sales_transactions (
         receipt_number, cashier_id, payment_method_id, 
         total_amount, amount_paid, change_amount, 
         status, customer_name, notes, merchant_id, created_at, created_at_millis
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, COALESCE($10::timestamp, NOW()), $11)
       RETURNING id, receipt_number, cashier_id, merchant_id, total_amount, amount_paid, change_amount, status, created_at, created_at_millis`,
      [
        finalReceiptNumber,
        validCashierId,
        validPmId,
        Number(total_amount) || 0,
        Number(amount_paid) || 0,
        Number(change_amount) || 0,
        customer_name?.trim() || null,
        notes?.trim() || null,
        targetMerchantId,
        req.body.created_at || null,
        nowMillis,
      ]
    );

    const newTrx = trxInsert.rows[0];
    const insertedItems = [];
    const insertedLogs = [];

    // Insert each transaction_item with resolved station and pending status + order_logs entry
    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unit_price || item.price) || 0;
      const subtotal = Number(item.subtotal) || qty * price;
      const prodName = (item.product_name || item.name || 'Menu').trim();
      const itemMillis = Number(item.created_at_millis) || nowMillis;
      
      let station = item.station;
      if (!station || !['barista', 'kitchen', 'none'].includes(station)) {
        station = await resolveItemStation(item.product_id, prodName);
      }

      let validProductId = null;
      if (item.product_id && !isNaN(Number(item.product_id))) {
        const pCheck = await client.query('SELECT id FROM products WHERE id = $1', [Number(item.product_id)]);
        if (pCheck.rows.length > 0) validProductId = pCheck.rows[0].id;
      }
      if (!validProductId && prodName) {
        const pFind = await client.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND merchant_id = $2 LIMIT 1', [prodName, targetMerchantId]);
        if (pFind.rows.length > 0) validProductId = pFind.rows[0].id;
      }

      const initialItemStatus = station === 'none' ? 'completed' : 'pending';
      const initialLogStatus = station === 'none' ? 'selesai' : 'masuk';

      const itemInsert = await client.query(
        `INSERT INTO transaction_items (
           transaction_id, product_id, product_name, 
           quantity, unit_price, subtotal, 
           station, item_status, notes, created_at_millis,
           completed_at_millis
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, transaction_id, product_id, product_name, quantity, unit_price, subtotal, station, item_status, notes, created_at_millis`,
        [
          newTrx.id,
          validProductId,
          prodName,
          qty,
          price,
          subtotal,
          station,
          initialItemStatus,
          item.notes?.trim() || null,
          itemMillis,
          station === 'none' ? itemMillis : null,
        ]
      );

      const insertedItem = itemInsert.rows[0];
      insertedItems.push(insertedItem);

      // Catat log pesanan awal masuk dengan currentmillis & merchant_id
      const logInsert = await client.query(
        `INSERT INTO order_logs (
           transaction_id, item_id, receipt_number, product_name, station, 
           status, created_at_millis, completed_at_millis, updated_by, notes, merchant_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, transaction_id, item_id, receipt_number, product_name, station, status, created_at_millis, updated_by`,
        [
          newTrx.id,
          insertedItem.id,
          newTrx.receipt_number,
          prodName,
          station,
          initialLogStatus,
          itemMillis,
          station === 'none' ? itemMillis : null,
          req.user.name || 'Kasir',
          item.notes?.trim() || null,
          targetMerchantId,
        ]
      );
      insertedLogs.push(logInsert.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Transaksi dan pesanan dapur/barista berhasil dibuat.',
      transaction: {
        ...newTrx,
        cashier_name: req.user.name,
        items: insertedItems,
        order_logs: insertedLogs,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create transaction error:', error.message);
    res.status(500).json({ message: 'Gagal menyimpan transaksi.' });
  } finally {
    client.release();
  }
});

// POST /api/transactions/sync-batch: Batch sinkronisasi transaksi offline SQLite
router.post('/sync-batch', optionalToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ message: 'Array transaksi offline tidak boleh kosong.' });
    }

    await client.query('BEGIN');

    let defaultCashierId = null;
    const defaultMerchantId = req.user?.merchant_id || 1;
    const userFallback = await client.query("SELECT id FROM users WHERE role = 'kasir' AND is_active = true ORDER BY id ASC LIMIT 1");
    if (userFallback.rows.length > 0) defaultCashierId = userFallback.rows[0].id;

    let syncedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const trx of transactions) {
      const receiptNo = (trx.receipt_number || trx.receiptNumber || '').trim();
      if (!receiptNo) continue;

      const validCashierId = (req.user ? req.user.id : null) || trx.cashier_id || defaultCashierId;

      // 1. Resolve targetMerchantId for this transaction
      let targetMerchantId = trx.merchant_id || trx.merchantId || (req.user?.merchant_id) || null;
      if (!targetMerchantId && validCashierId) {
        const uRes = await client.query('SELECT merchant_id FROM users WHERE id = $1', [validCashierId]);
        if (uRes.rows.length > 0 && uRes.rows[0].merchant_id) {
          targetMerchantId = uRes.rows[0].merchant_id;
        }
      }
      if (!targetMerchantId && trx.cashier_name) {
        const uRes = await client.query('SELECT merchant_id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1', [trx.cashier_name.trim()]);
        if (uRes.rows.length > 0 && uRes.rows[0].merchant_id) {
          targetMerchantId = uRes.rows[0].merchant_id;
        }
      }
      if (!targetMerchantId) {
        targetMerchantId = defaultMerchantId || 1;
      }

      // 2. Cek idempotency: Jangan duplikasi jika receipt_number sudah tercatat untuk merchant ini
      const existCheck = await client.query(
        'SELECT id FROM sales_transactions WHERE receipt_number = $1 AND merchant_id = $2',
        [receiptNo, targetMerchantId]
      );
      if (existCheck.rows.length > 0) {
        skippedCount++;
        results.push({
          receipt_number: receiptNo,
          merchant_id: targetMerchantId,
          status: 'already_exists',
          id: existCheck.rows[0].id,
        });
        continue;
      }

      // 3. Resolve payment_method_id
      let validPmId = trx.payment_method_id || trx.paymentMethodId || null;
      if (validPmId && !isNaN(Number(validPmId))) {
        const pmCheck = await client.query('SELECT id FROM payment_methods WHERE id = $1', [Number(validPmId)]);
        if (pmCheck.rows.length === 0) validPmId = null;
      }
      if (!validPmId && trx.payment_method_name) {
        const pmName = trx.payment_method_name.toLowerCase();
        const pmFind = await client.query(
          'SELECT id FROM payment_methods WHERE LOWER(name) LIKE $1 AND (merchant_id = $2 OR merchant_id IS NULL) LIMIT 1',
          [`%${pmName}%`, targetMerchantId]
        );
        if (pmFind.rows.length > 0) validPmId = pmFind.rows[0].id;
      }

      if (!validPmId) {
        const anyPm = await client.query(
          'SELECT id FROM payment_methods WHERE is_active = true AND (merchant_id = $1 OR merchant_id IS NULL) ORDER BY id ASC LIMIT 1',
          [targetMerchantId]
        );
        validPmId = anyPm.rows.length > 0 ? anyPm.rows[0].id : null;
      }

      const trxMillis = Number(trx.created_at_millis) || (trx.created_at ? new Date(trx.created_at).getTime() : Date.now());

      // 4. Insert sales_transactions with resolved merchant_id
      const trxInsert = await client.query(
        `INSERT INTO sales_transactions (
           receipt_number, cashier_id, payment_method_id, 
           total_amount, amount_paid, change_amount, 
           status, customer_name, notes, merchant_id, created_at, created_at_millis
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, COALESCE($10::timestamp, NOW()), $11)
         RETURNING id, receipt_number, cashier_id, merchant_id, total_amount, amount_paid, change_amount, status, created_at, created_at_millis`,
        [
          receiptNo,
          validCashierId,
          validPmId,
          Number(trx.total_amount) || 0,
          Number(trx.amount_paid) || Number(trx.total_amount) || 0,
          Number(trx.change_amount) || 0,
          trx.customer_name?.trim() || null,
          trx.notes?.trim() || trx.order_type || null,
          targetMerchantId,
          trx.created_at || null,
          trxMillis,
        ]
      );

      const newTrx = trxInsert.rows[0];
      const insertedItems = [];

      // 4. Insert items & order_logs
      const items = Array.isArray(trx.items) ? trx.items : [];
      for (const item of items) {
        const qty = Number(item.quantity) || 1;
        const price = Number(item.unit_price || item.price) || 0;
        const subtotal = Number(item.subtotal) || qty * price;
        const prodName = (item.product_name || item.name || 'Menu').trim();
        const itemCreatedMillis = Number(item.created_at_millis) || trxMillis;
        const itemProcMillis = Number(item.processing_at_millis) || null;
        const itemCompMillis = Number(item.completed_at_millis) || null;
        const itemStatus = item.item_status || 'pending';

        let station = item.station;
        if (!station || !['barista', 'kitchen'].includes(station)) {
          station = await resolveItemStation(item.product_id, prodName);
        }

        let validProductId = null;
        if (item.product_id && !isNaN(Number(item.product_id))) {
          const pCheck = await client.query('SELECT id FROM products WHERE id = $1', [Number(item.product_id)]);
          if (pCheck.rows.length > 0) validProductId = pCheck.rows[0].id;
        }
        if (!validProductId && prodName) {
          const pFind = await client.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND merchant_id = $2 LIMIT 1', [prodName, defaultMerchantId]);
          if (pFind.rows.length > 0) validProductId = pFind.rows[0].id;
        }

        const itemInsert = await client.query(
          `INSERT INTO transaction_items (
             transaction_id, product_id, product_name, 
             quantity, unit_price, subtotal, 
             station, item_status, notes,
             created_at_millis, processing_at_millis, completed_at_millis
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, transaction_id, product_id, product_name, quantity, unit_price, subtotal, station, item_status, notes`,
          [
            newTrx.id,
            validProductId,
            prodName,
            qty,
            price,
            subtotal,
            station,
            itemStatus,
            item.notes?.trim() || null,
            itemCreatedMillis,
            itemProcMillis,
            itemCompMillis,
          ]
        );
        const newItem = itemInsert.rows[0];
        insertedItems.push(newItem);

        // Record initial order log
        const logStatus = itemStatus === 'completed' ? 'selesai' : (itemStatus === 'processing' ? 'diproses' : 'masuk');
        await client.query(
          `INSERT INTO order_logs (
             transaction_id, item_id, receipt_number, product_name, station, 
             status, created_at_millis, processing_at_millis, completed_at_millis, updated_by, notes, merchant_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            newTrx.id,
            newItem.id,
            newTrx.receipt_number,
            prodName,
            station,
            logStatus,
            itemCreatedMillis,
            itemProcMillis,
            itemCompMillis,
            trx.cashier_name || req.user?.name || 'Kasir',
            item.notes?.trim() || null,
            defaultMerchantId,
          ]
        );
      }

      syncedCount++;
      results.push({
        receipt_number: receiptNo,
        status: 'synced',
        id: newTrx.id,
        itemsCount: insertedItems.length,
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Berhasil menyinkronkan ${syncedCount} transaksi offline (${skippedCount} sudah ada).`,
      syncedCount,
      skippedCount,
      totalProcessed: transactions.length,
      results,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch sync transactions error:', error.message);
    res.status(500).json({ message: 'Gagal menyinkronkan data transaksi offline.' });
  } finally {
    client.release();
  }
});

// GET /api/transactions/catalog/snapshot: Snapshot data katalog per Coffee Shop untuk cache SQLite offline
router.get('/catalog/snapshot', optionalToken, async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req) || 1;
    const catRes = await pool.query('SELECT id, name, station, merchant_id FROM categories WHERE merchant_id = $1 ORDER BY id ASC', [merchantId]);
    const prodRes = await pool.query(`
      SELECT p.id, p.name, p.price, p.description, p.is_active, p.category_id, p.merchant_id, p.image_url,
             c.name AS category_name, COALESCE(p.station, c.station, 'barista') AS station
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = true AND p.merchant_id = $1
      ORDER BY p.id ASC
    `, [merchantId]);
    const pmRes = await pool.query('SELECT id, name, is_active, merchant_id FROM payment_methods WHERE is_active = true AND merchant_id = $1 ORDER BY id ASC', [merchantId]);

    res.json({
      categories: catRes.rows,
      products: prodRes.rows,
      paymentMethods: pmRes.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Catalog snapshot error:', error.message);
    res.status(500).json({ message: 'Gagal memuat snapshot katalog untuk offline cache.' });
  }
});

module.exports = router;
