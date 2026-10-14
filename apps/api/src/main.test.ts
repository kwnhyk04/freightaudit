import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer, type Server } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Boots src/main.ts in a plain Node process: no Jest realm and no structuredClone shim.
const main = fileURLToPath(new URL('main.ts', import.meta.url));
const apiKey = 'k'.repeat(40);

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

// Stand-ins for dependencies: Redis accepts TCP, MinIO answers its health path, Postgres is a closed port.
const redis = createServer();
const minio = createHttpServer((req, res) => res.writeHead(req.url === '/minio/health/live' ? 200 : 404).end());
let env: NodeJS.ProcessEnv = {};
let server: ChildProcess;
let baseUrl = '';

beforeAll(async () => {
  const closed = createServer();
  const postgresPort = await listen(closed);
  closed.close();
  env = {
    ...process.env,
    HOST: '127.0.0.1',
    API_PORT: '0',
    LOG_LEVEL: 'info',
    API_KEYS: apiKey,
    DATABASE_URL: `postgres://freightaudit:freightaudit@127.0.0.1:${postgresPort}/freightaudit`,
    REDIS_URL: `redis://127.0.0.1:${await listen(redis)}`,
    S3_ENDPOINT: `http://127.0.0.1:${await listen(minio)}`,
  };
  server = spawn(process.execPath, [main], { env, stdio: ['ignore', 'pipe', 'inherit'] });
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
}, 20_000);

afterAll(() => {
  server.kill();
  redis.close();
  minio.close();
});

test('exits with a clear error that lists every missing or invalid setting without echoing values', async () => {
  const child = spawn(process.execPath, [main], {
    env: { ...env, DATABASE_URL: undefined, API_KEYS: 'too-short-secret' },
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

test('GET /readyz names the unreachable dependency and answers 503', async () => {
  const response = await fetch(`${baseUrl}/readyz`);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable', checks: { postgres: 'fail', redis: 'ok', minio: 'ok' } });
});

const invoiceForm = () => {
  const body = new FormData();
  body.append('file', new Blob(['%PDF-1.7 real server']), 'invoice.pdf');
  return body;
};

test('POST /v1/invoices without Idempotency-Key returns a 400 Problem Details response', async () => {
  const response = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: invoiceForm(),
  });
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(await response.json()).toEqual({
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: expect.any(String),
  });

  // Control: with the header the upload passes, so header names match case-insensitively outside Jest.
  const accepted = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Idempotency-Key': 'real-server' },
    body: invoiceForm(),
  });
  expect(accepted.status).toBe(202);
});
