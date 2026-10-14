import { is } from 'drizzle-orm';
import { getTableConfig, isPgEnum, PgTable } from 'drizzle-orm/pg-core';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { backfillRateCardVersions } from '../scripts/backfill-rate-card-versions.ts';
import { seed } from '../scripts/seed.ts';
import { migrate } from './migrate.ts';
import * as schema from './schema.ts';

const quiet = () => {};
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);

// Each test runs in a throwaway database on the Postgres server in DATABASE_URL (infra/docker-compose.yml locally).
async function withDatabase(test: (client: pg.Client, url: string) => Promise<void>) {
  const server = process.env.DATABASE_URL;
  if (!server) throw new Error('DATABASE_URL is not set: copy .env.example to .env and start Postgres');
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

test('the status trigger rejects invoice moves the lifecycle does not list', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { log: quiet });
    const { rows: tenants } = await client.query("INSERT INTO tenants (name) VALUES ('Test tenant') RETURNING id");
    const { rows: invoices } = await client.query(
      "INSERT INTO invoices (tenant_id, filename, content_sha256) VALUES ($1, 'a.pdf', repeat('a', 64)) RETURNING id",
      [tenants[0].id],
    );
    const move = (status: string) => client.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, invoices[0].id]);
    await expect(move('approved')).rejects.toMatchObject({ code: '23514' });
    // Allowed moves, including a repeat of the current status by a retried job.
    for (const status of ['extracting', 'extracting', 'failed', 'received']) await move(status);
    await expect(move('reconciled')).rejects.toMatchObject({ code: '23514' });
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

test('backfill on the small seed resumes after a crash, then the contract migrations apply', () =>
  withDatabase(async (client, url) => {
    await migrate(url, { to: '0002', log: quiet });
    await seed(client, 'small', { flatRates: true, log: quiet });
    const nullLines = () => count(client, 'SELECT count(*) FROM invoice_lines WHERE rate_card_version_id IS NULL');
    const total = await nullLines();
    expect(total).toBeGreaterThan(1_000);

    // A crash right after the first batch commits; the rerun picks up the rows that are still null.
    const crash = (msg: string) => {
      if (msg === 'batch done') throw new Error('crash');
    };
    await expect(backfillRateCardVersions(client, { batchSize: 500, log: crash })).rejects.toThrow('crash');
    expect(await nullLines()).toBe(total - 500);
    expect(await backfillRateCardVersions(client, { batchSize: 500, log: quiet })).toEqual({ versions: 0, rates: 0, lines: total - 500, remaining: 0 });
    expect(await count(client, misversionedLines)).toBe(0);
    expect(await backfillRateCardVersions(client, { log: quiet })).toEqual({ versions: 0, rates: 0, lines: 0, remaining: 0 });

    await migrate(url, { log: quiet });
    const { rows } = await client.query(`SELECT
      (SELECT array_agg(attrelid::regclass::text ORDER BY attrelid::regclass::text) FROM pg_attribute
        WHERE attrelid IN ('invoice_lines'::regclass, 'rate_cards'::regclass) AND attname = 'rate_card_version_id' AND attnotnull) AS not_null,
      (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE '%rate_card_version_id_check') AS temporary_checks,
      (SELECT bool_and(convalidated) FROM pg_constraint WHERE conname LIKE '%rate_card_version_id_fkey') AS foreign_keys_valid,
      (SELECT count(*)::int FROM pg_index WHERE indisvalid AND indexrelid IN
        ('invoice_lines_rate_card_version_id_idx'::regclass, 'rate_cards_version_charge_code_key'::regclass)) AS valid_indexes,
      (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'rate_cards'::regclass AND attname = 'carrier_id' AND NOT attisdropped) AS flat_columns`);
    expect(rows[0]).toEqual({
      not_null: ['invoice_lines', 'rate_cards'],
      temporary_checks: 0,
      foreign_keys_valid: true,
      valid_indexes: 2,
      flat_columns: 0,
    });
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
      (SELECT count(DISTINCT status)::int FROM invoices) AS statuses`);
    expect(rows[0]).toEqual({ tenants: 1, carriers: 6, shipments: 5_000, invoices: 500, versions: 2, statuses: 8 });
    expect(await count(client, misversionedLines)).toBe(0);
    // Seeded statuses follow the lifecycle: lines only after extraction, open findings only in needs_review,
    // and no findings at all before reconciliation ends or when it found none.
    const offLifecycle = `SELECT count(*) FROM invoices i WHERE
      (i.status IN ('received', 'extracting', 'failed')) = EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id)
      OR (i.status = 'needs_review') <> EXISTS (SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id AND d.status = 'open')
      OR (i.status IN ('extracted', 'reconciling', 'reconciled') AND EXISTS (SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id))`;
    expect(await count(client, offLifecycle)).toBe(0);
    await expect(seed(client, 'small', { log: quiet })).rejects.toThrow('already has data');
  }));
