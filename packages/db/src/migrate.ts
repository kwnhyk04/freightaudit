import { loadEnv } from '@freightaudit/config/env';
import { readdir, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { logJson, type Log } from './log.ts';

const dir = new URL('../migrations/', import.meta.url);
// First-line marker: run statement by statement, each committing on its own (CONCURRENTLY, NOT VALID then VALIDATE).
const NO_TRANSACTION = '-- migrate:no-transaction';

// Applies pending migrations/*.sql in name order. `to` stops after the files whose name starts with that prefix.
export async function migrate(url: string, { to, log = logJson }: { to?: string; log?: Log } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // One runner at a time; the session lock is released when the connection closes.
    await client.query("SELECT pg_advisory_lock(hashtext('freightaudit:migrate'))");
    // Fail fast instead of queueing behind a long transaction, which would block every later query on the table.
    await client.query("SET lock_timeout = '5s'");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
      const name = file.slice(0, -'.sql'.length);
      if (to !== undefined && name.slice(0, to.length) > to) break;
      if (applied.has(name)) continue;
      const sql = await readFile(new URL(file, dir), 'utf8');
      const started = Date.now();
      if (sql.startsWith(NO_TRANSACTION)) {
        // Statements must be safe to re-run: a failure leaves the earlier ones committed.
        for (const statement of sql.split('--> statement-breakpoint')) await client.query(statement);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      } else {
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      log('migration applied', { migration: name, ms: Date.now() - started });
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { to: { type: 'string' } } });
  const { DATABASE_URL } = loadEnv(['DATABASE_URL']);
  await migrate(DATABASE_URL, { to: values.to });
}
