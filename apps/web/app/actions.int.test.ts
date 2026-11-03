import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword } from '../lib/password.ts';
import { createToken, SESSION_COOKIE } from '../lib/session.ts';

// A bulk action end to end: the web's own server code (lib/server.ts) against the api as it runs, booted from
// apps/api/src/main.ts with its real rate limit (RATE_LIMIT_PER_MIN unset: 60 requests a minute per key) on a database
// of its own, migrated and seeded small as e2e/prepare.ts does. Only Next's request context is faked: the reviewer's
// session cookie and refresh(). ESM mocks come before the actions are imported; @types/jest does not declare them yet.
const jest = import.meta.jest as ImportMeta['jest'] & { unstable_mockModule(name: string, factory: () => object, options?: { virtual?: boolean }): void };
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiKey = 'w'.repeat(40);
const secret = 's'.repeat(40);
const cookie = { name: SESSION_COOKIE, value: createToken('reviewer', secret) };
// Next resolves server-only for its own bundles; plain Node cannot.
jest.unstable_mockModule('server-only', () => ({}), { virtual: true });
jest.unstable_mockModule('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === cookie.name ? cookie : undefined) }), headers: async () => new Headers() }));
jest.unstable_mockModule('next/cache', () => ({ refresh: () => {} }));
jest.unstable_mockModule('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));
const { reviewMany } = await import('./actions.ts');

const server = new URL(process.env.DATABASE_URL!);
const name = `freightaudit_test_${randomBytes(4).toString('hex')}`;
const databaseUrl = Object.assign(new URL(server), { pathname: `/${name}` }).href;
const db = new pg.Client({ connectionString: databaseUrl });
const realFetch = globalThis.fetch;
// The status of every answer the web's server gets from /graphql, in order.
const answers: number[] = [];
let api: ChildProcess;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: server.href });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  execFileSync(process.execPath, ['packages/pipeline/scripts/reset.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_PREFIX: prefix, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await db.connect();
  const tenantId: string = (await db.query('SELECT id FROM tenants')).rows[0].id;
  const env: NodeJS.ProcessEnv = { ...process.env, HOST: '127.0.0.1', API_PORT: '0', LOG_LEVEL: 'info', API_KEYS: apiKey, DATABASE_URL: databaseUrl, REDIS_PREFIX: prefix };
  delete env.RATE_LIMIT_PER_MIN;
  api = spawn(process.execPath, ['apps/api/src/main.ts'], { cwd: root, env: { ...env, S3_BUCKET: 'freightaudit-test', TENANT_ID: tenantId }, stdio: ['ignore', 'pipe', 'inherit'] });
  let baseUrl = '';
  for await (const line of createInterface({ input: api.stdout! })) {
    const { msg } = (line.startsWith('{') ? JSON.parse(line) : {}) as { msg?: string };
    if (msg?.startsWith('Server listening at ')) {
      baseUrl = msg.slice('Server listening at '.length);
      break;
    }
  }
  api.stdout!.resume();
  const settings = { API_URL: baseUrl, API_KEY: apiKey, SESSION_SECRET: secret, SESSION_IDLE_MINUTES: '30', SESSION_MAX_HOURS: '8', AI_ENABLED: 'true' };
  Object.assign(process.env, settings, { DEMO_PASSWORD_HASH: await hashPassword('unused here') });
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    if (String(input).endsWith('/graphql')) answers.push(response.status);
    return response;
  };
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill();
    await once(api, 'exit');
  }
  await db.end();
  const admin = new pg.Client({ connectionString: server.href });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

test("a 100-row bulk action under the api's real rate limit waits out the minute once, and records every row as its own decision", async () => {
  // 100 open charges on reconciled invoices, four to an invoice, as a page of 100 lists them; the small seed has fewer.
  const { rows } = await db.query(
    `INSERT INTO discrepancies (tenant_id, invoice_id, type, expected_cents, billed_cents, evidence)
     SELECT i.tenant_id, i.id, 'uncontracted_charge', 0, 2500, 'LIFTGATE is not on the rate card.'
     FROM (SELECT * FROM invoices WHERE status = 'reconciled' ORDER BY id LIMIT 25) i, generate_series(1, 4)
     RETURNING id`,
  );
  const ids = rows.map((row) => row.id as string);
  expect(ids).toHaveLength(100);
  const form = new FormData();
  form.set('action', 'approve');
  for (const id of ids) form.append('finding', id);

  expect(await reviewMany({}, form)).toEqual({ done: '100 charges approved.' });
  // 60 in the first minute; the api refused the 61st with its Retry-After, and the rest went once that minute was over.
  expect(answers.slice(0, 61)).toEqual([...Array.from({ length: 60 }, () => 200), 429]);
  expect(answers.filter((status) => status === 200)).toHaveLength(100);
  const decided = await db.query(
    `SELECT d.status, count(a.id)::int AS events FROM discrepancies d
     LEFT JOIN audit_events a ON a.discrepancy_id = d.id AND a.action = 'discrepancy_dismissed' AND a.actor = 'reviewer'
     WHERE d.id = ANY($1) GROUP BY d.status`,
    [ids],
  );
  expect(decided.rows).toEqual([{ status: 'dismissed', events: 100 }]);
}, 150_000);
