import { is } from 'drizzle-orm';
import { getTableConfig, isPgEnum, PgTable } from 'drizzle-orm/pg-core';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { resetDatabase } from '../scripts/reset.ts';
import { seed } from '../scripts/seed.ts';
import { migrate } from './migrate.ts';
import * as schema from './schema.ts';
import { testEnv } from './testing.ts';

const quiet = () => {};
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);

// Each test runs in an empty throwaway database on the test run's Postgres.
async function withDatabase(test: (client: pg.Client, url: string) => Promise<void>) {
  const server = testEnv('DATABASE_URL');
  const name = `freightaudit_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  try {
    await client.connect();
    await test(client, url.href);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

const count = async (client: pg.Client, query: string) => Number((await client.query(query)).rows[0].count);

// Lines whose version belongs to another carrier, or was not in force on the ship date (invoice date while unmatched).
const misversionedLines = `
  SELECT count(*) FROM invoice_lines l
  JOIN invoices i ON i.id = l.invoice_id
  LEFT JOIN shipments s ON s.id = i.shipment_id
  JOIN rate_card_versions v ON v.id = l.rate_card_version_id
  WHERE v.carrier_id <> i.carrier_id OR NOT v.effective @> (coalesce(s.shipped_on, i.invoice_date)::timestamp AT TIME ZONE 'UTC')`;

test('the status trigger rejects invoice moves the lifecycle does not list, and approval while a finding is open', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { log: quiet });
    const { rows: tenants } = await client.query("INSERT INTO tenants (name) VALUES ('Test tenant') RETURNING id");
    const { rows: invoices } = await client.query(
      "INSERT INTO invoices (tenant_id, filename, content_sha256) VALUES ($1, 'a.pdf', repeat('a', 64)), ($1, 'b.pdf', repeat('b', 64)) RETURNING id",
      [tenants[0].id],
    );
    const move = (status: string, invoice = 0) => client.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, invoices[invoice].id]);
    await expect(move('approved')).rejects.toMatchObject({ code: '23514' });
    // Allowed moves, including a repeat of the current status by a retried job.
    for (const status of ['extracting', 'extracting', 'failed', 'received']) await move(status);
    await expect(move('reconciled')).rejects.toMatchObject({ code: '23514' });
    // An extraction still invalid after its repair and the fallback waits for a reviewer (0009).
    for (const status of ['extracting', 'needs_review', 'approved']) await move(status);

    // A reconciled invoice with an open finding is approved only once the finding has a decision.
    for (const status of ['extracting', 'extracted', 'reconciling', 'reconciled']) await move(status, 1);
    const { rows: findings } = await client.query(
      "INSERT INTO discrepancies (tenant_id, invoice_id, type, expected_cents, billed_cents, evidence) VALUES ($1, $2, 'duplicate_charge', 0, 9500, 'LIFTGATE is billed twice.') RETURNING id",
      [tenants[0].id, invoices[1].id],
    );
    await expect(move('approved', 1)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('open discrepancies') });
    await client.query("UPDATE discrepancies SET status = 'dismissed', resolved_at = now() WHERE id = $1", [findings[0].id]);
    await move('approved', 1);
  }));

test('migrations apply cleanly from empty, re-run as a no-op, and match the Drizzle schema', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { log: quiet });
    await migrate(url, { log: quiet });
    const { rows: applied } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.map((row) => row.name)).toEqual([
      '0001_initial',
      '0002_rate_card_versions_expand',
      '0003a_rate_card_versions_contract',
      '0003b_rate_card_versions_indexes',
      '0004_drop_flat_rate_columns',
      '0005_invoice_lifecycle',
      '0006_extraction_pipeline',
      '0007_reconcile_terms',
      '0008_invoices_shipment_index',
      '0009_llm_calls',
      '0010_review_reason',
      '0011_call_wait_and_carrier_match',
    ]);

    const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => is(value, PgTable));
    const { rows: dbTables } = await client.query("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
    expect(dbTables.sort(byName)).toEqual(tables.map((table) => ({ name: getTableConfig(table).name })).sort(byName));
    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      const { rows } = await client.query(
        `SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS "notNull"
         FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
        [name],
      );
      const expected = columns.map((column) => ({ name: column.name, type: column.getSQLType(), notNull: column.notNull }));
      expect({ table: name, columns: rows.sort(byName) }).toEqual({ table: name, columns: expected.sort(byName) });
    }

    // Enum labels compared as sets: Postgres keeps values in the order they were added.
    const enums = Object.values(schema as Record<string, unknown>).filter(isPgEnum);
    const { rows: labels } = await client.query(
      'SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumlabel) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname',
    );
    expect(labels.sort(byName)).toEqual(enums.map((e) => ({ name: e.enumName, labels: [...e.enumValues].sort() })).sort(byName));
  }));

test('the exclusion constraint rejects overlapping rate card versions for one carrier', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { log: quiet });
    const { rows: tenants } = await client.query("INSERT INTO tenants (name) VALUES ('Test tenant') RETURNING id");
    const tenantId = tenants[0].id;
    const { rows: carriers } = await client.query("INSERT INTO carriers (tenant_id, name) VALUES ($1, 'A'), ($1, 'B') RETURNING id", [tenantId]);
    const addVersion = (carrier: number, version: number, effective: string) =>
      client.query('INSERT INTO rate_card_versions (tenant_id, carrier_id, version, effective) VALUES ($1, $2, $3, $4)', [
        tenantId,
        carriers[carrier].id,
        version,
        effective,
      ]);
    const overlap = { code: '23P01', constraint: 'rate_card_versions_no_overlap' };

    await addVersion(0, 1, '[2025-01-01,2026-01-01)');
    await addVersion(0, 2, '[2026-01-01,)'); // touching half-open ranges do not overlap
    await expect(addVersion(0, 3, '[2025-06-01,2025-07-01)')).rejects.toMatchObject(overlap);
    await expect(addVersion(0, 3, '[2027-01-01,2028-01-01)')).rejects.toMatchObject(overlap); // inside the open-ended version 2
    await addVersion(1, 1, '[2025-06-01,2025-07-01)'); // another carrier may use the same dates
  }));

test('the small seed loads on the fully migrated schema, and lines bill the version in force', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { log: quiet });
    await seed(client, 'small', { log: quiet });
    const { rows } = await client.query(`SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM carriers) AS carriers,
      (SELECT count(*)::int FROM shipments) AS shipments,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(DISTINCT version)::int FROM rate_card_versions) AS versions,
      (SELECT count(DISTINCT status)::int FROM invoices) AS statuses,
      (SELECT count(*)::int FROM shipments WHERE miles IS NULL) AS "shipmentsWithoutMiles",
      (SELECT count(*)::int FROM rate_card_versions v WHERE minimum_cents IS NULL OR fuel_bp IS NULL
        OR NOT EXISTS (SELECT 1 FROM rate_card_bands b WHERE b.rate_card_version_id = v.id AND b.from_mile = 0)) AS "versionsWithoutTerms"`);
    expect(rows[0]).toEqual({ tenants: 1, carriers: 6, shipments: 5_000, invoices: 500, versions: 2, statuses: 8, shipmentsWithoutMiles: 0, versionsWithoutTerms: 0 });
    expect(await count(client, misversionedLines)).toBe(0);
    // Seeded statuses follow the lifecycle: an extraction once extracted; lines, a shipment and findings once reconciled,
    // open on reconciled invoices and decided on approved ones; and needs_review for a PRO number no shipment has.
    const offLifecycle = `SELECT count(*) FROM invoices i WHERE
      (i.status IN ('received', 'extracting', 'failed')) = EXISTS (SELECT 1 FROM extractions e WHERE e.invoice_id = i.id)
      OR (i.status IN ('reconciled', 'approved')) <> EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id)
      OR (i.status IN ('reconciled', 'approved')) <> (i.shipment_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id
        AND (i.status NOT IN ('reconciled', 'approved') OR (d.status = 'open') <> (i.status = 'reconciled')))
      OR (i.status = 'needs_review' AND EXISTS (SELECT 1 FROM shipments s WHERE s.carrier_id = i.carrier_id AND s.pro_number = i.pro_number))`;
    expect(await count(client, offLifecycle)).toBe(0);
    // Some reconciled invoices carry open findings for the review queue.
    expect(await count(client, "SELECT count(*) FROM discrepancies WHERE status = 'open'")).toBeGreaterThan(0);
    await expect(seed(client, 'small', { log: quiet })).rejects.toThrow('already has data');
  }));

test('db:reset refuses a database off this machine or NODE_ENV=production, and otherwise drops the data and seeds small', () =>
  withDatabase(async (client, url) => {
    const remote = 'postgres://app:secret@db.example.com:5432/app';
    await expect(resetDatabase(remote, { log: quiet })).rejects.toThrow(/^db:reset runs only against localhost or 127[.]0[.]0[.]1, not db[.]example[.]com$/);
    // A host parameter decides where pg connects, whatever host precedes the path.
    await expect(resetDatabase(`${url}?host=db.example.com`, { log: quiet })).rejects.toThrow('not db.example.com');
    await expect(resetDatabase(url, { nodeEnv: 'production', log: quiet })).rejects.toThrow('NODE_ENV=production');

    await migrate(url, { log: quiet });
    await client.query("INSERT INTO tenants (name) VALUES ('Data from before')");
    await resetDatabase(url, { nodeEnv: 'development', log: quiet });
    expect((await client.query('SELECT name FROM tenants')).rows).toEqual([{ name: 'Larkspur Outdoor Supply' }]);
    expect(await count(client, 'SELECT count(*) FROM invoices')).toBe(500);
    expect(await count(client, 'SELECT count(*) FROM schema_migrations')).toBe(12);
  }));
