import { faker } from '@faker-js/faker';
import { loadEnv } from '@freightaudit/config/env';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgInsertValue, PgTable } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { logJson, type Log } from '../src/log.ts';
import { CARRIERS, CHARGE_CODES, type ChargeCode } from '../src/reference.ts';
import * as t from '../src/schema.ts';

const SCALES = { small: { shipments: 5_000, invoices: 500 }, large: { shipments: 50_000, invoices: 20_000 } };
export type Scale = keyof typeof SCALES;

// Flat rate range per charge code, in cents. Every rate card has linehaul, fuel and four accessorials.
const RATE_RANGES: Record<ChargeCode, { min: number; max: number }> = {
  LINEHAUL: { min: 45_000, max: 180_000 },
  FUEL: { min: 6_000, max: 25_000 },
  LIFTGATE: { min: 7_500, max: 15_000 },
  RESIDENTIAL: { min: 9_000, max: 16_000 },
  INSIDE_DELIVERY: { min: 10_000, max: 20_000 },
  LIMITED_ACCESS: { min: 8_000, max: 15_000 },
  APPOINTMENT: { min: 2_500, max: 6_000 },
  DETENTION: { min: 7_500, max: 12_500 },
};
const ACCESSORIALS = (Object.keys(CHARGE_CODES) as ChargeCode[]).filter((code) => code !== 'LINEHAUL' && code !== 'FUEL');
// General rate increase: version 1 prices shipments before this day, version 2 from it on.
const GRI_DAY = '2026-01-01';
// Invoice lifecycle (docs/context.md): most invoices are approved, a few are still in flight.
const STATUSES = [
  { value: 'received', weight: 4 },
  { value: 'extracting', weight: 2 },
  { value: 'extracted', weight: 3 },
  { value: 'reconciling', weight: 3 },
  { value: 'reconciled', weight: 20 },
  { value: 'needs_review', weight: 20 },
  { value: 'approved', weight: 45 },
  { value: 'failed', weight: 3 },
] as const;
const EXTRACT_ERRORS = ['Model output failed schema validation after one repair', 'Provider timed out on every attempt', 'PDF has no readable pages'];
const SEEDED_AT = new Date('2024-12-01T00:00:00Z');

const day = (date: Date) => date.toISOString().slice(0, 10);
const hoursAfter = (date: Date | string, hours: number) => new Date(new Date(date).getTime() + hours * 3_600_000);
const stamp = (date: Date) => ({ createdAt: date, updatedAt: date });
const usd = (cents: bigint) => `$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const city = () => `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`;

type Item = { code: ChargeCode; expected: bigint; billed: bigint };

// Adds one billing error to the items and returns the discrepancy a reconciler should raise for it.
function addFinding(items: Item[], contracted: ChargeCode[], version: number) {
  const type = faker.helpers.arrayElement(['rate_mismatch', 'uncontracted_charge', 'duplicate_charge'] as const);
  if (type === 'rate_mismatch') {
    const index = faker.number.int({ min: 0, max: items.length - 1 });
    const item = items[index]!;
    item.billed = (item.expected * BigInt(faker.number.int({ min: 105, max: 125 }))) / 100n;
    return { type, index, evidence: `Rate card version ${version} sets ${item.code} at ${usd(item.expected)}; billed ${usd(item.billed)}.` };
  }
  if (type === 'uncontracted_charge') {
    const code = faker.helpers.arrayElement(ACCESSORIALS.filter((candidate) => !contracted.includes(candidate)));
    items.push({ code, expected: 0n, billed: BigInt(faker.number.int(RATE_RANGES[code])) });
    return { type, index: items.length - 1, evidence: `${code} is not on the carrier's rate card.` };
  }
  const item = faker.helpers.arrayElement(items.slice(1));
  items.push({ ...item, expected: 0n });
  return { type, index: items.length - 1, evidence: `${item.code} is billed twice.` };
}

// Multi-row inserts in batches, each under Postgres' limit of 65,535 bind parameters.
async function insert<T extends PgTable>(db: NodePgDatabase, table: T, rows: PgInsertValue<T>[]) {
  const size = Math.floor(65_535 / Object.keys(getTableColumns(table)).length);
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size));
}

// Deterministic demo data (faker.seed(42)) for an empty, migrated database, written in one transaction.
// flatRates writes the pre-versioning shape (state 0002) that scripts/backfill-rate-card-versions.ts upgrades.
export async function seed(client: pg.Client, scale: Scale, { flatRates = false, log = logJson }: { flatRates?: boolean; log?: Log } = {}) {
  const { rows } = await client.query<{ seeded: boolean }>('SELECT EXISTS (SELECT 1 FROM tenants) AS seeded');
  if (rows[0]?.seeded) throw new Error('Database already has data; seed needs an empty, migrated database.');
  const started = Date.now();
  faker.seed(42);
  const tenantId = faker.string.uuid();
  const carriers = CARRIERS.map((name) => ({ id: faker.string.uuid(), tenantId, name, ...stamp(SEEDED_AT) }));

  // Two rate card versions per carrier; version 2 raises every rate by 3 to 8 percent, in basis points.
  const cards = new Map(
    carriers.map((carrier) => {
      const codes: ChargeCode[] = ['LINEHAUL', 'FUEL', ...faker.helpers.arrayElements(ACCESSORIALS, 4)];
      const base = codes.map((code) => BigInt(faker.number.int(RATE_RANGES[code])));
      const raise = BigInt(10_000 + faker.number.int({ min: 300, max: 800 }));
      const version = (number: number, effective: string, cents: bigint[]) => ({
        row: { id: faker.string.uuid(), tenantId, carrierId: carrier.id, version: number, effective, ...stamp(SEEDED_AT) },
        rates: new Map(codes.map((code, i) => [code, cents[i]!])),
      });
      const versions = [
        version(1, `[2025-01-01 00:00:00+00,${GRI_DAY} 00:00:00+00)`, base),
        version(2, `[${GRI_DAY} 00:00:00+00,)`, base.map((cents) => (cents * raise) / 10_000n)),
      ] as const;
      return [carrier.id, { codes, versions }] as const;
    }),
  );

  const size = SCALES[scale];
  const shipments = Array.from({ length: size.shipments }, (_, i) => {
    const shippedOn = day(faker.date.between({ from: '2025-01-01T00:00:00Z', to: '2026-09-15T00:00:00Z' }));
    return {
      id: faker.string.uuid(),
      tenantId,
      carrierId: faker.helpers.arrayElement(carriers).id,
      proNumber: String(1_000_000_000 + i * 7_919),
      reference: `SHP-${String(i + 1).padStart(6, '0')}`,
      origin: city(),
      destination: city(),
      shippedOn,
      weightLb: faker.number.int({ min: 150, max: 12_000 }),
      ...stamp(hoursAfter(shippedOn, faker.number.int({ min: 6, max: 30 }))),
    };
  });

  const invoices: (typeof t.invoices.$inferInsert)[] = [];
  const lines: (typeof t.invoiceLines.$inferInsert)[] = [];
  const discrepancies: (typeof t.discrepancies.$inferInsert)[] = [];
  const keys: (typeof t.idempotencyKeys.$inferInsert)[] = [];
  const deadLetters: (typeof t.deadLetters.$inferInsert)[] = [];
  // The flat shape predates 0005, whose enum values reconciling and approved did not exist yet.
  const statuses = flatRates ? STATUSES.filter(({ value }) => value !== 'reconciling' && value !== 'approved') : STATUSES;
  faker.helpers.arrayElements(shipments, size.invoices).forEach((shipment, i) => {
    const status = faker.helpers.weightedArrayElement(statuses);
    const invoiceDate = day(hoursAfter(shipment.shippedOn, 24 * faker.number.int({ min: 1, max: 10 })));
    const createdAt = hoursAfter(invoiceDate, faker.number.int({ min: 24, max: 120 }));
    const invoiceNumber = faker.string.numeric(8);
    const contentSha256 = createHash('sha256').update(`seed-invoice-${i}`).digest('hex');
    const invoice = { id: faker.string.uuid(), tenantId, status, filename: `${invoiceNumber}.pdf`, contentSha256, ...stamp(createdAt) };
    if (faker.datatype.boolean(0.7)) keys.push({ tenantId, key: faker.string.uuid(), invoiceId: invoice.id, ...stamp(createdAt) });
    if (status === 'received' || status === 'extracting' || status === 'failed') {
      if (status === 'failed') {
        const error = faker.helpers.arrayElement(EXTRACT_ERRORS);
        const payload = { invoiceId: invoice.id };
        deadLetters.push({ id: faker.string.uuid(), tenantId, queue: 'extract', jobId: contentSha256, payload, error, attempts: 5, ...stamp(hoursAfter(createdAt, 1)) });
      }
      invoices.push(invoice);
      return;
    }

    // Lines bill the version in force on the ship date. needs_review invoices carry one open finding;
    // some approved ones carry a finding a reviewer resolved before approving.
    const card = cards.get(shipment.carrierId)!;
    const version = card.versions[shipment.shippedOn < GRI_DAY ? 0 : 1];
    const codes: ChargeCode[] = ['LINEHAUL', 'FUEL', ...faker.helpers.arrayElements(card.codes.slice(2), { min: 0, max: 2 })];
    const items = codes.map((code) => ({ code, expected: version.rates.get(code)!, billed: version.rates.get(code)! }));
    const flagged = status === 'needs_review' || (status === 'approved' && faker.datatype.boolean(0.15));
    const finding = flagged ? addFinding(items, card.codes, version.row.version) : undefined;
    const invoiceLines = items.map((item, n) => ({
      id: faker.string.uuid(),
      tenantId,
      invoiceId: invoice.id,
      lineNumber: n + 1,
      description: CHARGE_CODES[item.code],
      chargeCode: item.code,
      amountCents: item.billed,
      rateCardVersionId: version.row.id,
      ...stamp(hoursAfter(createdAt, 1)),
    }));
    lines.push(...invoiceLines);
    invoices.push({
      ...invoice,
      carrierId: shipment.carrierId,
      // The shipment is matched during reconciliation.
      shipmentId: status === 'extracted' || status === 'reconciling' ? null : shipment.id,
      invoiceNumber,
      proNumber: shipment.proNumber,
      invoiceDate,
      currency: 'USD',
      totalCents: items.reduce((sum, item) => sum + item.billed, 0n),
    });
    if (finding) {
      const decision = status === 'approved' ? faker.helpers.arrayElement(['confirmed', 'dismissed'] as const) : 'open';
      const notes = { open: null, confirmed: 'Short-paid to the contract amount.', dismissed: 'Carrier showed a signed accessorial request.' };
      discrepancies.push({
        id: faker.string.uuid(),
        tenantId,
        invoiceId: invoice.id,
        invoiceLineId: invoiceLines[finding.index]!.id,
        shipmentId: shipment.id,
        type: finding.type,
        status: decision,
        expectedCents: items[finding.index]!.expected,
        billedCents: items[finding.index]!.billed,
        evidence: finding.evidence,
        note: notes[decision],
        resolvedAt: decision === 'open' ? null : hoursAfter(createdAt, 48),
        ...stamp(hoursAfter(createdAt, 2)),
      });
    }
  });
  const latest = shipments.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));

  const db = drizzle(client);
  await client.query('BEGIN');
  try {
    await insert(db, t.tenants, [{ id: tenantId, name: 'Larkspur Outdoor Supply', ...stamp(SEEDED_AT) }]);
    await insert(db, t.carriers, carriers);
    const versions = [...cards.values()].flatMap((card) => card.versions);
    if (flatRates) {
      // Before 0004, rate_cards still has carrier_id; the flat card holds today's rates.
      for (const [carrierId, card] of cards) {
        for (const [code, cents] of card.versions[1].rates) {
          const values = [tenantId, carrierId, code, cents];
          await client.query('INSERT INTO rate_cards (tenant_id, carrier_id, charge_code, rate_cents) VALUES ($1, $2, $3, $4)', values);
        }
      }
    } else {
      await insert(db, t.rateCardVersions, versions.map((version) => version.row));
      const rates = versions.flatMap(({ row, rates }) =>
        [...rates].map(([chargeCode, rateCents]) => ({ tenantId, rateCardVersionId: row.id, chargeCode, rateCents, ...stamp(SEEDED_AT) })),
      );
      await insert(db, t.rateCards, rates);
    }
    await insert(db, t.shipments, shipments);
    await insert(db, t.invoices, invoices);
    // Flat-rate lines have no version yet and wait for the backfill; the column stays nullable until 0003a.
    await insert(db, t.invoiceLines, flatRates ? lines.map((line) => ({ ...line, rateCardVersionId: sql`NULL` })) : lines);
    await insert(db, t.discrepancies, discrepancies);
    await insert(db, t.idempotencyKeys, keys);
    await insert(db, t.deadLetters, deadLetters);
    await insert(db, t.tmsSyncState, [{ tenantId, cursor: latest.reference, lastSyncedAt: latest.createdAt, ...stamp(latest.createdAt) }]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  const counts = { shipments: shipments.length, invoices: invoices.length, lines: lines.length, discrepancies: discrepancies.length };
  log('seed complete', { scale, flatRates, ...counts, ms: Date.now() - started });
  return counts;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { scale: { type: 'string', default: 'small' } } });
  if (values.scale !== 'small' && values.scale !== 'large') throw new Error('--scale must be small or large');
  const { DATABASE_URL } = loadEnv(['DATABASE_URL']);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await seed(client, values.scale);
  } finally {
    await client.end();
  }
}
