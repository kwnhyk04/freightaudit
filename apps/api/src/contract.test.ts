import { createApiClient, openapiPath } from '@freightaudit/contracts';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { parse } from 'yaml';
import { buildApp } from './app.ts';
import { createStore } from './stub-service.ts';

type Json = Record<string, unknown>;
type ResponseDoc = { headers?: Record<string, { required?: boolean }>; content?: Record<string, { schema: Json }> };
type Spec = { paths: Record<string, Record<string, { responses: Record<string, ResponseDoc> }>> };

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

const store = createStore();
const app = buildApp({}, store);
let baseUrl = '';
let client: ReturnType<typeof createApiClient>;

beforeAll(async () => {
  await app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  client = createApiClient({ baseUrl });
});
afterAll(() => app.close());

const pdf = (text: string) => new Blob([`%PDF-1.7 ${text}`], { type: 'application/pdf' });

function formData(field: string, files: Blob[]) {
  const body = new FormData();
  files.forEach((file, index) => body.append(field, file, `invoice-${index}.pdf`));
  return body;
}

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

test('POST /v1/invoices returns 202 for a new PDF and 200 with the same id for a duplicate', async () => {
  const created = await upload('key-new', pdf('new'));
  expectMatchesSpec('/v1/invoices', 'post', created.response, created.data);
  expect(created.response.status).toBe(202);

  const duplicate = await upload('key-dup', pdf('new'));
  expectMatchesSpec('/v1/invoices', 'post', duplicate.response, duplicate.data);
  expect(duplicate.response.status).toBe(200);
  expect(duplicate.data?.id).toBe(created.data?.id);
});

test('POST /v1/invoices rejects bad uploads with Problem Details', async () => {
  await upload('key-reused', pdf('first'));
  const reused = await upload('key-reused', pdf('second'));
  expectMatchesSpec('/v1/invoices', 'post', reused.response, reused.error);
  expect(reused.response.status).toBe(422);

  const notPdf = await upload('key-text', new Blob(['plain text']));
  expectMatchesSpec('/v1/invoices', 'post', notPdf.response, notPdf.error);
  expect(notPdf.response.status).toBe(415);

  // The typed client cannot omit a required header, so this request uses plain fetch.
  const noKey = await fetch(`${baseUrl}/v1/invoices`, { method: 'POST', body: formData('file', [pdf('no key')]) });
  expectMatchesSpec('/v1/invoices', 'post', noKey, await noKey.json());
  expect(noKey.status).toBe(400);
});

test('POST /v1/invoice-batches returns per-file results and never fails the whole batch', async () => {
  const known = await upload('key-known', pdf('known'));
  const { data, response } = await client.POST('/v1/invoice-batches', {
    body: { files: [pdf('batch'), new Blob(['not a pdf']), pdf('known')] },
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

test('GET /v1/invoices pages with an opaque cursor and validates its query', async () => {
  await upload('key-page-1', pdf('page 1'));
  await upload('key-page-2', pdf('page 2'));
  const first = await client.GET('/v1/invoices', { params: { query: { limit: 1 } } });
  expectMatchesSpec('/v1/invoices', 'get', first.response, first.data);
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
});

test('GET /v1/invoices/{id} returns the invoice or a 404 Problem', async () => {
  const created = await upload('key-get', pdf('get'));
  const id = created.data?.id ?? '';
  const found = await client.GET('/v1/invoices/{id}', { params: { path: { id } } });
  expectMatchesSpec('/v1/invoices/{id}', 'get', found.response, found.data);
  expect(found.data?.id).toBe(id);

  const missing = await client.GET('/v1/invoices/{id}', { params: { path: { id: randomUUID() } } });
  expectMatchesSpec('/v1/invoices/{id}', 'get', missing.response, missing.error);
  expect(missing.response.status).toBe(404);
});

test('GET /v1/discrepancies returns a page of discrepancies', async () => {
  store.discrepancies.push({
    id: randomUUID(),
    invoice_id: randomUUID(),
    line_item_id: null,
    shipment_id: null,
    rate_card_version_id: null,
    type: 'rate_mismatch',
    status: 'open',
    expected_cents: 125_000,
    billed_cents: 131_250,
    evidence: 'Contract linehaul is 1,250.00 USD; billed 1,312.50 USD.',
    created_at: new Date().toISOString(),
  });
  const { data, response } = await client.GET('/v1/discrepancies', { params: { query: { limit: 10 } } });
  expectMatchesSpec('/v1/discrepancies', 'get', response, data);
  expect(data?.items).toHaveLength(1);
});

test('POST /v1/dead-letters/{id}/replay requeues once, then returns 404', async () => {
  store.deadLetterIds.add('extract:42');
  const replay = () => client.POST('/v1/dead-letters/{id}/replay', { params: { path: { id: 'extract:42' } } });
  const first = await replay();
  expectMatchesSpec('/v1/dead-letters/{id}/replay', 'post', first.response, first.data);
  expect(first.response.status).toBe(202);

  const second = await replay();
  expectMatchesSpec('/v1/dead-letters/{id}/replay', 'post', second.response, second.error);
  expect(second.response.status).toBe(404);
});

test('every operation in openapi.yaml is exercised above', () => {
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method} ${path}`),
  );
  expect([...covered].sort()).toEqual(operations.sort());
});
