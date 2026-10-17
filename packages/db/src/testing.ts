import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { migrate } from './migrate.ts';

// A setting pnpm test:int takes from its containers. A missing one fails the test rather than reaching dev services.
export function testEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run integration tests with pnpm test:int`);
  return value;
}

// Polls until `check` returns something truthy.
export async function waitFor<T>(check: () => Promise<T> | T, timeoutMs = 20_000): Promise<Exclude<T, false | null | undefined | 0 | ''>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as Exclude<T, false | null | undefined | 0 | ''>;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await setTimeout(50);
  }
}

// A throwaway database on the Postgres server in DATABASE_URL, migrated up to `to` (a migration name prefix; all by
// default), for integration tests in any package. End every pool on it before drop().
export async function createTestDatabase({ to }: { to?: string } = {}) {
  const server = testEnv('DATABASE_URL');
  const name = `freightaudit_test_${randomBytes(4).toString('hex')}`;
  const admin = async <T>(work: (client: pg.Client) => Promise<T>) => {
    const client = new pg.Client({ connectionString: server });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };
  await admin((client) => client.query(`CREATE DATABASE ${name}`));
  const url = new URL(server);
  url.pathname = `/${name}`;
  await migrate(url.href, { to, log: () => {} });
  // pool.end() resolves before its connections have closed. DROP ... WITH (FORCE) then terminated the ones still open,
  // and their pool re-emitted the server's 57P01 as an error nothing handled, which crashed whichever test ran next. So
  // the drop waits for the last session to go, and a pool left open fails here, by name, instead: 5 s is ample for a
  // closing connection and shorter than pg's 10 s idle timeout, which would otherwise close a forgotten pool unseen.
  const drop = () =>
    admin(async (client) => {
      const open = async () => (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name])).rows[0]!.n;
      await waitFor(async () => (await open()) === 0, 5_000).catch(async () => {
        throw new Error(`${name} still has open connections (${await open()}): end every pool on it before dropping it`);
      });
      await client.query(`DROP DATABASE ${name}`);
    });
  return { url: url.href, drop };
}
