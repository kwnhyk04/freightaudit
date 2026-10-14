import { carriers, shipments, tmsSyncState } from '@freightaudit/db';
import { eq } from 'drizzle-orm';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestEnv, waitFor } from './testing.ts';
import { scheduleTmsSync } from './workers.ts';

// 250 shipments; a page is up to `limit` references after the cursor, and the cursor is the last reference.
const references = Array.from({ length: 250 }, (_, i) => `SHP-${String(i + 1).padStart(6, '0')}`);

test('the TMS sync pages with a saved cursor, retries a page in place, and resumes mid-stream after a failed attempt', async () => {
  const requests: string[] = [];
  const tms = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://tms');
    const after = url.searchParams.get('after') ?? '';
    requests.push(after);
    if (requests.length === 2) return res.writeHead(429, { 'retry-after': '0' }).end();
    // The third page fails 10 times in a row, the most one page is tried, ending that attempt after two pages were saved.
    if (requests.length >= 4 && requests.length <= 13) return res.writeHead(500).end();
    const rest = references.filter((reference) => reference > after);
    const limit = Number(url.searchParams.get('limit'));
    const items = rest.slice(0, limit).map((reference, i) => ({
      reference,
      pro_number: reference.replace('SHP-', '7'),
      carrier: i % 2 === 0 ? 'Halcyon Ridge Freight' : 'Copperline Haulage',
      origin: 'Reno, NV',
      destination: 'Boise, ID',
      shipped_on: '2026-09-01',
      weight_lb: 500,
      miles: 430,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items, next_cursor: items.at(-1)?.reference ?? null, has_more: rest.length > limit }));
  });
  tms.listen(0, '127.0.0.1');
  await once(tms, 'listening');
  const env = await createTestEnv();
  try {
    // An every-5-minutes schedule whose first run starts at once.
    await scheduleTmsSync(env.queues, env.tenantId);
    expect((await env.queues.queue('tms-sync').getJobScheduler('tms-sync'))?.every).toBe(300_000);
    env.runWorkers({ tmsUrl: `http://127.0.0.1:${(tms.address() as AddressInfo).port}` });

    const [job] = await waitFor(async () => {
      const completed = await env.queues.queue('tms-sync').getCompleted();
      return completed.length > 0 && completed;
    });
    // The 429 and the first nine 500s retried the same page in place; the next attempt resumed from the cursor saved
    // after page two.
    expect(requests).toEqual(['', 'SHP-000100', 'SHP-000100', ...Array<string>(11).fill('SHP-000200')]);
    expect(job!.attemptsMade).toBe(2);
    expect(job!.returnvalue).toEqual({ pages: 1, upserted: 50 });
    const [state] = await env.db.select().from(tmsSyncState).where(eq(tmsSyncState.tenantId, env.tenantId));
    expect(state?.cursor).toBe('SHP-000250');
    expect(await env.db.$count(shipments)).toBe(250);
    expect(await env.db.$count(shipments, eq(shipments.miles, 430))).toBe(250);
    // Carriers the TMS names are created on the way.
    expect(await env.db.$count(carriers, eq(carriers.name, 'Copperline Haulage'))).toBe(1);
  } finally {
    await env.close();
    tms.closeAllConnections();
    tms.close();
  }
});
