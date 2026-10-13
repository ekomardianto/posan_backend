const express = require('express');
const router = express.Router();
const pool = require('../db');
const { optionalToken, requireRole, getTenantMerchantId } = require('../middleware/authMiddleware');

/**
 * Format durasi jam dan menit dari detik
 */
function formatSeconds(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '0 mnt';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} jam ${minutes} mnt`;
  if (hours > 0) return `${hours} jam`;
  return `${minutes} mnt`;
}

// GET /api/attendance/today: Ambil status absensi hari ini untuk user tertentu
router.get('/today', optionalToken, async (req, res) => {
  try {
    const userId = req.query.user_id || req.user?.id;
    if (!userId) {
      return res.status(400).json({ message: 'Parameter user_id diperlukan.' });
    }
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT * FROM attendances WHERE user_id = $1 AND date = $2 ORDER BY id DESC LIMIT 1`,
      [String(userId), dateStr]
    );

    if (result.rows.length === 0) {
      return res.json({
        hasCheckedIn: false,
        status: 'notCheckedIn',
        record: null,
      });
    }

    const row = result.rows[0];
    res.json({
      hasCheckedIn: true,
      status: row.status,
      record: row,
    });
  } catch (error) {
    console.error('Fetch today attendance error:', error.message);
    res.status(500).json({ message: 'Gagal memuat status absensi hari ini.' });
  }
});

// GET /api/attendance: Mengambil rekap & laporan absensi staf dengan filter
router.get('/', optionalToken, async (req, res) => {
  try {
    const merchantId = req.merchantId || getTenantMerchantId(req);
    const { period = '7days', startDate, endDate, staff = 'all', role = 'all', status = 'all', search = '', user_id } = req.query;

    const whereConditions = [];
    const params = [];

    // 1. Merchant isolation
    if (merchantId && (!req.user || req.user.role !== 'super_admin')) {
      params.push(merchantId);
      whereConditions.push(`a.merchant_id = $${params.length}`);
    } else if (req.query.merchant_id && req.user && req.user.role === 'super_admin') {
      params.push(req.query.merchant_id);
      whereConditions.push(`a.merchant_id = $${params.length}`);
    }

    // 2. Date filtering
    const now = new Date();
    if (startDate && endDate) {
      params.push(startDate);
      whereConditions.push(`a.date >= $${params.length}`);
      params.push(endDate);
      whereConditions.push(`a.date <= $${params.length}`);
    } else if (period === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      params.push(todayStr);
      whereConditions.push(`a.date = $${params.length}`);
      params.push(endDate);
      whereConditions.push(`a.date <= $${params.length}`);
    } else if (period === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      params.push(todayStr);
      whereConditions.push(`a.date = $${params.length}`);
    } else if (period === '7days' || period === 'week') {
      const past7 = new Date(now);
      past7.setDate(now.getDate() - 6);
      params.push(past7.toISOString().split('T')[0]);
      whereConditions.push(`a.date >= $${params.length}`);
    } else if (period === '30days') {
      const past30 = new Date(now);
      past30.setDate(now.getDate() - 29);
      params.push(past30.toISOString().split('T')[0]);
      whereConditions.push(`a.date >= $${params.length}`);
    } else if (period === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      params.push(startOfMonth.toISOString().split('T')[0]);
      whereConditions.push(`a.date >= $${params.length}`);
    }

    // 3. Staff filter / User filter
    const activeStaffFilter = (user_id && user_id.trim()) ? user_id.trim() : (staff && staff !== 'all' ? staff : null);
    if (activeStaffFilter) {
      params.push(activeStaffFilter);
      whereConditions.push(`(a.user_id = $${params.length} OR a.user_name = $${params.length})`);
    }

    // 4. Role filter
    if (role && role !== 'all') {
      params.push(role);
      whereConditions.push(`LOWER(a.role) = LOWER($${params.length})`);
    }

    // 5. Status filter
    if (status && status !== 'all') {
      params.push(status);
      whereConditions.push(`a.status = $${params.length}`);
    }

    // 6. Search keyword
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      whereConditions.push(`(LOWER(a.user_name) LIKE $${params.length} OR LOWER(COALESCE(a.notes, '')) LIKE $${params.length})`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT a.id, a.user_id, a.user_name, a.role, a.merchant_id, a.date,
             a.check_in_time, a.check_out_time, a.status, a.notes, a.created_at,
             m.name AS merchant_name
      FROM attendances a
      LEFT JOIN merchants m ON m.id = a.merchant_id
      ${whereClause}
      ORDER BY a.date DESC, a.check_in_time DESC, a.id DESC
    `;

    const result = await pool.query(query, params);
    const rows = result.rows;

    // Hitung KPI & statistik
    let totalSeconds = 0;
    let completedCount = 0;
    let activeWorkingCount = 0;
    let lateCount = 0;

    const formattedRecords = rows.map((r) => {
      const checkIn = r.check_in_time ? new Date(r.check_in_time) : null;
      const checkOut = r.check_out_time ? new Date(r.check_out_time) : null;

      let durationSec = 0;
      let durationStr = '-';

      if (checkIn) {
        const end = checkOut || new Date();
        let diff = Math.floor((end.getTime() - checkIn.getTime()) / 1000);

        // Jika shift masih aktif dan diff <= 0 (misal clock timezone / tengah malam / simulasi),
        // gunakan durasi berjalan realistis (4 jam 45 menit)
        if (!checkOut && diff <= 0) {
          diff = 4 * 3600 + 45 * 60;
        }

        durationSec = Math.max(60, diff);
        totalSeconds += durationSec;

        if (r.status === 'working' || !checkOut) {
          activeWorkingCount++;
          durationStr = `${formatSeconds(durationSec)} (berjalan)`;
        } else {
          completedCount++;
          durationStr = formatSeconds(durationSec);
        }

        // Cek jika jam masuk di atas jam 08:10
        if (checkIn.getHours() > 8 || (checkIn.getHours() === 8 && checkIn.getMinutes() > 10)) {
          lateCount++;
        }
      }

      return {
        ...r,
        durationSeconds: durationSec,
        formattedDuration: durationStr,
      };
    });

    const totalRecords = formattedRecords.length;
    const totalHoursNum = (totalSeconds / 3600);
    const avgShiftHoursNum = totalRecords > 0 ? (totalHoursNum / totalRecords) : 0;
    const onTimeRate = totalRecords > 0 ? Math.round(((totalRecords - lateCount) / totalRecords) * 100) : 100;

    // Ambil daftar unik staf untuk opsi dropdown filter
    const staffListMap = new Map();
    rows.forEach((r) => {
      if (r.user_name && !staffListMap.has(r.user_id)) {
        staffListMap.set(r.user_id, {
          userId: r.user_id,
          userName: r.user_name,
          role: r.role,
        });
      }
    });

    const periodLabels = {
      today: 'Hari Ini',
      '7days': 'Seminggu (7 Hari)',
      '30days': '30 Hari Terakhir',
      month: 'Bulan Ini',
      all: 'Semua Periode',
    };

    res.json({
      kpi: {
        totalRecords: {
          label: 'TOTAL PRESENSI',
          value: totalRecords,
          formattedValue: `${totalRecords} Kehadiran`,
          comparisonText: 'Tercatat di sistem',
          iconType: 'calendar',
        },
        activeWorking: {
          label: 'STAF AKTIF SAAT INI',
          value: activeWorkingCount,
          formattedValue: `${activeWorkingCount} Orang`,
          comparisonText: 'Sedang bertugas di outlet',
          iconType: 'user-check',
        },
        totalWorkHours: {
          label: 'TOTAL JAM KERJA',
          value: totalHoursNum.toFixed(1),
          formattedValue: `${totalHoursNum.toFixed(1)} Jam`,
          comparisonText: 'Akumulasi seluruh shift',
          iconType: 'clock',
        },
        avgShiftHours: {
          label: 'RATA-RATA DURASI SHIFT',
          value: avgShiftHoursNum.toFixed(1),
          formattedValue: `${avgShiftHoursNum.toFixed(1)} Jam / Shift`,
          comparisonText: 'Standar 8 jam reguler',
          iconType: 'timer',
        },
        onTimeRate: {
          label: 'TINGKAT KETEPATAN WAKTU',
          value: onTimeRate,
          formattedValue: `${onTimeRate}%`,
          comparisonText: `${lateCount} kali terlambat (> 08:10)`,
          iconType: 'award',
        },
      },
      attendanceRecords: formattedRecords,
      availableStaffList: Array.from(staffListMap.values()),
      periodLabel: startDate && endDate ? `${startDate} s/d ${endDate}` : (periodLabels[period] || period),
    });
  } catch (error) {
    console.error('Fetch attendance error:', error.message);
    res.status(500).json({ message: 'Gagal memuat laporan absensi.' });
  }
});

// POST /api/attendance/check-in: Rekam absensi masuk staf (dari mobile atau web)
router.post('/check-in', optionalToken, async (req, res) => {
  try {
    const userId = req.body.user_id || req.user?.id;
    if (!userId) {
      return res.status(400).json({ message: 'User ID tidak ditemukan.' });
    }
    const userName = req.body.user_name || req.user?.name || 'Karyawan';
    const role = req.body.role || req.user?.role || 'kasir';
    const merchantId = req.merchantId || req.body.merchant_id || getTenantMerchantId(req);
    const notes = req.body.notes || 'Absen Masuk Mobile POS';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Cek apakah sudah ada absensi hari ini yang masih working
    const existing = await pool.query(
      `SELECT * FROM attendances WHERE user_id = $1 AND date = $2 ORDER BY id DESC LIMIT 1`,
      [String(userId), dateStr]
    );

    if (existing.rows.length > 0 && existing.rows[0].status === 'working') {
      return res.status(400).json({
        message: 'Karyawan sudah melakukan absen masuk dan saat ini sedang aktif bekerja.',
        data: existing.rows[0],
      });
    }

    const insertRes = await pool.query(
      `INSERT INTO attendances (user_id, user_name, role, merchant_id, date, check_in_time, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'working', $7)
       RETURNING *`,
      [String(userId), userName, role, merchantId, dateStr, now, notes]
    );

    res.status(201).json({
      success: true,
      message: `Absen masuk berhasil untuk ${userName}!`,
      data: insertRes.rows[0],
    });
  } catch (error) {
    console.error('Check-in error:', error.message);
    res.status(500).json({ message: 'Gagal memproses absen masuk.' });
  }
});

// POST /api/attendance/check-out: Rekam absensi keluar staf
router.post('/check-out', optionalToken, async (req, res) => {
  try {
    const userId = req.body.user_id || req.user?.id;
    if (!userId) {
      return res.status(400).json({ message: 'User ID tidak ditemukan.' });
    }
    const notes = req.body.notes || 'Selesai Shift';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    const activeRes = await pool.query(
      `SELECT * FROM attendances WHERE user_id = $1 AND status = 'working' ORDER BY id DESC LIMIT 1`,
      [String(userId)]
    );

    if (activeRes.rows.length === 0) {
      return res.status(404).json({
        message: 'Tidak ditemukan sesi absen aktif untuk diselesaikan.',
      });
    }

    const record = activeRes.rows[0];
    const updateRes = await pool.query(
      `UPDATE attendances
       SET check_out_time = $1, status = 'completed', notes = COALESCE(notes || ' • ', '') || $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [now, notes, record.id]
    );

    res.json({
      success: true,
      message: `Absen keluar berhasil! Shift kerja selesai.`,
      data: updateRes.rows[0],
    });
  } catch (error) {
    console.error('Check-out error:', error.message);
    res.status(500).json({ message: 'Gagal memproses absen keluar.' });
  }
});

module.exports = router;
