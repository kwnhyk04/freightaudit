import { buildApp } from './app.ts';

type Page = { items: { reference: string }[]; next_cursor: string | null; has_more: boolean };

test('pages every shipment exactly once by cursor, then answers an empty page', async () => {
  const app = buildApp({}, { shipments: 250, rateLimitPerSecond: 1_000 });
  const seen: string[] = [];
  let cursor = '';
  for (let more = true; more; ) {
    const page = (await app.inject({ url: `/shipments?limit=100&after=${cursor}` })).json() as Page;
    seen.push(...page.items.map((item) => item.reference));
    cursor = page.next_cursor ?? cursor;
    more = page.has_more;
  }
  expect(seen).toHaveLength(250);
  expect(new Set(seen).size).toBe(250);
  expect([seen[0], cursor]).toEqual(['TMS-000001', 'TMS-000250']);
  expect((await app.inject({ url: `/shipments?after=${cursor}` })).json()).toEqual({ items: [], next_cursor: null, has_more: false });
});

test('answers 429 with Retry-After past 10 requests in a second, and fails FAULT_RATE of requests', async () => {
  let now = 5_000;
  const app = buildApp({}, { shipments: 5, now: () => now });
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await app.inject({ url: '/shipments' })).statusCode);
  expect(statuses).toEqual([...Array(10).fill(200), 429]);
  expect((await app.inject({ url: '/shipments' })).headers['retry-after']).toBe('1');
  now += 1_000;
  expect((await app.inject({ url: '/shipments' })).statusCode).toBe(200);

  const faulty = buildApp({}, { faultRate: 0.5, random: () => 0.4 });
  expect((await faulty.inject({ url: '/shipments' })).statusCode).toBe(500);
});
