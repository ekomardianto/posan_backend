const bcrypt = require('bcryptjs');
const pool = require('./db');

async function seedRoles() {
  console.log('=== SEEDING 5 ROLE ACCOUNTS IN posan_db ===');
  try {
    const users = [
      { name: 'Super Admin POSAN', email: 'superadmin@posan.com', password: process.env.SEED_SUPER_ADMIN_PASSWORD, role: 'super_admin' },
      { name: 'Admin Cafe', email: 'admin@posan.com', password: process.env.SEED_ADMIN_PASSWORD, role: 'admin' },
      { name: 'Kasir Utama', email: 'kasir@posan.com', password: process.env.SEED_KASIR_PASSWORD, role: 'kasir' },
      { name: 'Barista POSAN', email: 'barista@posan.com', password: process.env.SEED_BARISTA_PASSWORD, role: 'barista' },
      { name: 'Kitchen Chef POSAN', email: 'kitchen@posan.com', password: process.env.SEED_KITCHEN_PASSWORD, role: 'kitchen' },
    ];

    const missingPassword = users.find((user) => !user.password);
    if (missingPassword) throw new Error(`Password untuk role ${missingPassword.role} belum diatur di .env`);

    for (const u of users) {
      const existing = await pool.query('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)', [u.email]);
      const hash = await bcrypt.hash(u.password, 10);

      if (existing.rows.length === 0) {
        const ins = await pool.query(
          `INSERT INTO users (name, email, password_hash, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id, name, email, role`,
          [u.name, u.email.toLowerCase(), hash, u.role]
        );
        console.log(`Created user [${u.role}]:`, ins.rows[0]);
      } else {
        const upd = await pool.query(
          `UPDATE users SET name = $1, password_hash = $2, role = $3, is_active = true WHERE id = $4
           RETURNING id, name, email, role`,
          [u.name, hash, u.role, existing.rows[0].id]
        );
        console.log(`Updated existing user [${u.role}]:`, upd.rows[0]);
      }
    }

    const allUsers = await pool.query('SELECT id, name, email, role, is_active FROM users ORDER BY id ASC');
    console.log('\nCurrent Users in DB:');
    console.table(allUsers.rows);
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await pool.end();
  }
}

seedRoles();
