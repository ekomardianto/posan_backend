const pool = require('../db');

async function setup() {
  console.log('Setting up attendances table...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendances (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL,
      user_name VARCHAR(100) NOT NULL,
      role VARCHAR(50) NOT NULL,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      check_in_time TIMESTAMP WITH TIME ZONE,
      check_out_time TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) NOT NULL DEFAULT 'working',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_attendances_merchant ON attendances(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(date);
    CREATE INDEX IF NOT EXISTS idx_attendances_user ON attendances(user_id);
  `);

  console.log('Table attendances created or verified.');

  // Check existing attendance count
  const countRes = await pool.query('SELECT COUNT(*) FROM attendances');
  if (parseInt(countRes.rows[0].count, 10) === 0) {
    console.log('Seeding initial attendance data for staff...');

    // Fetch staff users
    const usersRes = await pool.query(
      `SELECT id, name, role, merchant_id FROM users WHERE role IN ('kasir', 'barista', 'kitchen') ORDER BY id ASC`
    );

    const staffUsers = usersRes.rows;
    if (staffUsers.length > 0) {
      const now = new Date();
      
      // Generate attendance for the last 14 days
      for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() - dayOffset);
        const dateStr = targetDate.toISOString().split('T')[0];

        for (const staff of staffUsers) {
          // 85% chance of attendance on past days
          const isPresent = dayOffset === 0 ? true : (Math.random() > 0.15);
          if (!isPresent) continue;

          // Check in time: around 07:45 - 08:20
          const checkInHour = 7 + Math.floor(Math.random() * 2); // 7 or 8
          const checkInMinute = Math.floor(Math.random() * 59);
          const checkIn = new Date(targetDate);
          checkIn.setHours(checkInHour, checkInMinute, 0, 0);

          let checkOut = null;
          let status = 'completed';
          let notes = `Shift Reguler ${staff.role.toUpperCase()}`;

          if (dayOffset === 0) {
            // Today: some still working, some completed
            const isStillWorking = Math.random() > 0.4;
            if (isStillWorking) {
              status = 'working';
              notes = 'Aktif bertugas di stasiun';
            } else {
              checkOut = new Date(targetDate);
              checkOut.setHours(checkInHour + 8, checkInMinute + 15, 0, 0);
              status = 'completed';
              notes = 'Shift selesai hari ini';
            }
          } else {
            // Past day: 8 hours + 15-45 minutes
            checkOut = new Date(targetDate);
            checkOut.setHours(checkInHour + 8, checkInMinute + Math.floor(Math.random() * 45), 0, 0);
            
            // Check if late (after 08:10)
            if (checkInHour === 8 && checkInMinute > 10) {
              notes += ' (Terlambat 15 menit)';
            }
          }

          await pool.query(
            `INSERT INTO attendances (user_id, user_name, role, merchant_id, date, check_in_time, check_out_time, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              staff.id,
              staff.name,
              staff.role,
              staff.merchant_id,
              dateStr,
              checkIn,
              checkOut,
              status,
              notes
            ]
          );
        }
      }
      console.log('Seeded attendance records successfully!');
    }
  } else {
    console.log(`Found ${countRes.rows[0].count} existing attendance records.`);
  }
}

setup()
  .then(() => {
    console.log('Setup finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
