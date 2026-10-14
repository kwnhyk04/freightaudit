import pg from 'pg';
import { logJson, type Log } from '../src/log.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from './seed.ts';

export { logJson, type Log };

// The database half of pnpm db:reset (packages/pipeline/scripts/reset.ts also empties the queues): drops every table,
// type and function of the app, migrates from empty and seeds --scale=small.
export const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// Throws unless the database pg connects to is on this machine and NODE_ENV is not production.
export function assertDevDatabase(url: string, nodeEnv?: string) {
  // The host pg will connect to: a host parameter in the URL overrides the one before the path.
  const { host } = new pg.Client({ connectionString: url });
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`db:reset runs only against localhost or 127.0.0.1, not ${host}`);
  if (nodeEnv?.trim().toLowerCase() === 'production') throw new Error('db:reset does not run with NODE_ENV=production');
}

export async function resetDatabase(url: string, { nodeEnv, log = logJson }: { nodeEnv?: string; log?: Log } = {}) {
  assertDevDatabase(url, nodeEnv);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Fail fast instead of queueing behind a running api or worker.
    await client.query("SET lock_timeout = '5s'");
    await client.query('BEGIN');
    await client.query('DROP SCHEMA public CASCADE');
    // As in a new database: owned by the database owner, usable by every role.
    await client.query('CREATE SCHEMA public AUTHORIZATION pg_database_owner');
    await client.query('GRANT USAGE ON SCHEMA public TO PUBLIC');
    await client.query('COMMIT');
    log('app data dropped');
    await migrate(url, { log });
    await seed(client, 'small', { log });
  } catch (err) {
    if ((err as { code?: string }).code === '55P03') throw new Error('db:reset timed out waiting for a lock: stop the api and worker first', { cause: err });
    throw err;
  } finally {
    await client.end();
  }
}
