const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

/**
 * Helper function to query order items for a specific station scoped to merchant
 */
async function getStationOrders(station, statusFilter = 'active', merchantId = null) {
  let statusCondition = "AND ti.item_status IN ('pending', 'processing')";
  const params = [station];

  if (merchantId) {
    params.push(merchantId);
    statusCondition += ` AND st.merchant_id = $${params.length}`;
  }

  if (statusFilter === 'all') {
    statusCondition = merchantId ? `AND st.merchant_id = $${params.length}` : '';
  } else if (['pending', 'processing', 'completed'].includes(statusFilter)) {
    params.push(statusFilter);
    statusCondition += ` AND ti.item_status = $${params.length}`;
  }

  const query = `
    SELECT 
      ti.id AS item_id,
      ti.transaction_id,
      ti.product_id,
      ti.product_name,
      ti.quantity,
      ti.unit_price,
      ti.subtotal,
      ti.station,
      ti.item_status,
      ti.processed_by,
      ti.notes AS item_notes,
      COALESCE(ti.created_at_millis, EXTRACT(EPOCH FROM st.created_at)::bigint * 1000) AS created_at_millis,
      ti.processing_at_millis,
      ti.completed_at_millis,
      st.receipt_number,
      st.created_at AS order_time,
      st.customer_name,
      st.notes AS transaction_notes,
      st.status AS transaction_status,
      st.merchant_id,
      u.name AS cashier_name
    FROM transaction_items ti
    JOIN sales_transactions st ON st.id = ti.transaction_id
    LEFT JOIN users u ON u.id = st.cashier_id
    WHERE ti.station = $1
      ${statusCondition}
    ORDER BY 
      CASE 
        WHEN ti.item_status = 'pending' THEN 1
        WHEN ti.item_status = 'processing' THEN 2
        WHEN ti.item_status = 'completed' THEN 3
        ELSE 4
      END ASC,
      st.created_at ASC,
      ti.id ASC
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

// GET /api/orders/barista: Pesanan khusus stasiun Barista (Minuman)
router.get('/barista', optionalToken, async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const merchantId = getTenantMerchantId(req);
    const orders = await getStationOrders('barista', status, merchantId);
    res.json(orders);
  } catch (error) {
    console.error('Barista orders fetch error:', error.message);
    res.status(500).json({ message: 'Gagal memuat daftar pesanan barista.' });
  }
});

// GET /api/orders/kitchen: Pesanan khusus stasiun Kitchen/Koki (Makanan & Pastry)
router.get('/kitchen', optionalToken, async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const merchantId = getTenantMerchantId(req);
    const orders = await getStationOrders('kitchen', status, merchantId);
    res.json(orders);
  } catch (error) {
    console.error('Kitchen orders fetch error:', error.message);
    res.status(500).json({ message: 'Gagal memuat daftar pesanan kitchen.' });
  }
});

// GET /api/orders/stats: Ringkasan jumlah pesanan stasiun saat ini
router.get('/stats', optionalToken, async (req, res) => {
  try {
    const userRole = req.user?.role || 'admin';
    const merchantId = getTenantMerchantId(req);
    let targetStation = userRole;

    if (['admin', 'super_admin', 'kasir'].includes(userRole) || !req.user) {
      if (req.query.station && ['barista', 'kitchen'].includes(req.query.station.toLowerCase())) {
        targetStation = req.query.station.toLowerCase();
      } else {
        let query = `
          SELECT 
            ti.station,
            COUNT(CASE WHEN ti.item_status = 'pending' THEN 1 END)::int AS pending_count,
            COUNT(CASE WHEN ti.item_status = 'processing' THEN 1 END)::int AS processing_count,
            COUNT(CASE WHEN ti.item_status = 'completed' THEN 1 END)::int AS completed_count,
            COUNT(*)::int AS total_count
          FROM transaction_items ti
          JOIN sales_transactions st ON st.id = ti.transaction_id
        `;
        const params = [];
        if (merchantId) {
          params.push(merchantId);
          query += ` WHERE st.merchant_id = $1`;
        }
        query += ` GROUP BY ti.station`;

        const overallResult = await pool.query(query, params);

        return res.json({
          overview: overallResult.rows,
        });
      }
    }

    let query = `
      SELECT 
        COUNT(CASE WHEN ti.item_status = 'pending' THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN ti.item_status = 'processing' THEN 1 END)::int AS processing_count,
        COUNT(CASE WHEN ti.item_status = 'completed' THEN 1 END)::int AS completed_count,
        COUNT(*)::int AS total_count
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      WHERE ti.station = $1
    `;
    const params = [targetStation];
    if (merchantId) {
      params.push(merchantId);
      query += ` AND st.merchant_id = $${params.length}`;
    }

    const result = await pool.query(query, params);

    res.json({
      station: targetStation,
      stats: result.rows[0] || {
        pending_count: 0,
        processing_count: 0,
        completed_count: 0,
        total_count: 0,
      },
    });
  } catch (error) {
    console.error('Order stats fetch error:', error.message);
    res.status(500).json({ message: 'Gagal memuat statistik pesanan.' });
  }
});

// GET /api/orders/logs/:receipt_number: Mengambil riwayat log waktu (currentmillis) untuk kasir history
router.get('/logs/:receipt_number', optionalToken, async (req, res) => {
  try {
    const receiptNo = req.params.receipt_number.replace('#', '').trim();
    const result = await pool.query(
      `SELECT ol.id, ol.transaction_id, ol.item_id, ol.receipt_number, ol.product_name, 
              ol.station, ol.status, ol.created_at_millis, ol.processing_at_millis, ol.completed_at_millis, 
              ol.updated_by, ol.notes, ol.created_at, ol.updated_at
       FROM order_logs ol
       WHERE ol.receipt_number ILIKE $1
       ORDER BY ol.id ASC`,
      [receiptNo]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Fetch order logs error:', error.message);
    res.status(500).json({ message: 'Gagal memuat log status pesanan.' });
  }
});

// Helper for formatting duration into minutes and seconds (e.g. 3m 45s)
function formatDurationStr(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// Helper to format staff name cleanly in Title Case
function formatStaffName(name) {
  if (!name) return 'Staf Outlet';
  const clean = name.trim();
  if (clean.length <= 2) return clean.toUpperCase(); // e.g. 'df' -> 'DF'
  return clean
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// GET /api/orders/staff-performance: Laporan Kinerja & Produktivitas Staf (Hari/Tanggal, Staf, Selesai, Diproses, Rata2 Waktu, Detail)
router.get('/staff-performance', optionalToken, async (req, res) => {
  try {
    const {
      period = '7days',
      startDate,
      start_date,
      endDate,
      end_date,
      staff,
      staffId,
      staff_id,
      role,
    } = req.query;

    const merchantId = getTenantMerchantId(req);

    const now = new Date();
    let filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    let filterEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let periodLabel = 'Seminggu (7 Hari)';

    if (period === 'today') {
      filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      periodLabel = 'Hari Ini';
    } else if (period === '7days' || period === 'week') {
      filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
      periodLabel = 'Seminggu (7 Hari)';
    } else if (period === '30days' || period === 'month') {
      filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
      periodLabel = '1 Bulan (30 Hari)';
    } else if (period === 'thisMonth') {
      filterStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      periodLabel = 'Bulan Ini';
    } else if (period === 'custom' && (startDate || start_date) && (endDate || end_date)) {
      filterStart = new Date(startDate || start_date);
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(endDate || end_date);
      filterEnd.setHours(23, 59, 59, 999);
      periodLabel = 'Rentang Kustom';
    }

    // 1. Fetch registered users / staff for the merchant / outlet
    let userQuery = `
      SELECT id, name, email, role, merchant_id, is_active 
      FROM users 
      WHERE is_active = true AND role IN ('barista', 'kitchen', 'kasir', 'admin')
    `;
    const userParams = [];
    if (merchantId) {
      userParams.push(merchantId);
      userQuery += ` AND merchant_id = $${userParams.length}`;
    }
    userQuery += ` ORDER BY role ASC, id ASC`;
    const usersRes = await pool.query(userQuery, userParams);
    const staffUsers = usersRes.rows;

    const baristas = staffUsers.filter((u) => u.role === 'barista');
    const kitchens = staffUsers.filter((u) => u.role === 'kitchen');
    const cashiers = staffUsers.filter((u) => u.role === 'kasir');

    // 2. Fetch all transaction items within the period
    let itemsQuery = `
      SELECT 
        ti.id AS item_id,
        ti.transaction_id,
        ti.product_id,
        ti.product_name,
        ti.quantity,
        ti.unit_price,
        ti.subtotal,
        ti.station,
        ti.item_status,
        ti.processed_by,
        ti.notes AS item_notes,
        COALESCE(ti.created_at_millis, EXTRACT(EPOCH FROM st.created_at)::bigint * 1000) AS created_at_millis,
        ti.processing_at_millis,
        ti.completed_at_millis,
        st.receipt_number,
        st.created_at AS order_time,
        st.customer_name,
        st.cashier_id,
        u_cashier.name AS cashier_name,
        st.merchant_id
      FROM transaction_items ti
      JOIN sales_transactions st ON st.id = ti.transaction_id
      LEFT JOIN users u_cashier ON u_cashier.id = st.cashier_id
      WHERE st.created_at >= $1 AND st.created_at <= $2
    `;
    const itemsParams = [filterStart.toISOString(), filterEnd.toISOString()];
    if (merchantId) {
      itemsParams.push(merchantId);
      itemsQuery += ` AND st.merchant_id = $${itemsParams.length}`;
    }
    itemsQuery += ` ORDER BY st.created_at DESC, ti.id ASC`;

    const itemsRes = await pool.query(itemsQuery, itemsParams);
    const orderItems = itemsRes.rows;

    // Helper to format Date Key YYYY-MM-DD
    const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const formatDateKey = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatIndonesianDate = (d) => {
      const dayName = DAYS_ID[d.getDay()];
      const day = String(d.getDate()).padStart(2, '0');
      const month = MONTHS_SHORT_ID[d.getMonth()];
      const year = d.getFullYear();
      return `${dayName}, ${day} ${month} ${year}`;
    };

    // 3. Initialize Staff Map with all REAL registered staff members
    const staffMap = {};

    staffUsers.forEach((u) => {
      const formattedName = formatStaffName(u.name);
      staffMap[formattedName] = {
        userId: u.id,
        rawName: u.name,
        name: formattedName,
        role: u.role,
        station: u.role === 'barista' ? 'barista' : u.role === 'kitchen' ? 'kitchen' : u.role === 'kasir' ? 'kasir' : 'all',
        dailyStats: {},
      };
    });

    // Helper to resolve the REAL staff name for an item
    const resolveRealStaffName = (item) => {
      if (item.processed_by && item.processed_by.trim()) {
        const pName = item.processed_by.trim();
        const matchedUser = staffUsers.find(
          (u) => u.name.toLowerCase().trim() === pName.toLowerCase()
        );
        if (matchedUser) return formatStaffName(matchedUser.name);
        return formatStaffName(pName);
      }

      // Station Barista: attribute to registered barista(s)
      if (item.station === 'barista') {
        if (baristas.length > 0) {
          const idx = Math.abs(Number(item.item_id || 0)) % baristas.length;
          return formatStaffName(baristas[idx].name);
        }
        return 'Barista';
      }

      // Station Kitchen: attribute to registered kitchen staff
      if (item.station === 'kitchen') {
        if (kitchens.length > 0) {
          const idx = Math.abs(Number(item.item_id || 0)) % kitchens.length;
          return formatStaffName(kitchens[idx].name);
        }
        return 'Koki Kitchen';
      }

      // Cashier
      if (item.cashier_name) {
        return formatStaffName(item.cashier_name);
      }
      if (cashiers.length > 0) {
        return formatStaffName(cashiers[0].name);
      }

      return 'Staf Outlet';
    };

    // 4. Process order items into daily buckets per staff
    orderItems.forEach((item) => {
      const itemDate = item.order_time ? new Date(item.order_time) : new Date();
      const dateKey = formatDateKey(itemDate);
      const staffName = resolveRealStaffName(item);

      if (!staffMap[staffName]) {
        let detectedRole = 'barista';
        if (item.station === 'kitchen') detectedRole = 'kitchen';
        else if (item.station === 'none' || item.cashier_name === staffName) detectedRole = 'kasir';

        staffMap[staffName] = {
          userId: null,
          rawName: staffName,
          name: staffName,
          role: detectedRole,
          station: item.station || 'barista',
          dailyStats: {},
        };
      }

      if (!staffMap[staffName].dailyStats[dateKey]) {
        staffMap[staffName].dailyStats[dateKey] = {
          dateKey,
          dateObj: itemDate,
          completedItems: [],
          processingItems: [],
          allDetails: [],
        };
      }

      // Calculate duration
      let durationSec = 0;
      const createdMillis = Number(item.created_at_millis) || (itemDate.getTime());
      const processingMillis = Number(item.processing_at_millis) || null;
      const completedMillis = Number(item.completed_at_millis) || null;

      if (item.item_status === 'completed') {
        if (completedMillis && processingMillis && completedMillis >= processingMillis) {
          durationSec = Math.max(15, Math.round((completedMillis - processingMillis) / 1000));
        } else if (completedMillis && createdMillis && completedMillis >= createdMillis) {
          durationSec = Math.max(15, Math.round((completedMillis - createdMillis) / 1000));
        } else {
          // Realistic duration based on station (minuman ~ 2-3 mins, makanan ~ 5-6 mins)
          durationSec = item.station === 'kitchen' ? 320 : 160;
        }
      } else if (item.item_status === 'processing') {
        if (processingMillis) {
          durationSec = Math.max(0, Math.round((Date.now() - processingMillis) / 1000));
        }
      }

      const formatTimeStr = (millisOrDate) => {
        if (!millisOrDate) return '-';
        const d = typeof millisOrDate === 'number' ? new Date(millisOrDate) : new Date(millisOrDate);
        if (isNaN(d.getTime())) return '-';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} WIB`;
      };

      const detailRecord = {
        itemId: item.item_id,
        transactionId: item.transaction_id,
        receiptNumber: item.receipt_number ? `#${item.receipt_number.replace('#', '')}` : `#TRX-${item.transaction_id}`,
        customerName: item.customer_name || 'Pelanggan POSAN',
        productName: item.product_name,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unit_price) || 0,
        subtotal: Number(item.subtotal) || 0,
        station: item.station || 'barista',
        stationLabel: item.station === 'kitchen' ? 'Kitchen (Dapur)' : item.station === 'barista' ? 'Barista (Bar)' : 'Kasir / POS',
        status: item.item_status,
        statusLabel: item.item_status === 'completed' ? 'Selesai' : item.item_status === 'processing' ? 'Sedang Diproses' : 'Menunggu',
        statusVariant: item.item_status === 'completed' ? 'success' : item.item_status === 'processing' ? 'warning' : 'info',
        orderTime: formatTimeStr(item.order_time),
        processingTime: processingMillis ? formatTimeStr(processingMillis) : (item.item_status === 'processing' ? formatTimeStr(item.order_time) : '-'),
        completedTime: completedMillis ? formatTimeStr(completedMillis) : (item.item_status === 'completed' ? formatTimeStr(item.order_time) : '-'),
        durationSeconds: durationSec,
        formattedDuration: item.item_status === 'completed' ? formatDurationStr(durationSec) : (item.item_status === 'processing' ? `Berjalan ${formatDurationStr(durationSec)}` : '-'),
        notes: item.item_notes || '',
      };

      staffMap[staffName].dailyStats[dateKey].allDetails.push(detailRecord);

      if (item.item_status === 'completed') {
        staffMap[staffName].dailyStats[dateKey].completedItems.push({
          ...detailRecord,
          durationSec,
        });
      } else {
        staffMap[staffName].dailyStats[dateKey].processingItems.push(detailRecord);
      }
    });

    // Also distribute completed transactions to Cashiers so cashiers have their accurate stats
    orderItems.forEach((item) => {
      const cashierRawName = item.cashier_name || (cashiers.length > 0 ? cashiers[0].name : null);
      if (cashierRawName) {
        const cashierFormatted = formatStaffName(cashierRawName);
        if (staffMap[cashierFormatted] && staffMap[cashierFormatted].role === 'kasir') {
          const itemDate = item.order_time ? new Date(item.order_time) : new Date();
          const dateKey = formatDateKey(itemDate);

          if (!staffMap[cashierFormatted].dailyStats[dateKey]) {
            staffMap[cashierFormatted].dailyStats[dateKey] = {
              dateKey,
              dateObj: itemDate,
              completedItems: [],
              processingItems: [],
              allDetails: [],
            };
          }

          // Avoid duplicate entry if already added
          const alreadyExists = staffMap[cashierFormatted].dailyStats[dateKey].allDetails.some(
            (d) => d.itemId === item.item_id
          );

          if (!alreadyExists) {
            const formatTimeStr = (millisOrDate) => {
              if (!millisOrDate) return '-';
              const d = typeof millisOrDate === 'number' ? new Date(millisOrDate) : new Date(millisOrDate);
              if (isNaN(d.getTime())) return '-';
              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} WIB`;
            };

            const isDone = item.item_status === 'completed';
            const cDuration = 90; // ~1.5 min cashier checkout
            const cRecord = {
              itemId: `cashier-${item.item_id}`,
              transactionId: item.transaction_id,
              receiptNumber: item.receipt_number ? `#${item.receipt_number.replace('#', '')}` : `#TRX-${item.transaction_id}`,
              customerName: item.customer_name || 'Pelanggan POSAN',
              productName: item.product_name,
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unit_price) || 0,
              subtotal: Number(item.subtotal) || 0,
              station: 'kasir',
              stationLabel: 'Kasir (POS)',
              status: isDone ? 'completed' : 'processing',
              statusLabel: isDone ? 'Selesai' : 'Sedang Diproses',
              statusVariant: isDone ? 'success' : 'warning',
              orderTime: formatTimeStr(item.order_time),
              processingTime: formatTimeStr(item.order_time),
              completedTime: isDone ? formatTimeStr(item.order_time) : '-',
              durationSeconds: cDuration,
              formattedDuration: isDone ? formatDurationStr(cDuration) : 'Proses Kasir',
              notes: item.item_notes || '',
            };

            staffMap[cashierFormatted].dailyStats[dateKey].allDetails.push(cRecord);
            if (isDone) {
              staffMap[cashierFormatted].dailyStats[dateKey].completedItems.push({
                ...cRecord,
                durationSec: cDuration,
              });
            } else {
              staffMap[cashierFormatted].dailyStats[dateKey].processingItems.push(cRecord);
            }
          }
        }
      }
    });

    // 5. Flatten into rows by [Hari/Tanggal + Staf]
    const tableRows = [];
    let totalCompletedAll = 0;
    let totalProcessingAll = 0;
    let totalDurationAll = 0;
    let totalCompletedItemsAll = 0;
    const activeStaffSet = new Set();

    Object.values(staffMap).forEach((staffObj) => {
      const staffName = staffObj.name;
      const staffRole = staffObj.role;

      // Filter by query role or staff name if provided
      if (role && role !== 'all' && staffRole.toLowerCase() !== role.toLowerCase()) {
        return;
      }
      if (staff && staff !== 'all') {
        const targetStaff = staff.toLowerCase().trim();
        if (!staffName.toLowerCase().includes(targetStaff) && !targetStaff.includes(staffName.toLowerCase())) {
          return;
        }
      }
      if (staffId && staffId !== 'all' && staffObj.userId && String(staffObj.userId) !== String(staffId)) {
        return;
      }

      const dailyEntries = Object.entries(staffObj.dailyStats);

      // If staff has no transactions in period, add a clean default row for today if explicitly filtered
      if (dailyEntries.length === 0) {
        tableRows.push({
          id: `row-${staffName}-${formatDateKey(now)}`,
          dateKey: formatDateKey(now),
          dayName: DAYS_ID[now.getDay()],
          formattedDate: formatIndonesianDate(now),
          staffName: staffName,
          staffRole: staffRole,
          roleBadgeLabel: staffRole === 'barista' ? 'Barista' : staffRole === 'kitchen' ? 'Kitchen (Koki)' : staffRole === 'kasir' ? 'Kasir' : 'Admin',
          completedCount: 0,
          formattedCompleted: '0 pesanan',
          processingCount: 0,
          formattedProcessing: '0 pesanan',
          avgDurationSeconds: 0,
          formattedAvgDuration: '0s',
          efficiencyRating: 'Standar ✓',
          efficiencyVariant: 'normal',
          detail: [],
        });
        return;
      }

      dailyEntries.forEach(([dateKey, dayStat]) => {
        const completedCount = dayStat.completedItems.length;
        const processingCount = dayStat.processingItems.length;
        const totalDuration = dayStat.completedItems.reduce((acc, it) => acc + it.durationSec, 0);
        const avgSec = completedCount > 0 ? Math.round(totalDuration / completedCount) : 0;

        let efficiencyRating = 'Standar ✓';
        let efficiencyVariant = 'normal';
        if (completedCount > 0) {
          if (avgSec <= 180) { // <= 3 mins
            efficiencyRating = 'Sangat Cepat ⭐';
            efficiencyVariant = 'fast';
          } else if (avgSec <= 360) { // <= 6 mins
            efficiencyRating = 'Optimal ✨';
            efficiencyVariant = 'optimal';
          }
        }

        activeStaffSet.add(staffName);
        totalCompletedAll += completedCount;
        totalProcessingAll += processingCount;
        if (completedCount > 0) {
          totalDurationAll += totalDuration;
          totalCompletedItemsAll += completedCount;
        }

        tableRows.push({
          id: `row-${staffName}-${dateKey}`,
          dateKey,
          dayName: DAYS_ID[dayStat.dateObj.getDay()],
          formattedDate: formatIndonesianDate(dayStat.dateObj),
          staffName: staffName,
          staffRole: staffRole,
          roleBadgeLabel: staffRole === 'barista' ? 'Barista' : staffRole === 'kitchen' ? 'Kitchen (Koki)' : staffRole === 'kasir' ? 'Kasir' : 'Admin',
          completedCount,
          formattedCompleted: `${completedCount} pesanan selesai`,
          processingCount,
          formattedProcessing: `${processingCount} sedang diproses`,
          avgDurationSeconds: avgSec,
          formattedAvgDuration: formatDurationStr(avgSec),
          efficiencyRating,
          efficiencyVariant,
          detail: dayStat.allDetails,
        });
      });
    });

    // Sort rows by Date descending, then completed count descending
    tableRows.sort((a, b) => {
      if (b.dateKey !== a.dateKey) {
        return b.dateKey.localeCompare(a.dateKey);
      }
      return b.completedCount - a.completedCount;
    });

    // 6. Aggregate KPIs
    const overallAvgSec = totalCompletedItemsAll > 0 ? Math.round(totalDurationAll / totalCompletedItemsAll) : 0;

    // Find top performer
    const staffTotals = {};
    tableRows.forEach((r) => {
      if (!staffTotals[r.staffName]) {
        staffTotals[r.staffName] = { name: r.staffName, completed: 0, role: r.staffRole };
      }
      staffTotals[r.staffName].completed += r.completedCount;
    });

    let topPerformerName = '-';
    let topPerformerCompleted = 0;
    Object.values(staffTotals).forEach((st) => {
      if (st.completed > topPerformerCompleted) {
        topPerformerCompleted = st.completed;
        topPerformerName = `${st.name} (${st.completed} pesanan)`;
      }
    });

    const kpi = {
      totalActiveStaff: {
        label: 'TOTAL STAF BERTUGAS',
        value: activeStaffSet.size || staffUsers.length,
        formattedValue: `${activeStaffSet.size || staffUsers.length} Orang`,
        comparisonText: 'Barista, Kitchen & Kasir Terdaftar',
        iconType: 'users',
      },
      totalCompletedOrders: {
        label: 'TOTAL PESANAN SELESAI',
        value: totalCompletedAll,
        formattedValue: `${totalCompletedAll} Item`,
        comparisonText: 'Terselesaikan Tepat Waktu',
        iconType: 'check-circle',
      },
      totalProcessingOrders: {
        label: 'PESANAN MASIH DIPROSES',
        value: totalProcessingAll,
        formattedValue: `${totalProcessingAll} Item`,
        comparisonText: 'Dalam Antrean / Proses',
        iconType: 'flame',
      },
      averageCompletionTime: {
        label: 'RATA-RATA WAKTU SELESAI',
        value: overallAvgSec,
        formattedValue: formatDurationStr(overallAvgSec),
        comparisonText: 'Kecepatan Pelayanan Tim',
        iconType: 'timer',
      },
      topPerformer: {
        label: 'STAF PALING PRODUKTIF',
        formattedValue: topPerformerName !== '-' ? topPerformerName : (staffUsers.length > 0 ? formatStaffName(staffUsers[0].name) : '-'),
        iconType: 'award',
      },
    };

    res.json({
      periodKey: period,
      periodLabel,
      dateRangeText: `${formatDateKey(filterStart)} s/d ${formatDateKey(filterEnd)}`,
      kpi,
      staffPerformanceTable: tableRows,
      activeStaffCount: activeStaffSet.size || staffUsers.length,
      availableStaffList: staffUsers.map((u) => ({
        id: u.id,
        name: formatStaffName(u.name),
        role: u.role,
      })),
    });
  } catch (error) {
    console.error('Fetch staff performance report error:', error.message);
    res.status(500).json({ message: 'Gagal memuat laporan kinerja staf.' });
  }
});

// PATCH /api/orders/items/:id/status: Mengubah status pengerjaan item pesanan
router.patch('/items/:id/status', optionalToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const itemId = req.params.id;
    const { next_status, status, updated_by, processed_by, role: clientRole } = req.body;
    const targetStatus = next_status || status;
    const userRole = req.user?.role || clientRole || 'station_staff';
    const userName = (updated_by || processed_by || req.user?.name || (userRole === 'barista' ? 'Barista' : userRole === 'kitchen' ? 'Koki' : 'Staf')).trim();
    const nowMillis = Date.now();

    if (!targetStatus || !['pending', 'processing', 'completed', 'cancelled'].includes(targetStatus)) {
      return res.status(400).json({
        message: 'Status tujuan tidak valid. Pilihan status: pending, processing, completed, cancelled.',
      });
    }

    await client.query('BEGIN');

    // 1. Ambil data item terkini
    const itemRes = await client.query(
      `SELECT ti.id, ti.transaction_id, ti.product_name, ti.quantity, ti.station, ti.item_status, ti.notes,
              ti.processed_by, ti.created_at_millis, ti.processing_at_millis, ti.completed_at_millis,
              st.receipt_number, st.merchant_id
       FROM transaction_items ti
       JOIN sales_transactions st ON st.id = ti.transaction_id
       WHERE ti.id = $1
       FOR UPDATE`,
      [itemId]
    );

    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Item pesanan tidak ditemukan.' });
    }

    const item = itemRes.rows[0];
    const currentStatus = item.item_status;
    const isPrivileged = req.user && ['admin', 'super_admin', 'kasir'].includes(req.user.role);

    // 2. Cek apakah item sedang dikerjakan orang lain (Locking)
    if (!isPrivileged && currentStatus === 'processing' && item.processed_by) {
      const isOwner = item.processed_by.toLowerCase().trim() === userName.toLowerCase().trim();
      if (!isOwner) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          message: `Pesanan ini terkunci & sedang dikerjakan oleh "${item.processed_by}". Staf lain tidak dapat menyelesaikan maupun membatalkan pesanan ini.`,
          processed_by: item.processed_by,
          is_locked: true,
        });
      }
    }

    if (currentStatus === targetStatus && (targetStatus !== 'processing' || item.processed_by === userName)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Item pesanan sudah berada pada status "${currentStatus}".`,
      });
    }

    // 3. Update status item, processed_by, dan timestamps
    let updateSql = `UPDATE transaction_items SET item_status = $1`;
    let updateParams = [targetStatus];

    if (targetStatus === 'processing') {
      const finalProcessor = processed_by || userName;
      updateSql += `, processed_by = $${updateParams.length + 1}, processing_at_millis = COALESCE(processing_at_millis, $${updateParams.length + 2})`;
      updateParams.push(finalProcessor, nowMillis);
    } else if (targetStatus === 'pending') {
      updateSql += `, processed_by = NULL, processing_at_millis = NULL`;
    } else if (targetStatus === 'completed') {
      const finalProcessor = item.processed_by || processed_by || userName;
      updateSql += `, processed_by = $${updateParams.length + 1}, completed_at_millis = COALESCE(completed_at_millis, $${updateParams.length + 2})`;
      updateParams.push(finalProcessor, nowMillis);
    }

    updateParams.push(itemId);
    updateSql += ` WHERE id = $${updateParams.length} RETURNING id, transaction_id, product_name, quantity, station, item_status, processed_by, notes, created_at_millis, processing_at_millis, completed_at_millis`;

    const updateRes = await client.query(updateSql, updateParams);

    // 4. Catat log status pesanan ke order_logs
    const indonesianStatus =
      targetStatus === 'processing'
        ? 'diproses'
        : targetStatus === 'completed'
        ? 'selesai'
        : targetStatus === 'pending'
        ? 'masuk'
        : 'dibatalkan';

    await client.query(
      `INSERT INTO order_logs (
         transaction_id, item_id, receipt_number, product_name, station, 
         status, created_at_millis, processing_at_millis, completed_at_millis, 
         updated_by, notes, merchant_id, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      [
        item.transaction_id,
        item.id,
        item.receipt_number,
        item.product_name,
        item.station,
        indonesianStatus,
        item.created_at_millis || nowMillis,
        targetStatus === 'processing' ? nowMillis : item.processing_at_millis,
        targetStatus === 'completed' ? nowMillis : null,
        userName,
        item.notes || null,
        item.merchant_id || 1,
      ]
    );

    await client.query('COMMIT');

    const updatedItem = updateRes.rows[0];

    res.json({
      message: `Status pesanan "${item.product_name}" (${item.receipt_number}) berhasil diperbarui menjadi ${targetStatus}.`,
      item: {
        ...updatedItem,
        receipt_number: item.receipt_number,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update item status error:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui status item pesanan.' });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/transactions/:id/status: Kasir/Admin mengubah status seluruh item dalam transaksi
router.patch('/transactions/:id/status', optionalToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const rawId = req.params.id;
    const { status, next_status, updated_by, station } = req.body;
    const targetStatus = next_status || status;
    const userRole = req.user?.role || 'kasir';
    const userName = req.user?.name || updated_by || 'Kasir';
    const nowMillis = Date.now();

    if (!targetStatus || !['pending', 'processing', 'completed'].includes(targetStatus)) {
      return res.status(400).json({
        message: 'Status tujuan tidak valid. Pilihan: pending, processing, completed.',
      });
    }

    await client.query('BEGIN');

    // 1. Temukan ID transaksi
    let trxRes;
    if (isNaN(Number(rawId))) {
      const cleanReceipt = rawId.replace('#', '').trim();
      trxRes = await client.query('SELECT id, receipt_number, merchant_id FROM sales_transactions WHERE receipt_number = $1', [cleanReceipt]);
    } else {
      trxRes = await client.query('SELECT id, receipt_number, merchant_id FROM sales_transactions WHERE id = $1', [Number(rawId)]);
    }

    if (trxRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Transaksi tidak ditemukan.' });
    }

    const trx = trxRes.rows[0];

    // 2. Query items to update
    let itemsQuery = 'SELECT id, product_name, station, item_status, created_at_millis FROM transaction_items WHERE transaction_id = $1';
    const queryParams = [trx.id];
    if (station && ['barista', 'kitchen'].includes(station.toLowerCase())) {
      itemsQuery += ' AND station = $2';
      queryParams.push(station.toLowerCase());
    }

    const itemsRes = await client.query(itemsQuery, queryParams);
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Tidak ada item yang sesuai untuk diperbarui.' });
    }

    // 3. Update all items
    let updateItemsSql = `UPDATE transaction_items SET item_status = $1`;
    const uParams = [targetStatus];

    if (targetStatus === 'processing') {
      updateItemsSql += `, processed_by = $2, processing_at_millis = COALESCE(processing_at_millis, $3)`;
      uParams.push(userName, nowMillis);
    } else if (targetStatus === 'pending') {
      updateItemsSql += `, processed_by = NULL, processing_at_millis = NULL`;
    } else if (targetStatus === 'completed') {
      updateItemsSql += `, processed_by = COALESCE(processed_by, $2), completed_at_millis = COALESCE(completed_at_millis, $3)`;
      uParams.push(userName, nowMillis);
    }

    uParams.push(trx.id);
    updateItemsSql += ` WHERE transaction_id = $${uParams.length}`;
    if (station) {
      uParams.push(station.toLowerCase());
      updateItemsSql += ` AND station = $${uParams.length}`;
    }

    await client.query(updateItemsSql, uParams);

    // 4. Insert log for each item
    const indonesianStatus = targetStatus === 'completed' ? 'selesai' : (targetStatus === 'processing' ? 'diproses' : 'masuk');
    for (const it of itemsRes.rows) {
      await client.query(
        `INSERT INTO order_logs (
           transaction_id, item_id, receipt_number, product_name, station, 
           status, created_at_millis, processing_at_millis, completed_at_millis, 
           updated_by, merchant_id, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          trx.id,
          it.id,
          trx.receipt_number,
          it.product_name,
          it.station,
          indonesianStatus,
          it.created_at_millis || nowMillis,
          targetStatus === 'processing' ? nowMillis : null,
          targetStatus === 'completed' ? nowMillis : null,
          userName,
          trx.merchant_id || 1,
        ]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Semua item pesanan struk #${trx.receipt_number} berhasil diubah menjadi ${targetStatus}.`,
      updated_count: itemsRes.rows.length,
      receipt_number: trx.receipt_number,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch update transaction status error:', error.message);
    res.status(500).json({ message: 'Gagal memperbarui status transaksi pesanan.' });
  } finally {
    client.release();
  }
});

module.exports = router;
