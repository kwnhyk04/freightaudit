import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { apiKey, createTestEnv, formData, pdf } from './testing.ts';

// Boots src/main.ts in a plain Node process, outside the Jest realm, against the test run's Postgres, Redis and MinIO.
const main = fileURLToPath(new URL('main.ts', import.meta.url));
let env: Awaited<ReturnType<typeof createTestEnv>>;
let server: ChildProcess;
let baseUrl = '';

beforeAll(async () => {
  env = await createTestEnv();
  server = spawn(process.execPath, [main], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      API_PORT: '0',
      LOG_LEVEL: 'info',
      API_KEYS: apiKey,
      DATABASE_URL: env.databaseUrl,
      REDIS_PREFIX: env.prefix,
      S3_BUCKET: 'freightaudit-test',
      TENANT_ID: env.tenantId,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stdout = server.stdout;
  if (!stdout) throw new Error('server stdout is not piped');
  for await (const line of createInterface({ input: stdout })) {
    const { msg } = (line.startsWith('{') ? JSON.parse(line) : {}) as { msg?: string };
    if (msg?.startsWith('Server listening at ')) {
      baseUrl = msg.slice('Server listening at '.length);
      break;
    }
  }
  stdout.resume();
  if (!baseUrl) throw new Error('server did not start');
}, 30_000);

afterAll(async () => {
  server.kill();
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
