import { backlog, createMemoryStorage } from '@freightaudit/pipeline';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv, formData, listen, pdf } from './testing.ts';

let env: Awaited<ReturnType<typeof createTestEnv>> | undefined;
let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  await env?.close();
  app = env = undefined;
});

async function start(deps: Partial<Parameters<typeof buildApp>[1]> = {}) {
  env ??= await createTestEnv();
  app = buildApp({}, { apiKeys: [apiKey], storage: createMemoryStorage(), service: env.service, ...deps });
  return { env, baseUrl: await listen(app) };
}

const upload = (baseUrl: string, file: Blob, key = apiKey) =>
  fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Idempotency-Key': crypto.randomUUID() },
    body: formData('file', [file]),
  });

test('the 11th upload in a minute gets 429 with Retry-After and RateLimit headers, counted per key in Redis', async () => {
  const otherKey = 'o'.repeat(40);
  env = await createTestEnv();
  const { baseUrl } = await start({ apiKeys: [apiKey, otherKey], redis: env.redis, prefix: env.prefix });

  for (let i = 0; i < 10; i++) expect((await upload(baseUrl, await pdf())).status).toBe(202);
  const limited = await upload(baseUrl, await pdf());
  expect(limited.status).toBe(429);
  expect(limited.headers.get('content-type')).toContain('application/problem+json');
  expect(limited.headers.get('ratelimit-limit')).toBe('10');
  expect(limited.headers.get('ratelimit-remaining')).toBe('0');
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(60);

  // Reads have their own budget of 60, and another key has its own uploads.
  const list = await fetch(`${baseUrl}/v1/invoices`, { headers: { 'X-API-Key': apiKey } });
  expect(list.status).toBe(200);
  expect(list.headers.get('ratelimit-limit')).toBe('60');
  expect((await upload(baseUrl, await pdf(), otherKey)).status).toBe(202);

  // The counters live in Redis under key digests; the keys themselves never get there.
  const counters = await env.redis.keys(`${env.prefix}:rate-limit:*`);
  expect(counters).toHaveLength(3);
  expect(counters.join()).not.toMatch(/kkkk|oooo/);
});

test('uploads get 503 with Retry-After while the extract backlog is above the high-water mark', async () => {
  env = await createTestEnv();
  const extract = env.queues.queue('extract');
  const { baseUrl } = await start({ backlog: { waiting: () => backlog(extract), highWater: 1 } });
  // No worker: one waiting job, and one parked in delayed as the budget guard does.
  await extract.add('extract', { tenantId: env.tenantId, invoiceId: crypto.randomUUID() }, { jobId: 'backlog-1' });
  await extract.add('extract', { tenantId: env.tenantId, invoiceId: crypto.randomUUID() }, { jobId: 'backlog-2', delay: 60_000 });

  const refused = await upload(baseUrl, await pdf());
  expect(refused.status).toBe(503);
  expect(refused.headers.get('retry-after')).toBe('30');
  expect(await refused.json()).toMatchObject({ status: 503, detail: 'the extraction backlog is full; retry later' });
  // Reads stay open.
  expect((await fetch(`${baseUrl}/v1/invoices`, { headers: { 'X-API-Key': apiKey } })).status).toBe(200);

  await extract.remove('backlog-1');
  expect((await upload(baseUrl, await pdf())).status).toBe(202);
});

test('input limits: over 10 MiB or 20 pages is 413, a file that is not a PDF is 415, and a batch rejects them one by one', async () => {
  const { baseUrl } = await start({ rateLimits: { general: 100, upload: 100 } });
  const huge = new Uint8Array(10 * 1024 * 1024 + 1);
  huge.set(new TextEncoder().encode('%PDF-1.7\n'));
  const cases: [Blob, number, string][] = [
    [new Blob([huge]), 413, 'file is larger than 10 MiB'],
    [await pdf('long', 21), 413, 'file has 21 pages; the limit is 20'],
    [new Blob(['GIF89a']), 415, 'file must be a PDF'],
    [new Blob(['%PDF-1.7 no objects']), 415, 'file is not a readable PDF'],
  ];
  for (const [file, status, detail] of cases) {
    const response = await upload(baseUrl, file);
    expect([response.status, (await response.json()).detail]).toEqual([status, detail]);
  }
  expect((await upload(baseUrl, await pdf('twenty pages', 20))).status).toBe(202);

  const batch = await fetch(`${baseUrl}/v1/invoice-batches`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: formData('files', [new Blob([huge]), await pdf(), new Blob(['GIF89a'])]),
  });
  const { results } = (await batch.json()) as { results: { status: string; error?: { status: number } }[] };
  expect(results.map((result) => [result.status, result.error?.status])).toEqual([
    ['rejected', 413],
    ['accepted', undefined],
    ['rejected', 415],
  ]);
  // A request must arrive in full within 30 s.
  expect(app!.server.requestTimeout).toBe(30_000);
});
