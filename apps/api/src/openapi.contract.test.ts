import { createApiClient, openapiPath } from '@freightaudit/contracts';
import { deadLetters, discrepancies } from '@freightaudit/db';
import { createMemoryStorage } from '@freightaudit/pipeline';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv, formData, listen, pdf } from './testing.ts';

type Json = Record<string, unknown>;
type ResponseDoc = { headers?: Record<string, { required?: boolean }>; content?: Record<string, { schema: Json }> };
type Operation = { security?: unknown[]; responses: Record<string, ResponseDoc> };
type Spec = { security: unknown[]; paths: Record<string, Record<string, Operation>> };

const raw = parse(readFileSync(openapiPath, 'utf8')) as Json;

// Inlines local $refs so every response schema compiles on its own.
function deref(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deref);
  if (node === null || typeof node !== 'object') return node;
  const { $ref } = node as { $ref?: string };
  if ($ref) return deref($ref.slice(2).split('/').reduce<unknown>((at, key) => (at as Json)[key], raw));
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, deref(value)]));
}

const spec = deref(raw) as Spec;
const ajv = new Ajv2020({ strict: false });
addFormats.default(ajv);
const covered = new Set<string>();

// Checks status, required headers, content type and body against openapi.yaml.
function expectMatchesSpec(path: string, method: string, response: Response, body: unknown) {
  covered.add(`${method} ${path}`);
  const doc = spec.paths[path]?.[method]?.responses[response.status];
  if (!doc) throw new Error(`${method} ${path} returned undocumented status ${response.status}`);
  for (const [name, header] of Object.entries(doc.headers ?? {})) {
    if (header.required) expect(response.headers.get(name)).not.toBeNull();
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0] ?? '';
  const schema = doc.content?.[mediaType]?.schema;
  if (!schema) throw new Error(`${method} ${path} ${response.status} returned undocumented ${mediaType}`);
  const validate = ajv.compile(schema);
  expect(validate(body) ? [] : validate.errors).toEqual([]);
}

let redisUp = true;
const checks = {
  postgres: async () => {},
  redis: async () => {
    if (!redisUp) throw new Error('connect ECONNREFUSED');
  },
};
let env: Awaited<ReturnType<typeof createTestEnv>>;
let app: ReturnType<typeof buildApp>;
let baseUrl = '';
let client: ReturnType<typeof createApiClient>;

beforeAll(async () => {
  env = await createTestEnv();
  // Limits high enough that this file never meets them; limits.int.test.ts covers them.
  const rateLimits = { general: 10_000, upload: 10_000 };
  app = buildApp({}, { apiKeys: [apiKey], checks, storage: createMemoryStorage(), service: env.service, rateLimits });
  baseUrl = await listen(app);
  client = createApiClient({ baseUrl, headers: { 'X-API-Key': apiKey } });
});
afterAll(async () => {
  await app.close();
  await env.close();
});

const upload = (key: string, file: Blob) =>
  client.POST('/v1/invoices', {
    params: { header: { 'Idempotency-Key': key } },
    body: { file },
    bodySerializer: (body) => formData('file', [body.file]),
  });

test('GET /healthz', async () => {
  const { data, response } = await client.GET('/healthz');
  expectMatchesSpec('/healthz', 'get', response, data);
});

test('GET /readyz answers 200 when every check passes and 503 naming the failed one', async () => {
  const ready = await client.GET('/readyz');
  expectMatchesSpec('/readyz', 'get', ready.response, ready.data);
  expect(ready.data).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });

  redisUp = false;
  const unready = await client.GET('/readyz');
  redisUp = true;
  expectMatchesSpec('/readyz', 'get', unready.response, unready.error);
  expect(unready.error).toEqual({ status: 'unavailable', checks: { postgres: 'ok', redis: 'fail' } });
});

test('every operation except the probes returns 401 without a valid X-API-Key, before validation', async () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const isPublic = (operation.security ?? spec.security).length === 0;
      for (const headers of [{}, { 'X-API-Key': 'x'.repeat(40) }] as HeadersInit[]) {
        const response = await fetch(baseUrl + path.replace(/\{\w+\}/g, randomUUID()), { method, headers });
        const body = await response.json();
        if (isPublic) {
          expect(response.status).not.toBe(401);
        } else {
          expectMatchesSpec(path, method, response, body);
          expect(response.status).toBe(401);
        }
      }
    }
  }
});

test('POST /v1/invoices returns 202 for a new PDF and 200 with the same id for a duplicate, and queues one job', async () => {
  const file = await pdf('new');
  const created = await upload('key-new', file);
  expectMatchesSpec('/v1/invoices', 'post', created.response, created.data);
  expect(created.response.status).toBe(202);

  const duplicate = await upload('key-dup', file);
  expectMatchesSpec('/v1/invoices', 'post', duplicate.response, duplicate.data);
  expect(duplicate.response.status).toBe(200);
  expect(duplicate.data?.id).toBe(created.data?.id);

  const jobs = await env.queues.queue('extract').getJobs(['waiting']);
  expect(jobs.filter((job) => job.data.invoiceId === created.data?.id)).toHaveLength(1);
});

test('POST /v1/invoices rejects bad uploads with Problem Details', async () => {
  await upload('key-reused', await pdf('first'));
  const reused = await upload('key-reused', await pdf('second'));
  expectMatchesSpec('/v1/invoices', 'post', reused.response, reused.error);
  expect(reused.response.status).toBe(422);

  const notPdf = await upload('key-text', new Blob(['plain text']));
  expectMatchesSpec('/v1/invoices', 'post', notPdf.response, notPdf.error);
  expect(notPdf.response.status).toBe(415);

  // The typed client cannot omit a required header, so this request uses plain fetch.
  const noKey = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: formData('file', [await pdf('no key')]),
  });
  expectMatchesSpec('/v1/invoices', 'post', noKey, await noKey.json());
  expect(noKey.status).toBe(400);
});

test('POST /v1/invoice-batches returns per-file results and never fails the whole batch', async () => {
  const knownFile = await pdf('known');
  const known = await upload('key-known', knownFile);
  const { data, response } = await client.POST('/v1/invoice-batches', {
    body: { files: [await pdf('batch'), new Blob(['not a pdf']), knownFile] },
    bodySerializer: (body) => formData('files', body.files),
  });
  expectMatchesSpec('/v1/invoice-batches', 'post', response, data);
  expect(data?.results.map(({ index, status }) => [index, status])).toEqual([
    [0, 'accepted'],
    [1, 'rejected'],
    [2, 'duplicate'],
  ]);
  expect(data?.results[2]?.invoice_id).toBe(known.data?.id);
});

test('GET /v1/invoices pages newest first with an opaque keyset cursor and validates its query', async () => {
  await upload('key-page-1', await pdf('page 1'));
  const newest = await upload('key-page-2', await pdf('page 2'));
  const first = await client.GET('/v1/invoices', { params: { query: { limit: 1 } } });
  expectMatchesSpec('/v1/invoices', 'get', first.response, first.data);
  expect(first.data?.items[0]?.id).toBe(newest.data?.id);
  const cursor = first.data?.next_cursor ?? undefined;
  expect(cursor).toEqual(expect.any(String));

  const second = await client.GET('/v1/invoices', { params: { query: { limit: 1, cursor } } });
  expectMatchesSpec('/v1/invoices', 'get', second.response, second.data);
  expect(second.data?.items[0]?.id).not.toBe(first.data?.items[0]?.id);

  const failed = await client.GET('/v1/invoices', { params: { query: { status: 'failed' } } });
  expect(failed.data).toEqual({ items: [], next_cursor: null });

  const tooLarge = await client.GET('/v1/invoices', { params: { query: { limit: 101 } } });
  expectMatchesSpec('/v1/invoices', 'get', tooLarge.response, tooLarge.error);
  expect(tooLarge.response.status).toBe(400);

  const forged = await client.GET('/v1/invoices', { params: { query: { cursor: 'not-a-cursor' } } });
  expect(forged.response.status).toBe(400);
});

test('GET /v1/invoices/{id} returns the invoice or a 404 Problem', async () => {
  const created = await upload('key-get', await pdf('get'));
  const id = created.data?.id ?? '';
  const found = await client.GET('/v1/invoices/{id}', { params: { path: { id } } });
  expectMatchesSpec('/v1/invoices/{id}', 'get', found.response, found.data);
  expect(found.data).toMatchObject({ id, status: 'received', filename: 'invoice-0.pdf', carrier: null });

  const missing = await client.GET('/v1/invoices/{id}', { params: { path: { id: randomUUID() } } });
  expectMatchesSpec('/v1/invoices/{id}', 'get', missing.response, missing.error);
  expect(missing.response.status).toBe(404);
});

test('GET /v1/discrepancies returns a page of discrepancies', async () => {
  const created = await upload('key-discrepancy', await pdf('discrepancy'));
  await env.db.insert(discrepancies).values({
    tenantId: env.tenantId,
    invoiceId: created.data?.id ?? '',
    type: 'rate_mismatch',
    expectedCents: 125_000n,
    billedCents: 131_250n,
    evidence: 'Contract linehaul is 1,250.00 USD; billed 1,312.50 USD.',
  });
  const { data, response } = await client.GET('/v1/discrepancies', { params: { query: { limit: 10 } } });
  expectMatchesSpec('/v1/discrepancies', 'get', response, data);
  expect(data?.items).toHaveLength(1);
  expect(data?.items[0]).toMatchObject({ expected_cents: 125_000, billed_cents: 131_250, line_item_id: null });
});

test('POST /v1/dead-letters/{id}/replay requeues once, then returns 404', async () => {
  const created = await upload('key-dead', await pdf('dead'));
  const [dead] = await env.db
    .insert(deadLetters)
    .values({ tenantId: env.tenantId, queue: 'extract', jobId: 'dead-job', payload: { invoiceId: created.data?.id }, error: 'boom', attempts: 5 })
    .returning();
  const replay = (id: string) => client.POST('/v1/dead-letters/{id}/replay', { params: { path: { id } } });
  const first = await replay(dead!.id);
  expectMatchesSpec('/v1/dead-letters/{id}/replay', 'post', first.response, first.data);
  expect(first.data).toEqual({ id: dead!.id, job_id: 'dead-job' });
  expect((await env.queues.queue('extract').getJob('dead-job'))?.data).toEqual({ invoiceId: created.data?.id, tenantId: env.tenantId });

  const second = await replay(dead!.id);
  expectMatchesSpec('/v1/dead-letters/{id}/replay', 'post', second.response, second.error);
  expect(second.response.status).toBe(404);
  expect((await replay('extract:42')).response.status).toBe(404);
});

test('every operation in openapi.yaml is exercised above', () => {
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method} ${path}`),
  );
  expect([...covered].sort()).toEqual(operations.sort());
});
