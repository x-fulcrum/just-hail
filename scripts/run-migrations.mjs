// Run all sql/*.sql files against Postgres in filename order, idempotently.
// Usage:
//   DATABASE_URL=postgresql://... node scripts/run-migrations.mjs
// Or pass the URL as a CLI arg:
//   node scripts/run-migrations.mjs 'postgresql://...'
//
// Each .sql file is executed as a single statement batch. CREATE TABLE
// IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING patterns are used in
// migrations so re-running is safe.

import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, '..', 'sql');

const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL. Pass as $DATABASE_URL env or first CLI arg.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, ssl: 'require' });

try {
  const files = readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const full = join(SQL_DIR, f);
    const body = readFileSync(full, 'utf8');
    process.stdout.write(`· ${f} `);
    try {
      await sql.unsafe(body);
      console.log('✓');
    } catch (err) {
      // Some migrations reference tables/extensions that don't exist in this
      // project yet; skip non-destructive "already exists" / "does not exist"
      // errors but loudly flag anything else.
      const msg = err.message || String(err);
      if (/already exists/i.test(msg)) {
        console.log('✓ (already applied)');
      } else {
        console.log('✗');
        console.error('  ', msg);
      }
    }
  }

  // Quick sanity: confirm the singleton row is present on ihm_session
  const [row] = await sql`SELECT id, updated_at FROM ihm_session WHERE id = 1`;
  console.log('\nihm_session singleton:', row ? `id=${row.id}, updated=${row.updated_at}` : 'MISSING');
} finally {
  await sql.end();
}
