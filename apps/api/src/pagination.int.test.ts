import { createMemoryStorage } from '@freightaudit/pipeline';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv, formData, listen, pdf } from './testing.ts';

type Page = { items: { id: string }[]; next_cursor: string | null };

let env: Awaited<ReturnType<typeof createTestEnv>>;
let app: ReturnType<typeof buildApp>;
let baseUrl = '';
beforeAll(async () => {
  env = await createTestEnv();
  const rateLimits = { general: 10_000, upload: 10_000 };
  app = buildApp({}, { apiKeys: [apiKey], storage: createMemoryStorage(), service: env.service, rateLimits });
  baseUrl = await listen(app);
});
afterAll(async () => {
  await app.close();
  await env.close();
});

const headers = { 'X-API-Key': apiKey };
// 300 rows within 100 µs: groups of three share a created_at and the groups are 1 µs apart, so a cursor that dropped
// the id or kept only milliseconds would skip or repeat rows.
const BASE = sql`timestamptz '2026-10-01 12:00:00+00'`;
const micros = (n: number) => sql`${BASE} + ${n} * interval '1 microsecond'`;

async function getPage(cursor: string | null): Promise<Page> {
  const url = new URL('/v1/invoices', baseUrl);
  url.searchParams.set('limit', '7');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

// While a page is read: an upload lands at the head of the list, and a late row ties with an existing created_at
// somewhere in the range being paged, as a long transaction's row would.
async function writeDuring(page: number) {
  const upload = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    body: formData('file', [await pdf(`concurrent ${page}`)]),
  });
  expect(upload.status).toBe(202);
  await env.db.execute(sql`INSERT INTO invoices (tenant_id, filename, content_sha256, created_at)
    VALUES (${env.tenantId}, 'late.pdf', encode(sha256(convert_to(${`late ${page}`}, 'UTF8')), 'hex'), ${micros((page * 37) % 100)})`);
}

test('GET /v1/invoices pages every existing row exactly once, in order, while rows are inserted concurrently', async () => {
  await env.db.execute(sql`INSERT INTO invoices (tenant_id, filename, content_sha256, created_at)
    SELECT ${env.tenantId}, 'seeded.pdf', encode(sha256(convert_to('seeded ' || g, 'UTF8')), 'hex'), ${BASE} + (g / 3) * interval '1 microsecond'
    FROM generate_series(0, 299) AS g`);
  const existing = (await env.db.execute<{ id: string }>(sql`SELECT id FROM invoices`)).rows.map((row) => row.id);

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page === 0 || cursor; page++) {
    const [result]: [Page, void] = await Promise.all([getPage(cursor), writeDuring(page)]);
    seen.push(...result.items.map((item) => item.id));
    cursor = result.next_cursor;
  }

  // No duplicates, and no gaps among the rows that existed before paging began.
  expect(new Set(seen).size).toBe(seen.length);
  expect(existing.filter((id) => !seen.includes(id))).toEqual([]);
  // Newest first by (created_at to the microsecond, id): the order of the keyset index.
  const { rows } = await env.db.execute<{ id: string; key: string }>(
    sql`SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || ' ' || id AS key FROM invoices`,
  );
  const keys = new Map(rows.map((row) => [row.id, row.key]));
  const order = seen.map((id) => keys.get(id)!);
  expect(order).toEqual([...order].sort().reverse());
});
