import { faker } from '@faker-js/faker';
import { loadEnv } from '@freightaudit/config/env';
import { formatUsd, type RateCardVersion, rateShipment, versionInForce } from '@freightaudit/domain';
import { getTableColumns } from 'drizzle-orm';
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

// Flat accessorial rates, in cents. Linehaul and fuel have none: a version prices them from its bands, minimum and
// fuel surcharge and the shipment's miles.
const ACCESSORIAL_RATES = {
  LIFTGATE: { min: 7_500, max: 15_000 },
  RESIDENTIAL: { min: 9_000, max: 16_000 },
  INSIDE_DELIVERY: { min: 10_000, max: 20_000 },
  LIMITED_ACCESS: { min: 8_000, max: 15_000 },
  APPOINTMENT: { min: 2_500, max: 6_000 },
  DETENTION: { min: 7_500, max: 12_500 },
} satisfies Partial<Record<ChargeCode, { min: number; max: number }>>;
type Accessorial = keyof typeof ACCESSORIAL_RATES;
const ACCESSORIALS = Object.keys(ACCESSORIAL_RATES) as Accessorial[];
// General rate increase: version 1 prices shipments before this day, version 2 from it on.
const GRI_DAY = '2026-01-01';
// Invoice lifecycle (docs/context.md): most invoices are approved, a few are still in flight, and needs_review holds
// the extractions that could not be trusted.
const STATUSES = [
  { value: 'received', weight: 4 },
  { value: 'extracting', weight: 2 },
  { value: 'extracted', weight: 3 },
  { value: 'reconciling', weight: 3 },
  { value: 'reconciled', weight: 35 },
  { value: 'needs_review', weight: 5 },
  { value: 'approved', weight: 45 },
  { value: 'failed', weight: 3 },
] as const;
type Status = (typeof STATUSES)[number]['value'];
// Share of invoices with a planted overcharge. It is an open discrepancy on reconciled invoices and a decided one on
// approved invoices; on extracted and reconciling invoices only the ground truth has it, until the reconcile job runs.
const PLANTED: Partial<Record<Status, number>> = { extracted: 0.5, reconciling: 0.5, reconciled: 0.5, approved: 0.15 };
const EXTRACT_ERRORS = ['Model output failed schema validation after one repair', 'Provider timed out on every attempt', 'PDF has no readable pages'];
const SEEDED_AT = new Date('2024-12-01T00:00:00Z');

const day = (date: Date) => date.toISOString().slice(0, 10);
const hoursAfter = (date: Date | string, hours: number) => new Date(new Date(date).getTime() + hours * 3_600_000);
const stamp = (date: Date) => ({ createdAt: date, updatedAt: date });
const city = () => `${faker.location.city()}, ${faker.location.state({ abbreviated: true })}`;

// A rate card version as the domain prices it, with its row id and effective range.
export type Version = RateCardVersion & { id: string; effective: string };
// A carrier's contract: the accessorials it covers, and the versions before and from the rate increase.
export type Card = { accessorials: Accessorial[]; versions: Version[] };
// One billed line: what the version in force contracts for its charge, and what the carrier billed.
type Item = { code: ChargeCode; expected: bigint; billed: bigint };
export type Overcharge = {
  lineNumber: number;
  type: 'rate_mismatch' | 'uncontracted_charge' | 'duplicate_charge';
  expectedCents: bigint;
  billedCents: bigint;
  evidence: string;
};
// What a correct reconciler finds for an invoice: each line's contracted and billed amounts, and every planted overcharge.
export type Truth = {
  invoiceId: string;
  status: Status;
  shippedOn: string;
  lines: { lineNumber: number; chargeCode: ChargeCode; expectedCents: bigint; billedCents: bigint }[];
  overcharges: Overcharge[];
};

// Adds one overcharge of the given type, else a random one, to the items and returns it as a reconciler should report it.
function plantOvercharge(items: Item[], card: Card, version: Version, kind?: Overcharge['type']): Overcharge {
  const type = kind ?? faker.helpers.arrayElement(['rate_mismatch', 'uncontracted_charge', 'duplicate_charge'] as const);
  let evidence: string;
  if (type === 'rate_mismatch') {
    const item = items[faker.number.int({ min: 0, max: items.length - 1 })]!;
    item.billed = (item.expected * BigInt(faker.number.int({ min: 105, max: 125 }))) / 100n;
    evidence = `Rate card version ${version.version} sets ${item.code} at ${formatUsd(item.expected)}; billed ${formatUsd(item.billed)}.`;
    return { lineNumber: items.indexOf(item) + 1, type, expectedCents: item.expected, billedCents: item.billed, evidence };
  }
  if (type === 'uncontracted_charge') {
    const code = faker.helpers.arrayElement(ACCESSORIALS.filter((candidate) => !card.accessorials.includes(candidate)));
    items.push({ code, expected: 0n, billed: BigInt(faker.number.int(ACCESSORIAL_RATES[code])) });
    evidence = `${code} is not on rate card version ${version.version}.`;
  } else {
    const item = faker.helpers.arrayElement(items.slice(1));
    items.push({ ...item, expected: 0n });
    evidence = `${item.code} is billed twice.`;
  }
  return { lineNumber: items.length, type, expectedCents: 0n, billedCents: items.at(-1)!.billed, evidence };
}

// What a carrier bills for a shipment under the version in force on its ship date: the linehaul and fuel surcharge
// its terms give for the miles, up to `extras` of the contracted accessorials, and one planted overcharge if `plant`
// (of that type when it names one).
export function billShipment(card: Card, shipment: { shippedOn: string; miles: number }, extras: number, plant: boolean | Overcharge['type']) {
  const version = versionInForce(card.versions, shipment.shippedOn)!;
  const { linehaulCents, fuelCents } = rateShipment(version.rates, shipment.miles);
  const contracted = (code: ChargeCode, cents: bigint): Item => ({ code, expected: cents, billed: cents });
  const items = [
    contracted('LINEHAUL', linehaulCents),
    contracted('FUEL', fuelCents),
    ...faker.helpers.arrayElements(card.accessorials, { min: 0, max: extras }).map((code) => contracted(code, version.accessorials[code]!)),
  ];
  return { version, items, overcharges: plant ? [plantOvercharge(items, card, version, plant === true ? undefined : plant)] : [] };
}

// Multi-row inserts in batches, each under Postgres' limit of 65,535 bind parameters.
async function insert<T extends PgTable>(db: NodePgDatabase, table: T, rows: PgInsertValue<T>[]) {
  const size = Math.floor(65_535 / Object.keys(getTableColumns(table)).length);
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size));
}

// The same, naming only the given columns: a Drizzle insert names every column of the latest schema.
async function insertColumns(client: pg.Client, table: string, columns: string[], rows: unknown[][]) {
  const size = Math.floor(65_535 / columns.length);
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const values = batch.map((_, row) => `(${columns.map((_, column) => `$${row * columns.length + column + 1}`).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`, batch.flat());
  }
}

// Deterministic demo data (faker.seed(42)) and its ground truth, in memory. flatRates gives the pre-versioning shape
// of 0001. The eval fixtures bill the shipments these invoices leave unbilled, under the same rate cards.
export function buildSeed(scale: Scale, { flatRates = false }: { flatRates?: boolean } = {}) {
  faker.seed(42);
  const tenantId = faker.string.uuid();
  const carriers = CARRIERS.map((name) => ({ id: faker.string.uuid(), tenantId, name, ...stamp(SEEDED_AT) }));

  // Two versions per carrier: three graduated bands that cost less per mile the longer the trip, a minimum, a fuel
  // surcharge and four accessorials. Version 2 raises every amount by 3 to 8 percent and keeps the fuel percentage.
  const cards = new Map(
    carriers.map((carrier): [string, Card] => {
      const accessorials = faker.helpers.arrayElements(ACCESSORIALS, 4);
      const near = faker.number.int({ min: 280, max: 420 });
      const mid = faker.number.int({ min: 200, max: near });
      const bands = [
        { fromMile: 0, centsPerMile: BigInt(near) },
        { fromMile: 250, centsPerMile: BigInt(mid) },
        { fromMile: 1_000, centsPerMile: BigInt(faker.number.int({ min: 150, max: mid })) },
      ];
      const minimumCents = BigInt(faker.number.int({ min: 15_000, max: 35_000 }));
      const fuelBp = BigInt(faker.number.int({ min: 1_800, max: 3_200 }));
      const rates = accessorials.map((code) => BigInt(faker.number.int(ACCESSORIAL_RATES[code])));
      const raise = BigInt(10_000 + faker.number.int({ min: 300, max: 800 }));
      const version = (number: number, from: string, to: string | null, at: (cents: bigint) => bigint): Version => ({
        id: faker.string.uuid(),
        version: number,
        from,
        to,
        effective: `[${from} 00:00:00+00,${to === null ? '' : `${to} 00:00:00+00`})`,
        rates: { bands: bands.map((band) => ({ ...band, centsPerMile: at(band.centsPerMile) })), minimumCents: at(minimumCents), fuelBp },
        accessorials: Object.fromEntries(accessorials.map((code, i) => [code, at(rates[i]!)])),
      });
      const versions = [version(1, '2025-01-01', GRI_DAY, (cents) => cents), version(2, GRI_DAY, null, (cents) => (cents * raise) / 10_000n)];
      return [carrier.id, { accessorials, versions }];
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
      miles: faker.number.int({ min: 25, max: 2_500 }),
      ...stamp(hoursAfter(shippedOn, faker.number.int({ min: 6, max: 30 }))),
    };
  });

  const invoices: (typeof t.invoices.$inferInsert)[] = [];
  const extractions: (typeof t.extractions.$inferInsert)[] = [];
  const lines: (typeof t.invoiceLines.$inferInsert)[] = [];
  const discrepancies: (typeof t.discrepancies.$inferInsert)[] = [];
  const keys: (typeof t.idempotencyKeys.$inferInsert)[] = [];
  const deadLetters: (typeof t.deadLetters.$inferInsert)[] = [];
  const truth: Truth[] = [];
  // The flat shape predates 0005, whose enum values reconciling and approved did not exist yet.
  const statuses = flatRates ? STATUSES.filter(({ value }) => value !== 'reconciling' && value !== 'approved') : STATUSES;
  const billed = faker.helpers.arrayElements(shipments, size.invoices);
  billed.forEach((shipment, i) => {
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

    const share = PLANTED[status];
    const { version, items, overcharges } = billShipment(cards.get(shipment.carrierId)!, shipment, 2, share !== undefined && faker.datatype.boolean(share));
    // needs_review: the model misread the PRO number's last digit, which matches no shipment, since PROs are 7,919 apart.
    const proNumber = status === 'needs_review' ? `${shipment.proNumber.slice(0, -1)}${(Number(shipment.proNumber.at(-1)) + 1) % 10}` : shipment.proNumber;
    const totalCents = items.reduce((sum, item) => sum + item.billed, 0n);
    // What a model reads from the document, in the extraction schema of packages/llm.
    const result = {
      first_page: 1,
      carrier: carriers.find((carrier) => carrier.id === shipment.carrierId)!.name,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      pro_number: proNumber,
      currency: 'USD',
      line_items: items.map((item, n) => ({ line_number: n + 1, description: CHARGE_CODES[item.code], charge_code: item.code, amount_cents: Number(item.billed) })),
      subtotal_cents: null,
      tax_cents: null,
      total_cents: Number(totalCents),
    };
    // The reading prints the carrier's name as it is, so it matches exactly; a misread PRO is what reconcile sent to review.
    const reviewReason = status === 'needs_review' ? 'no_shipment_match' : null;
    const extraction = { id: faker.string.uuid(), tenantId, invoiceId: invoice.id, model: 'seed', inputTokens: 0, outputTokens: 0, result, step: 'first_pass', carrierMatch: 'exact', reviewReason };
    extractions.push({ ...extraction, ...stamp(hoursAfter(createdAt, 1)) });
    invoices.push({
      ...invoice,
      carrierId: shipment.carrierId,
      invoiceNumber,
      proNumber,
      invoiceDate,
      currency: 'USD',
      totalCents,
      // Reconciliation matches the shipment.
      shipmentId: status === 'reconciled' || status === 'approved' ? shipment.id : null,
    });
    if (status !== 'needs_review') {
      const truthLines = items.map((item, n) => ({ lineNumber: n + 1, chargeCode: item.code, expectedCents: item.expected, billedCents: item.billed }));
      truth.push({ invoiceId: invoice.id, status, shippedOn: shipment.shippedOn, lines: truthLines, overcharges });
    }

    // Reconciliation writes the lines, with the version that priced them. The flat shape predates the extractions
    // table, so there extracted invoices keep their lines too.
    if (!(status === 'reconciled' || status === 'approved' || (flatRates && status === 'extracted'))) return;
    const invoiceLines = items.map((item, n) => ({
      id: faker.string.uuid(),
      tenantId,
      invoiceId: invoice.id,
      lineNumber: n + 1,
      description: CHARGE_CODES[item.code],
      chargeCode: item.code,
      amountCents: item.billed,
      rateCardVersionId: version.id,
      ...stamp(hoursAfter(createdAt, 2)),
    }));
    lines.push(...invoiceLines);
    if (status === 'extracted') return;
    // Findings stay open on reconciled invoices; approved ones carry the decision a reviewer made first.
    for (const found of overcharges) {
      const decision = status === 'approved' ? faker.helpers.arrayElement(['confirmed', 'dismissed'] as const) : 'open';
      const notes = { open: null, confirmed: 'Short-paid to the contract amount.', dismissed: 'Carrier showed a signed accessorial request.' };
      discrepancies.push({
        id: faker.string.uuid(),
        tenantId,
        invoiceId: invoice.id,
        invoiceLineId: invoiceLines[found.lineNumber - 1]!.id,
        shipmentId: shipment.id,
        type: found.type,
        status: decision,
        expectedCents: found.expectedCents,
        billedCents: found.billedCents,
        evidence: found.evidence,
        note: notes[decision],
        resolvedAt: decision === 'open' ? null : hoursAfter(createdAt, 48),
        ...stamp(hoursAfter(createdAt, 2)),
      });
    }
  });
  const billedIds = new Set(billed.map((shipment) => shipment.id));
  const unbilled = shipments.filter((shipment) => !billedIds.has(shipment.id));
  return { tenantId, carriers, cards, shipments, unbilled, invoices, extractions, lines, discrepancies, keys, deadLetters, truth };
}

const hasData = async (client: pg.Client) =>
  (await client.query<{ seeded: boolean }>('SELECT EXISTS (SELECT 1 FROM tenants) AS seeded')).rows[0]?.seeded === true;

// Writes buildSeed's data to an empty, migrated database in one transaction, and returns its counts and ground truth.
export async function seed(client: pg.Client, scale: Scale, { flatRates = false, log = logJson }: { flatRates?: boolean; log?: Log } = {}) {
  if (await hasData(client)) throw new Error('Database already has data; seed needs an empty, migrated database.');
  const started = Date.now();
  const data = buildSeed(scale, { flatRates });
  const { tenantId } = data;
  const latest = data.shipments.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));

  const db = drizzle(client);
  await client.query('BEGIN');
  try {
    await insert(db, t.tenants, [{ id: tenantId, name: 'Larkspur Outdoor Supply', ...stamp(SEEDED_AT) }]);
    await insert(db, t.carriers, data.carriers);
    if (flatRates) {
      // Before 0004, rate_cards still has carrier_id; the flat card holds today's accessorial rates.
      for (const [carrierId, card] of data.cards) {
        for (const [code, cents] of Object.entries(card.versions[1]!.accessorials)) {
          const values = [faker.string.uuid(), tenantId, carrierId, code, cents];
          await client.query('INSERT INTO rate_cards (id, tenant_id, carrier_id, charge_code, rate_cents) VALUES ($1, $2, $3, $4, $5)', values);
        }
      }
      // The 0001 columns: shipments without miles (0007), invoices without parent_invoice_id (0006), and lines without
      // the rate_card_version_id that 0002 adds and the backfill fills.
      const shipmentColumns = ['id', 'tenant_id', 'carrier_id', 'pro_number', 'reference', 'origin', 'destination', 'shipped_on', 'weight_lb', 'created_at', 'updated_at'];
      const shipmentRows = data.shipments.map((row) => [row.id, row.tenantId, row.carrierId, row.proNumber, row.reference, row.origin, row.destination, row.shippedOn, row.weightLb, row.createdAt, row.updatedAt]);
      await insertColumns(client, 'shipments', shipmentColumns, shipmentRows);
      const invoiceColumns = ['id', 'tenant_id', 'status', 'filename', 'content_sha256', 'carrier_id', 'shipment_id', 'invoice_number', 'pro_number', 'invoice_date', 'currency', 'total_cents', 'created_at', 'updated_at'];
      const invoiceRows = data.invoices.map((row) => [row.id, row.tenantId, row.status, row.filename, row.contentSha256, row.carrierId, row.shipmentId, row.invoiceNumber, row.proNumber, row.invoiceDate, row.currency, row.totalCents, row.createdAt, row.updatedAt]);
      await insertColumns(client, 'invoices', invoiceColumns, invoiceRows.map((values) => values.map((value) => value ?? null)));
      const lineColumns = ['id', 'tenant_id', 'invoice_id', 'line_number', 'description', 'charge_code', 'amount_cents', 'created_at', 'updated_at'];
      const lineRows = data.lines.map((line) => [line.id, line.tenantId, line.invoiceId, line.lineNumber, line.description, line.chargeCode, line.amountCents, line.createdAt, line.updatedAt]);
      await insertColumns(client, 'invoice_lines', lineColumns, lineRows);
    } else {
      const versions = [...data.cards].flatMap(([carrierId, card]) => card.versions.map((version) => ({ carrierId, version })));
      await insert(
        db,
        t.rateCardVersions,
        versions.map(({ carrierId, version: { id, version, effective, rates } }) => ({
          id,
          tenantId,
          carrierId,
          version,
          effective,
          minimumCents: rates.minimumCents,
          fuelBp: Number(rates.fuelBp),
          ...stamp(SEEDED_AT),
        })),
      );
      const bands = versions.flatMap(({ version }) => version.rates.bands.map((band) => ({ tenantId, rateCardVersionId: version.id, ...band, ...stamp(SEEDED_AT) })));
      await insert(db, t.rateCardBands, bands);
      const rates = versions.flatMap(({ version }) =>
        Object.entries(version.accessorials).map(([chargeCode, rateCents]) => ({
          id: faker.string.uuid(),
          tenantId,
          rateCardVersionId: version.id,
          chargeCode,
          rateCents,
          ...stamp(SEEDED_AT),
        })),
      );
      await insert(db, t.rateCards, rates);
      await insert(db, t.shipments, data.shipments);
      await insert(db, t.invoices, data.invoices);
      await insert(db, t.extractions, data.extractions);
      await insert(db, t.invoiceLines, data.lines);
    }
    await insert(db, t.discrepancies, data.discrepancies);
    await insert(db, t.idempotencyKeys, data.keys);
    await insert(db, t.deadLetters, data.deadLetters);
    await insert(db, t.tmsSyncState, [{ tenantId, cursor: latest.reference, lastSyncedAt: latest.createdAt, ...stamp(latest.createdAt) }]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  const counts = { shipments: data.shipments.length, invoices: data.invoices.length, lines: data.lines.length, discrepancies: data.discrepancies.length };
  log('seed complete', { scale, flatRates, ...counts, ms: Date.now() - started });
  return { ...counts, truth: data.truth };
}

if (import.meta.main) {
  // --if-empty (the demo's start-up step) leaves a seeded database as it is.
  const { values } = parseArgs({ options: { scale: { type: 'string', default: 'small' }, 'if-empty': { type: 'boolean', default: false } } });
  if (values.scale !== 'small' && values.scale !== 'large') throw new Error('--scale must be small or large');
  const { DATABASE_URL } = loadEnv(['DATABASE_URL']);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    if (values['if-empty'] && (await hasData(client))) logJson('seed skipped: the database already has data');
    else await seed(client, values.scale);
  } finally {
    await client.end();
  }
}
