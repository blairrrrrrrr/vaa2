import fs from 'node:fs/promises';
import { Pool } from 'pg';

const file = process.argv[2];
const connectionString = process.env.DATABASE_URL;
if (!file) throw new Error('Usage: DATABASE_URL=... node scripts/import-appdeploy-export.mjs <export.json>');
if (!connectionString) throw new Error('DATABASE_URL is required.');

const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
if (parsed?.format !== 'vaa-appdeploy-export-v1' || !parsed.tables || typeof parsed.tables !== 'object') {
  throw new Error('Unsupported Vaa export format.');
}

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
let imported = 0;
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (table_name, id)
    )
  `);
  await client.query('BEGIN');
  for (const [table, records] of Object.entries(parsed.tables)) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(table) || table.includes('__')) {
      throw new Error('Invalid table name in export: ' + table);
    }
    if (!Array.isArray(records)) throw new Error('Invalid records list for ' + table);
    for (const row of records) {
      if (!row || typeof row.id !== 'string' || !row.id) throw new Error('Record is missing its original id in ' + table);
      const { id, ...data } = row;
      await client.query(
        'INSERT INTO app_records (table_name, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (table_name, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
        [table, id, JSON.stringify(data)],
      );
      imported += 1;
    }
  }
  await client.query('COMMIT');
  process.stdout.write('Imported ' + imported + ' records across ' + Object.keys(parsed.tables).length + ' tables.\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
