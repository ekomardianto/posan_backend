const bcrypt = require('bcryptjs');
const pool = require('../../db');

async function createAdmin() {
  try {
    const name = 'Admin POSAN 2';
    const email = 'admin2@posan.com';
    const password = process.env.NEW_ADMIN_PASSWORD;
    const role = 'admin';

    if (!password) throw new Error('NEW_ADMIN_PASSWORD wajib diatur di .env');

    const hash = await bcrypt.hash(password, 10);
    
    // Check if user already exists
    const check = await pool.query('SELECT id, name, email, role FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (check.rows.length > 0) {
      const updated = await pool.query(
        'UPDATE users SET name = $1, password_hash = $2, role = $3, is_active = true WHERE id = $4 RETURNING id, name, email, role, is_active',
        [name, hash, role, check.rows[0].id]
      );
      console.log('Admin user updated successfully:');
      console.table(updated.rows);
    } else {
      const inserted = await pool.query(
        'INSERT INTO users (name, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id, name, email, role, is_active',
        [name, email.toLowerCase(), hash, role]
      );
      console.log('Admin user created successfully:');
      console.table(inserted.rows);
    }
  } catch (err) {
    console.error('Error creating admin user:', err);
  } finally {
    await pool.end();
  }
}

createAdmin();
