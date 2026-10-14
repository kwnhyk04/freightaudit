import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Boots src/main.ts in a plain Node process: no Jest realm and no structuredClone shim.
let server: ChildProcess;
let baseUrl = '';

beforeAll(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('main.ts', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
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
}, 20_000);

afterAll(() => {
  server.kill();
});

const invoiceForm = () => {
  const body = new FormData();
  body.append('file', new Blob(['%PDF-1.7 real server']), 'invoice.pdf');
  return body;
};

test('POST /v1/invoices without Idempotency-Key returns a 400 Problem Details response', async () => {
  const response = await fetch(`${baseUrl}/v1/invoices`, { method: 'POST', body: invoiceForm() });
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
    headers: { 'Idempotency-Key': 'real-server' },
    body: invoiceForm(),
  });
  expect(accepted.status).toBe(202);
});
