import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

/**
 * Run a SQL file (or SQL from stdin) against the linked Supabase database.
 *
 * Usage:
 *   . .\scripts\load-supabase-db-password.ps1
 *   node scripts/db-query.mjs supabase/tests/rls_isolation.sql
 *
 * The database password is read from SUPABASE_DB_PASSWORD and is never stored
 * in this repository.
 */

const projectRoot = path.resolve(import.meta.dirname, '..');

async function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) {
    return process.env.SUPABASE_PROJECT_REF.trim();
  }

  const projectRefPath = path.join(projectRoot, 'supabase', '.temp', 'project-ref');
  const projectRef = await readFile(projectRefPath, 'utf8');
  return projectRef.trim();
}

async function readSql() {
  const queryPath = process.argv[2];
  if (queryPath) {
    return readFile(path.resolve(projectRoot, queryPath), 'utf8');
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error(
    'SUPABASE_DB_PASSWORD is not set. Load it with: . .\\scripts\\load-supabase-db-password.ps1',
  );
  process.exit(1);
}

const projectRef = await resolveProjectRef();
const sql = await readSql();

const client = new Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password,
  database: 'postgres',
  // Supabase presents a CA chain that Node does not ship by default. This tool
  // is only used for local schema checks and RLS tests, never in the browser.
  ssl: { rejectUnauthorized: false },
  application_name: 'orderflow-ai-db-query',
});

try {
  await client.connect();
  const result = await client.query(sql);
  const resultSets = Array.isArray(result) ? result : [result];
  let printed = false;

  for (const resultSet of resultSets) {
    if (resultSet?.rows?.length) {
      console.log(JSON.stringify(resultSet.rows, null, 2));
      printed = true;
    } else if (resultSet?.command) {
      const rowCount =
        resultSet.rowCount == null ? '' : ` (${resultSet.rowCount} rows)`;
      console.log(`${resultSet.command}${rowCount}`);
      printed = true;
    }
  }

  if (!printed) {
    console.log('OK');
  }
} catch (error) {
  console.error(`SQL_ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
