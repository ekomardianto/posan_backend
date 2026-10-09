const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'posan_jwt_super_secret_key_2026_cafe_engine';

/**
 * Middleware untuk memverifikasi JWT token
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Akses ditolak. Token otentikasi tidak ditemukan.',
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        message: 'Token otentikasi tidak valid atau telah kedaluwarsa.',
      });
    }

    // Verifikasi keberadaan dan status aktif user di database PostgreSQL
    const userRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.merchant_id, u.is_active, u.phone, u.shift, u.auth_pin, u.created_at,
              m.name AS merchant_name, m.slug AS merchant_slug, m.category AS merchant_category, m.address AS merchant_address, m.phone AS merchant_phone
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       WHERE u.id = $1`,
      [decoded.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        message: 'Sesi pengguna tidak valid. Akun tidak ditemukan di database.',
      });
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      return res.status(403).json({
        message: 'Akun Anda telah dinonaktifkan. Hubungi Administrator.',
      });
    }

    req.user = user;
    req.merchantId = getTenantMerchantId(req);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({
      message: 'Terjadi kesalahan saat memverifikasi otentikasi.',
    });
  }
}

/**
 * Helper untuk menentukan merchant_id (Multi-Tenancy)
 */
function getTenantMerchantId(req) {
  if (req.user && req.user.role === 'super_admin') {
    const headerId = req.headers['x-merchant-id'];
    const queryId = req.query?.merchant_id || req.query?.merchantId;
    if (headerId && !isNaN(parseInt(headerId, 10))) return parseInt(headerId, 10);
    if (queryId && !isNaN(parseInt(queryId, 10))) return parseInt(queryId, 10);
    return null; // Global (seluruh cafe / outlet) untuk Super Admin
  }
  if (req.user && req.user.merchant_id) {
    return parseInt(req.user.merchant_id, 10);
  }
  const queryId = req.query?.merchant_id || req.query?.merchantId;
  if (queryId && !isNaN(parseInt(queryId, 10))) return parseInt(queryId, 10);
  return null;
}

/**
 * Middleware untuk membatasi akses berdasarkan role yang terdaftar di database
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Otentikasi diperlukan.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Akses ditolak. Role "${req.user.role}" tidak memiliki izin untuk fitur ini.`,
      });
    }

    next();
  };
}

/**
 * Middleware untuk otentikasi opsional (jika ada token di-decode, jika tidak req.user = null)
 */
async function optionalToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRes = await pool.query(
          'SELECT id, name, email, role, merchant_id, is_active FROM users WHERE id = $1',
          [decoded.id]
        );
        if (userRes.rows.length > 0 && userRes.rows[0].is_active) {
          req.user = userRes.rows[0];
          req.merchantId = getTenantMerchantId(req);
        }
      } catch (_) {}
    }
    next();
  } catch (error) {
    next();
  }
}

module.exports = {
  JWT_SECRET,
  verifyToken,
  optionalToken,
  requireRole,
  getTenantMerchantId,
};

