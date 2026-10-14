import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './migrate.ts';

// A migrated throwaway database on the Postgres server in DATABASE_URL, for integration tests in any package.
export async function createTestDatabase(server = process.env.DATABASE_URL) {
  if (!server) throw new Error('DATABASE_URL is not set: copy .env.example to .env and start Postgres');
  const name = `freightaudit_test_${randomBytes(4).toString('hex')}`;
  const admin = async (sql: string) => {
    const client = new pg.Client({ connectionString: server });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  await migrate(url.href, { log: () => {} });
  return { url: url.href, drop: () => admin(`DROP DATABASE ${name} WITH (FORCE)`) };
}
