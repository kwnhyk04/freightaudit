import { waitFor } from '@freightaudit/db/testing';
import { sql } from 'drizzle-orm';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { apiKey, createTestEnv, formData, pdf } from './testing.ts';

// Boots src/main.ts in a plain Node process, outside the Jest realm, against the test run's Postgres, Redis and MinIO.
const main = fileURLToPath(new URL('main.ts', import.meta.url));
// The server's connections carry this name, so a test can terminate exactly those.
const APPLICATION_NAME = 'freightaudit-api-under-test';
let env: Awaited<ReturnType<typeof createTestEnv>>;
let server: ChildProcess;
let baseUrl = '';
// Every JSON line the server logs.
const logs: Record<string, unknown>[] = [];

beforeAll(async () => {
  env = await createTestEnv();
  const databaseUrl = new URL(env.databaseUrl);
  databaseUrl.searchParams.set('application_name', APPLICATION_NAME);
  server = spawn(process.execPath, [main], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      API_PORT: '0',
      LOG_LEVEL: 'info',
      API_KEYS: apiKey,
      DATABASE_URL: databaseUrl.href,
      REDIS_PREFIX: env.prefix,
      S3_BUCKET: 'freightaudit-test',
      TENANT_ID: env.tenantId,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stdout = server.stdout;
  if (!stdout) throw new Error('server stdout is not piped');
  createInterface({ input: stdout }).on('line', (line) => line.startsWith('{') && logs.push(JSON.parse(line)));
  const listening = await waitFor(() => logs.find(({ msg }) => String(msg).startsWith('Server listening at ')), 25_000);
  baseUrl = String(listening.msg).slice('Server listening at '.length);
}, 30_000);

afterAll(async () => {
  const exited = server.exitCode !== null || server.signalCode !== null;
  server.kill();
  // Its pool goes with the process, before the database is dropped.
  if (!exited) await once(server, 'exit');
  await env.close();
});

test('exits with a clear error that lists every missing or invalid setting without echoing values', async () => {
  const child = spawn(process.execPath, [main], {
    env: { ...process.env, DATABASE_URL: undefined, API_KEYS: 'too-short-secret' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = await once(child, 'close');
  expect(code).toBe(1);
  expect(stderr).toContain('Invalid environment configuration');
  expect(stderr).toContain('at DATABASE_URL');
  expect(stderr).toContain('at API_KEYS');
  expect(stderr).not.toContain('too-short-secret');
});

test('GET /readyz answers 200 when Postgres, Redis and MinIO are reachable', async () => {
  const response = await fetch(`${baseUrl}/readyz`);
  expect(await response.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok', minio: 'ok' } });
});

test('POST /v1/invoices without Idempotency-Key returns a 400 Problem; with it the PDF is stored and queued', async () => {
  const file = await pdf();
  const missing = await fetch(`${baseUrl}/v1/invoices`, { method: 'POST', headers: { 'X-API-Key': apiKey }, body: formData('file', [file]) });
  expect(missing.status).toBe(400);
  expect(missing.headers.get('content-type')).toContain('application/problem+json');
  expect(await missing.json()).toEqual({ type: 'about:blank', title: 'Bad Request', status: 400, detail: expect.any(String) });

  // Control: with the header the upload passes, so header names match case-insensitively outside Jest.
  const accepted = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Idempotency-Key': 'real-server' },
    body: formData('file', [file]),
  });
  expect(accepted.status).toBe(202);
  const { id } = (await accepted.json()) as { id: string };
  expect((await env.queues.queue('extract').getJobs(['waiting']))[0]?.data).toEqual({ tenantId: env.tenantId, invoiceId: id });
});

test('keeps running when the server terminates its idle database connections, and logs only the error code', async () => {
  const list = () => fetch(`${baseUrl}/v1/invoices`, { headers: { 'X-API-Key': apiKey } });
  // A request leaves the pool an idle connection.
  expect((await list()).status).toBe(200);
  const { rows } = await env.db.execute(sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${APPLICATION_NAME}`);
  expect(rows.length).toBeGreaterThan(0);

  const lost = await waitFor(() => logs.find(({ msg }) => msg === 'idle database connection lost'));
  expect(lost).toMatchObject({ level: 40, code: '57P01' });
  // The code only: never the server's message, and no error object that could carry a query's values.
  expect(JSON.stringify(lost)).not.toMatch(/administrator command|"err"/);
  expect(server.exitCode).toBeNull();
  // The next query opens a new connection.
  expect((await list()).status).toBe(200);
});
