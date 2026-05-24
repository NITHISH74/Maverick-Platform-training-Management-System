#!/usr/bin/env node
// Apply a SQL migration to Supabase using direct Postgres connection.
// Usage: node scripts/run-migration.mjs <migration-file>

import fs from 'node:fs';
import path from 'node:path';
import pg from '../artifacts/api/node_modules/pg/lib/index.js';

const { Client } = pg;

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-migration.mjs <sql-file>');
  process.exit(1);
}

const conn = process.env.DB_URL;
if (!conn) {
  console.error('DB_URL env var required');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(file), 'utf8');
const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`Connected. Applying ${file} (${sql.length} bytes)…`);
  await client.query(sql);
  console.log('✓ Migration applied successfully');
} catch (err) {
  console.error('✗ Migration failed:', err.message);
  if (err.position) console.error(`  near char ${err.position}`);
  process.exit(1);
} finally {
  await client.end();
}
