const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

// GET /api/dashboard/stats & /summary: Endpoint agregasi ringkasan statistik komprehensif
router.get(['/stats', '/summary', '/'], verifyToken, requireRole('admin', 'super_admin', 'kasir'), async (req, res) => {
  try {
    const merchantId = getTenantMerchantId(req);
    const mCond = merchantId ? `AND st.merchant_id = ${merchantId}` : '';
    const mWhere = merchantId ? `WHERE merchant_id = ${merchantId}` : '';
    const mWhereActive = merchantId ? `WHERE is_active = true AND merchant_id = ${merchantId}` : 'WHERE is_active = true';

    // 1. Statistik Penjualan Hari Ini
    const todayRes = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0)::numeric AS today_revenue,
        COUNT(*)::int AS today_transactions
      FROM sales_transactions st
      WHERE status = 'completed' 
        AND created_at >= CURRENT_DATE 
        AND created_at < CURRENT_DATE + INTERVAL '1 day'
        ${mCond}
    `);

    // 2. Statistik Penjualan Bulan Ini
    const monthRes = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0)::numeric AS month_revenue,
        COUNT(*)::int AS month_transactions
      FROM sales_transactions st
      WHERE status = 'completed' 
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
        AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        ${mCond}
    `);

    // 3. Statistik Penjualan Keseluruhan (All-Time)
    const allTimeRes = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0)::numeric AS total_revenue,
        COUNT(*)::int AS total_transactions,
        COALESCE(AVG(total_amount), 0)::numeric AS average_order_value
      FROM sales_transactions st
      WHERE status = 'completed'
        ${mCond}
    `);

    // 4. Jumlah Data Operasional Master
    const countsRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM products ${mWhereActive}) AS active_products_count,
        (SELECT COUNT(*)::int FROM products ${mWhere}) AS total_products_count,
        (SELECT COUNT(*)::int FROM categories ${mWhere}) AS total_categories_count,
        (SELECT COUNT(*)::int FROM payment_methods ${mWhereActive}) AS active_payment_methods_count,
        (SELECT COUNT(*)::int FROM users ${mWhere ? mWhere + " AND is_active = true AND role != 'super_admin'" : "WHERE is_active = true AND role != 'super_admin'"}) AS active_staff_count,
        (SELECT COUNT(*)::int FROM users ${mWhere ? mWhere + " AND role = 'kasir' AND is_active = true" : "WHERE role = 'kasir' AND is_active = true"}) AS active_cashiers_count,
        (SELECT COUNT(*)::int FROM users ${mWhere ? mWhere + " AND role = 'barista' AND is_active = true" : "WHERE role = 'barista' AND is_active = true"}) AS active_baristas_count,
        (SELECT COUNT(*)::int FROM users ${mWhere ? mWhere + " AND role = 'kitchen' AND is_active = true" : "WHERE role = 'kitchen' AND is_active = true"}) AS active_kitchen_count
    `);

    // 5. Status Antrean Pesanan KDS
    const kdsRes = await pool.query(`
      SELECT 
        ti.station,
        COUNT(CASE WHEN ti.item_status = 'pending' THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN ti.item_status = 'processing' THEN 1 END)::int AS processing_count,
        COUNT(CASE WHEN ti.item_status = 'completed' THEN 1 END)::int AS completed_count,
        COUNT(*)::int AS total_items
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      ${merchantId ? `WHERE st.merchant_id = ${merchantId}` : ''}
      GROUP BY ti.station
    `);

    // 6. Produk Terlaris (Top 5)
    const topProductsRes = await pool.query(`
      SELECT 
        ti.product_name,
        ti.station,
        SUM(ti.quantity)::int AS total_quantity_sold,
        SUM(ti.subtotal)::numeric AS total_sales_amount
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      WHERE st.status = 'completed'
        ${mCond}
      GROUP BY ti.product_name, ti.station
      ORDER BY total_quantity_sold DESC, total_sales_amount DESC
      LIMIT 5
    `);

    // 7. Breakdown Berdasarkan Metode Pembayaran
    const paymentMethodsRes = await pool.query(`
      SELECT 
        COALESCE(pm.name, 'Lainnya') AS payment_method_name,
        COUNT(st.id)::int AS transaction_count,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_amount
      FROM sales_transactions st
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      WHERE st.status = 'completed'
        ${mCond}
      GROUP BY pm.name
      ORDER BY total_amount DESC
    `);

    // 8. Breakdown Penjualan Berdasarkan Stasiun
    const stationSalesRes = await pool.query(`
      SELECT 
        ti.station,
        SUM(ti.quantity)::int AS total_items_sold,
        COALESCE(SUM(ti.subtotal), 0)::numeric AS total_revenue
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      WHERE st.status = 'completed'
        ${mCond}
      GROUP BY ti.station
    `);

    // 9. Transaksi Terkini (5 Transaksi Terbaru)
    const recentTrxRes = await pool.query(`
      SELECT 
        st.id,
        st.receipt_number,
        st.customer_name,
        st.total_amount,
        st.created_at,
        st.status,
        st.merchant_id,
        u.name AS cashier_name,
        pm.name AS payment_method_name,
        COUNT(ti.id)::int AS total_items
      FROM sales_transactions st
      LEFT JOIN users u ON u.id = st.cashier_id
      LEFT JOIN payment_methods pm ON pm.id = st.payment_method_id
      LEFT JOIN transaction_items ti ON ti.transaction_id = st.id
      ${merchantId ? `WHERE st.merchant_id = ${merchantId}` : ''}
      GROUP BY st.id, u.name, pm.name
      ORDER BY st.id DESC
      LIMIT 5
    `);

    // 10. Tren Penjualan 7 Hari Terakhir
    const last7DaysRes = await pool.query(`
      SELECT 
        TO_CHAR(d.date, 'YYYY-MM-DD') AS date,
        TO_CHAR(d.date, 'Dy') AS day_name,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_revenue,
        COUNT(st.id)::int AS transaction_count
      FROM (
        SELECT CURRENT_DATE - i AS date
        FROM generate_series(6, 0, -1) AS i
      ) d
      LEFT JOIN sales_transactions st 
        ON DATE(st.created_at) = d.date AND st.status = 'completed' ${mCond}
      GROUP BY d.date
      ORDER BY d.date ASC
    `);

    // Susun struktur response bersih dan komprehensif
    const counts = countsRes.rows[0];
    const today = todayRes.rows[0];
    const month = monthRes.rows[0];
    const allTime = allTimeRes.rows[0];

    // Format KDS status summary
    const kdsSummary = {
      barista: { pending: 0, processing: 0, completed: 0, total: 0 },
      kitchen: { pending: 0, processing: 0, completed: 0, total: 0 },
    };
    for (const row of kdsRes.rows) {
      if (kdsSummary[row.station]) {
        kdsSummary[row.station] = {
          pending: row.pending_count,
          processing: row.processing_count,
          completed: row.completed_count,
          total: row.total_items,
        };
      }
    }

    res.json({
      summary: {
        today_revenue: Number(today.today_revenue),
        today_transactions: today.today_transactions,
        month_revenue: Number(month.month_revenue),
        month_transactions: month.month_transactions,
        total_revenue: Number(allTime.total_revenue),
        total_transactions: allTime.total_transactions,
        average_order_value: Number(Number(allTime.average_order_value).toFixed(2)),
      },
      master_data: {
        active_products: counts.active_products_count,
        total_products: counts.total_products_count,
        total_categories: counts.total_categories_count,
        active_payment_methods: counts.active_payment_methods_count,
        active_staff: counts.active_staff_count,
        staff_by_role: {
          kasir: counts.active_cashiers_count,
          barista: counts.active_baristas_count,
          kitchen: counts.active_kitchen_count,
        },
      },
      kds_status: kdsSummary,
      top_products: topProductsRes.rows.map((p) => ({
        name: p.product_name,
        station: p.station,
        quantity_sold: p.total_quantity_sold,
        total_sales: Number(p.total_sales_amount),
      })),
      sales_by_payment_method: paymentMethodsRes.rows.map((pm) => ({
        name: pm.payment_method_name,
        transaction_count: pm.transaction_count,
        total_amount: Number(pm.total_amount),
      })),
      sales_by_station: stationSalesRes.rows.map((s) => ({
        station: s.station,
        items_sold: s.total_items_sold,
        total_revenue: Number(s.total_revenue),
      })),
      recent_transactions: recentTrxRes.rows,
      sales_trend_7_days: last7DaysRes.rows.map((t) => ({
        date: t.date,
        day: t.day_name,
        revenue: Number(t.total_revenue || t.revenue || 0),
        transaction_count: t.transaction_count,
      })),
    });
  } catch (error) {
    console.error('Dashboard stats fetch error:', error.message);
    res.status(500).json({ message: 'Gagal memuat statistik dashboard.' });
  }
});

module.exports = router;
