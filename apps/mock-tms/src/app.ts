import { CARRIERS } from '@freightaudit/db';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { setTimeout } from 'node:timers/promises';

export type MockTmsOptions = {
  shipments?: number;
  rateLimitPerSecond?: number;
  // Share of /shipments requests that fail with 500, and delay added to each.
  faultRate?: number;
  latencyMs?: number;
  random?: () => number;
  now?: () => number;
};

const CITIES = ['Reno, NV', 'Boise, ID', 'Tulsa, OK', 'Fresno, CA', 'Omaha, NE', 'Spokane, WA', 'Dayton, OH', 'Mobile, AL'];
const DAY_MS = 86_400_000;

// Shipment n (from 1) is the same on every call. References sort in creation order, so the last one is the cursor.
const shipment = (n: number) => ({
  reference: `TMS-${String(n).padStart(6, '0')}`,
  pro_number: String(2_000_000_000 + n * 7_919),
  carrier: CARRIERS[n % CARRIERS.length]!,
  origin: CITIES[n % CITIES.length]!,
  destination: CITIES[(n * 3 + 1) % CITIES.length]!,
  shipped_on: new Date(Date.UTC(2025, 0, 1) + (n % 600) * DAY_MS).toISOString().slice(0, 10),
  weight_lb: 150 + ((n * 37) % 11_850),
  miles: 25 + ((n * 53) % 2_476),
});

// Fake TMS: generated shipments behind cursor pagination, a rate limit, and fault injection.
export function buildApp(
  opts: FastifyServerOptions,
  { shipments = 1_000, rateLimitPerSecond = 10, faultRate = 0, latencyMs = 0, random = Math.random, now = Date.now }: MockTmsOptions = {},
) {
  const app = Fastify(opts);
  const all = Array.from({ length: shipments }, (_, i) => shipment(i + 1));
  let second = 0;
  let used = 0;

  app.get('/healthz', async () => ({ status: 'ok' }));
  // No dependencies, so it is ready whenever it is up.
  app.get('/readyz', async () => ({ status: 'ok', checks: {} }));

  // GET /shipments?after=<cursor>&limit=<1-100>: the shipments after the cursor, oldest first.
  app.get('/shipments', async (req, reply) => {
    // One fixed one-second window shared by every client.
    const current = Math.floor(now() / 1_000);
    if (current !== second) [second, used] = [current, 0];
    if (++used > rateLimitPerSecond) return reply.code(429).header('retry-after', '1').send({ error: 'rate limit exceeded' });
    if (latencyMs > 0) await setTimeout(latencyMs);
    if (random() < faultRate) return reply.code(500).send({ error: 'injected fault' });

    const { after = '', limit } = req.query as { after?: string; limit?: string };
    const size = Math.min(Math.max(Number.parseInt(limit ?? '', 10) || 100, 1), 100);
    const rest = all.filter((item) => item.reference > after);
    const items = rest.slice(0, size);
    return { items, next_cursor: items.at(-1)?.reference ?? null, has_more: rest.length > size };
  });
  return app;
}
