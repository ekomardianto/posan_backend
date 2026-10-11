const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const migrationFiles = fs
  .readdirSync(__dirname)
  .filter((file) => /^\d{3}_.+\.js$/.test(file))
  .sort();

if (migrationFiles.length === 0) {
  console.log('No database migrations found.');
  process.exit(0);
}

for (const file of migrationFiles) {
  console.log(`\n=== Running migration ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('\nAll database migrations completed.');
