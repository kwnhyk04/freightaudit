import { migrate } from '@freightaudit/db/migrate';
import { backfillRateCardVersions } from '@freightaudit/db/scripts/backfill-rate-card-versions';
import { seed } from '@freightaudit/db/scripts/seed';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createMemoryStorage, createQueues } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp } from './app.ts';
import { createService } from './service.ts';
import { apiKey } from './testing.ts';

type Item = { id: string; line_item_id?: string | null; rate_card_version_id?: string | null };

const quiet = () => {};
const headers = { 'x-api-key': apiKey };

// Every item of a list endpoint, page by page, through the api's own handlers and queries.
async function readAll(app: ReturnType<typeof buildApp>, url: string) {
  const items: Item[] = [];
  for (let cursor: string | null = null, first = true; first || cursor; first = false) {
    const response = await app.inject({ url, query: { limit: '100', ...(cursor ? { cursor } : {}) }, headers });
    expect(response.statusCode).toBe(200);
    const page = response.json() as { items: Item[]; next_cursor: string | null };
    items.push(...page.items);
    cursor = page.next_cursor;
  }
  return items;
}

test('rate card versions by expand, backfill and contract: every line gets its version and the api keeps reading', async () => {
  const database = await createTestDatabase({ to: '0001' });
  const client = new pg.Client({ connectionString: database.url });
  const pool = new pg.Pool({ connectionString: database.url });
  const redis = new Redis(testEnv('REDIS_URL'), { maxRetriesPerRequest: 1 });
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  const queues = createQueues(redis, prefix);
  await client.connect();
  const count = async (sql: string) => Number((await client.query(sql)).rows[0].count);
  const nullLines = () => count('SELECT count(*) FROM invoice_lines WHERE rate_card_version_id IS NULL');
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    // The 0001 schema with the small seed: flat rates per carrier, and invoice lines that name no version.
    const seeded = await seed(client, 'small', { flatRates: true, log: quiet });
    const tenantId: string = (await client.query('SELECT id FROM tenants')).rows[0].id;
    const service = createService({ db: drizzle(pool), queues, tenantId, storage: createMemoryStorage() });
    const api = buildApp({}, { apiKeys: [apiKey], storage: createMemoryStorage(), service, rateLimits: { general: 1_000, upload: 1_000 } });
    app = api;

    // What clients read: every invoice, one invoice by id, and every discrepancy.
    async function readAsClients() {
      const invoices = await readAll(api, '/v1/invoices');
      expect(new Set(invoices.map((invoice) => invoice.id)).size).toBe(seeded.invoices);
      const one = await api.inject({ url: `/v1/invoices/${invoices[0]!.id}`, headers });
      expect([one.statusCode, one.json().id]).toEqual([200, invoices[0]!.id]);
      const discrepancies = await readAll(api, '/v1/discrepancies');
      expect(discrepancies).toHaveLength(seeded.discrepancies);
      return discrepancies;
    }

    // Expand: 0002 adds rate_card_versions and nullable version columns; the app reads on, every version still null.
    await migrate(database.url, { to: '0002', log: quiet });
    expect(await nullLines()).toBe(seeded.lines);
    await readAsClients();

    // Backfill in batches. A crash right after the first batch commits; the rerun picks up the rows that are still null.
    const crash = (msg: string) => {
      if (msg === 'batch done') throw new Error('crash');
    };
    await expect(backfillRateCardVersions(client, { batchSize: 500, log: crash })).rejects.toThrow('crash');
    expect(await nullLines()).toBe(seeded.lines - 500);
    const resumed = await backfillRateCardVersions(client, { batchSize: 500, log: quiet });
    expect(resumed).toEqual({ versions: 0, rates: 0, lines: seeded.lines - 500, remaining: 0 });

    // Contract: 0003a proves NOT NULL through a validated check, 0003b builds the indexes concurrently.
    await migrate(database.url, { to: '0003', log: quiet });
    expect(await nullLines()).toBe(0);
    const foreignVersions = `SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      JOIN rate_card_versions v ON v.id = l.rate_card_version_id WHERE v.carrier_id <> i.carrier_id`;
    expect(await count(foreignVersions)).toBe(0);
    const { rows } = await client.query(`SELECT
      (SELECT array_agg(attrelid::regclass::text ORDER BY attrelid::regclass::text) FROM pg_attribute
        WHERE attrelid IN ('invoice_lines'::regclass, 'rate_cards'::regclass) AND attname = 'rate_card_version_id' AND attnotnull) AS not_null,
      (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE '%rate_card_version_id_check') AS temporary_checks,
      (SELECT bool_and(convalidated) FROM pg_constraint WHERE conname LIKE '%rate_card_version_id_fkey') AS foreign_keys_valid,
      (SELECT count(*)::int FROM pg_index WHERE indisvalid AND indexrelid IN
        ('invoice_lines_rate_card_version_id_idx'::regclass, 'rate_cards_version_charge_code_key'::regclass)) AS valid_indexes`);
    expect(rows[0]).toEqual({ not_null: ['invoice_lines', 'rate_cards'], temporary_checks: 0, foreign_keys_valid: true, valid_indexes: 2 });
    // Every finding on a line now names the rate card version that priced it.
    expect((await readAsClients()).filter((d) => d.line_item_id && !d.rate_card_version_id)).toEqual([]);

    // The later migrations, 0004's drop of the flat column among them, reach the schema the app is built for.
    await migrate(database.url, { log: quiet });
    expect(await count("SELECT count(*) FROM pg_attribute WHERE attrelid = 'rate_cards'::regclass AND attname = 'carrier_id' AND NOT attisdropped")).toBe(0);
    expect((await readAsClients()).filter((d) => d.line_item_id && !d.rate_card_version_id)).toEqual([]);
  } finally {
    await app?.close();
    await client.end();
    await pool.end();
    await queues.close();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    await database.drop();
  }
});
