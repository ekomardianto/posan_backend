const bcrypt = require('bcryptjs');
const pool = require('../db');

async function syncStaffPasswords() {
  try {
    const hash = await bcrypt.hash('123456', 10);
    const updateRes = await pool.query(
      `UPDATE users
       SET password_hash = $1, auth_pin = COALESCE(auth_pin, '123456')
       WHERE role IN ('kasir', 'barista', 'kitchen')
       RETURNING id, name, email, role, auth_pin`,
      [hash]
    );

    console.log('✅ Staff passwords & PIN successfully standardized to "123456":');
    console.table(updateRes.rows);

    const all = await pool.query('SELECT id, name, email, role, auth_pin FROM users ORDER BY id ASC');
    console.log('\nAll users in database:');
    console.table(all.rows);
  } catch (err) {
    console.error('Error syncing staff passwords:', err);
  } finally {
    await pool.end();
  }
}

syncStaffPasswords();
