// Prepares a Playwright run, before any server starts (Playwright starts its webServers before a globalSetup would run):
// this project's Postgres, Redis and MinIO up, the e2e database created, emptied, migrated and seeded small, its queues
// emptied, and the shipments the recorded fixtures bill. It refuses anything but the e2e database and prefix.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

const env: NodeJS.ProcessEnv = { ...process.env, ...parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8')), NODE_ENV: 'test' };
const database = new URL(env.DATABASE_URL!);
if (database.pathname !== '/freightaudit_e2e' || env.REDIS_PREFIX !== 'freightaudit-e2e') {
  throw new Error('e2e.env must name the freightaudit_e2e database and the freightaudit-e2e Redis prefix');
}
const root = new URL('../../../', import.meta.url);
execFileSync('docker', ['compose', '-f', 'infra/docker-compose.yml', 'up', '-d', '--wait', 'postgres', 'redis', 'minio'], { cwd: root, stdio: 'inherit' });

const admin = new pg.Client({ connectionString: Object.assign(new URL(database), { pathname: '/postgres' }).href });
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'freightaudit_e2e'");
if (!rowCount) await admin.query('CREATE DATABASE freightaudit_e2e');
await admin.end();

// Run directly with this environment, never through turbo, whose strict env mode would drop it and reset dev data.
execFileSync(process.execPath, ['packages/pipeline/scripts/reset.ts'], { cwd: root, env, stdio: 'inherit' });
const client = new pg.Client({ connectionString: database.href });
await client.connect();
await client.query(readFileSync(new URL('loadtest/fixture-shipments.sql', root), 'utf8'));
await client.end();
