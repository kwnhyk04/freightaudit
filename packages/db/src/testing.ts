import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './migrate.ts';

// A setting pnpm test:int takes from its containers. A missing one fails the test rather than reaching dev services.
export function testEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run integration tests with pnpm test:int`);
  return value;
}

// A throwaway database on the Postgres server in DATABASE_URL, migrated up to `to` (a migration name prefix; all by
// default), for integration tests in any package.
export async function createTestDatabase({ to }: { to?: string } = {}) {
  const server = testEnv('DATABASE_URL');
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
  await migrate(url.href, { to, log: () => {} });
  return { url: url.href, drop: () => admin(`DROP DATABASE ${name} WITH (FORCE)`) };
}
