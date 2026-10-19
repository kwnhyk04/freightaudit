import { carriers, deadLetters, discrepancies, extractions, invoiceLines, invoices, rateCardBands, rateCardVersions, shipments } from '@freightaudit/db';
import { seed, type Truth } from '@freightaudit/db/scripts/seed';
import { createTestDatabase } from '@freightaudit/db/testing';
import { replayDeadLetter } from '@freightaudit/pipeline';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { reconcile } from './reconcile.ts';
import { createTestEnv, waitFor } from './testing.ts';

// The small seed in one throwaway database; each test reconciles its own invoices, picked from the seed's ground truth.
let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let pool: pg.Pool | undefined;
let truth: Truth[] = [];
beforeAll(async () => {
  database = await createTestDatabase();
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    ({ truth } = await seed(client, 'small', { log: () => {} }));
  } finally {
    await client.end();
  }
  pool = new pg.Pool({ connectionString: database.url });
});
afterAll(async () => {
  await pool?.end();
  await database?.drop();
});

const db = () => drizzle(pool!);
const run = async (invoiceId: string) => {
  const [invoice] = await db().select({ tenantId: invoices.tenantId }).from(invoices).where(eq(invoices.id, invoiceId));
  return reconcile({ db: db() }, { data: { tenantId: invoice!.tenantId, invoiceId } });
};
// The seed's general rate increase: version 1 prices shipments before this day, version 2 from it on.
const INCREASE = '2026-01-01';
const KINDS = ['rate_mismatch', 'uncontracted_charge', 'duplicate_charge'] as const;
const taken = new Set<string>();
// The first invoice the seed left for the reconcile job that matches and no earlier test took.
function take(match: (invoice: Truth) => boolean) {
  const invoice = truth.find(
    (candidate) => (candidate.status === 'extracted' || candidate.status === 'reconciling') && !taken.has(candidate.invoiceId) && match(candidate),
  );
  if (!invoice) throw new Error('the small seed has no such pending invoice');
  taken.add(invoice.invoiceId);
  return invoice;
}
const clean = (invoice: Truth) => invoice.overcharges.length === 0;
const invoiceOf = async (id: string) => (await db().select().from(invoices).where(eq(invoices.id, id)))[0]!;
const findingsOf = (id: string, database: NodePgDatabase = db()) =>
  database
    .select({
      lineNumber: invoiceLines.lineNumber,
      type: discrepancies.type,
      status: discrepancies.status,
      expectedCents: discrepancies.expectedCents,
      billedCents: discrepancies.billedCents,
      evidence: discrepancies.evidence,
      shipmentId: discrepancies.shipmentId,
    })
    .from(discrepancies)
    .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
    .where(eq(discrepancies.invoiceId, id));
const countFindings = (id: string) => db().$count(discrepancies, eq(discrepancies.invoiceId, id));
// Saved lines, each with whether its version is the shipment carrier's version in force on the ship date.
const linesOf = (id: string) =>
  db()
    .select({
      lineNumber: invoiceLines.lineNumber,
      chargeCode: invoiceLines.chargeCode,
      amountCents: invoiceLines.amountCents,
      inForce: sql<boolean>`${rateCardVersions.carrierId} = ${shipments.carrierId}
        AND ${rateCardVersions.effective} @> (${shipments.shippedOn}::timestamp AT TIME ZONE 'UTC')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(shipments, eq(shipments.id, invoices.shipmentId))
    .innerJoin(rateCardVersions, eq(rateCardVersions.id, invoiceLines.rateCardVersionId))
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.lineNumber));
const billedLines = (invoice: Truth) =>
  invoice.lines.map(({ lineNumber, chargeCode, billedCents }) => ({ lineNumber, chargeCode, amountCents: billedCents, inForce: true }));

// Starts two runs while another session holds the row lock `lock` takes, and lets go once both wait on a lock, so the
// runs overlap at the point the locks under test must order.
async function overlapped<T>(lock: string, params: unknown[], start: () => Promise<T>[]) {
  const holder = await pool!.connect();
  await holder.query('BEGIN');
  await holder.query(lock, params);
  const runs = Promise.all(start());
  try {
    // Polled outside the holder's transaction: a transaction sees one snapshot of pg_stat_activity throughout.
    const waiting = "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";
    await waitFor(async () => (await pool!.query<{ n: number }>(waiting)).rows[0]!.n >= 2);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  return runs;
}

test.each(KINDS)('a seeded invoice with one planted %s reconciles to exactly that discrepancy', async (kind) => {
  const planted = take((candidate) => candidate.overcharges.length === 1 && candidate.overcharges[0]!.type === kind);
  expect(await run(planted.invoiceId)).toEqual({ invoiceId: planted.invoiceId, status: 'reconciled', discrepancies: 1 });
  const invoice = await invoiceOf(planted.invoiceId);
  expect(invoice).toMatchObject({ status: 'reconciled', shipmentId: expect.any(String) });
  const { lineNumber, type, expectedCents, billedCents, evidence } = planted.overcharges[0]!;
  expect(await findingsOf(planted.invoiceId)).toEqual([{ lineNumber, type, status: 'open', expectedCents, billedCents, evidence, shipmentId: invoice.shipmentId }]);
  expect(await linesOf(planted.invoiceId)).toEqual(billedLines(planted));
});

test.each(['before', 'after'] as const)('a clean seeded invoice shipped %s the rate increase reconciles with no discrepancies', async (side) => {
  const invoice = take((candidate) => clean(candidate) && (candidate.shippedOn < INCREASE) === (side === 'before'));
  expect(await run(invoice.invoiceId)).toEqual({ invoiceId: invoice.invoiceId, status: 'reconciled', discrepancies: 0 });
  expect((await invoiceOf(invoice.invoiceId)).status).toBe('reconciled');
  expect(await countFindings(invoice.invoiceId)).toBe(0);
  expect(await linesOf(invoice.invoiceId)).toEqual(billedLines(invoice));
});

test('running reconcile twice creates no duplicate discrepancies', async () => {
  const planted = take((candidate) => candidate.overcharges.length === 1);
  const { invoiceId } = planted;
  const { carrierId, proNumber } = await invoiceOf(invoiceId);
  // Two runs at once, as when a stalled job is recovered while its first run still works, then one more. The held
  // shipment keeps the first run inside its transaction until the second waits on the invoice lock.
  const shipmentLock = 'SELECT 1 FROM shipments WHERE carrier_id = $1 AND pro_number = $2 FOR UPDATE';
  const runs = await overlapped(shipmentLock, [carrierId, proNumber], () => [run(invoiceId), run(invoiceId)]);
  expect(runs).toEqual(expect.arrayContaining([{ invoiceId, status: 'reconciled', discrepancies: 1 }, { invoiceId, skipped: 'reconciled' }]));
  expect(await run(invoiceId)).toEqual({ invoiceId, skipped: 'reconciled' });
  expect(await countFindings(invoiceId)).toBe(1);
  expect(await db().$count(invoiceLines, eq(invoiceLines.invoiceId, invoiceId))).toBe(planted.lines.length);
});

const reviewReasonOf = async (id: string) => (await db().select({ reason: extractions.reviewReason }).from(extractions).where(eq(extractions.invoiceId, id)))[0]?.reason;

test('an invoice whose PRO number matches no shipment goes to needs_review with its reason and nothing else written', async () => {
  const misread = take(clean);
  await db().update(invoices).set({ proNumber: '0000000000' }).where(eq(invoices.id, misread.invoiceId));
  expect(await run(misread.invoiceId)).toEqual({ invoiceId: misread.invoiceId, status: 'needs_review', reason: 'no_shipment_match' });
  expect(await invoiceOf(misread.invoiceId)).toMatchObject({ status: 'needs_review', shipmentId: null });
  expect(await db().$count(invoiceLines, eq(invoiceLines.invoiceId, misread.invoiceId))).toBe(0);
  expect(await reviewReasonOf(misread.invoiceId)).toBe('no_shipment_match');
});

test.each([
  ['CAD', 'unsupported_currency: CAD'],
  [null, 'missing_currency'],
])('an invoice in currency %s is never priced: it goes to needs_review with the reason', async (currency, reason) => {
  const invoice = take(clean);
  await db().update(invoices).set({ currency }).where(eq(invoices.id, invoice.invoiceId));
  expect(await run(invoice.invoiceId)).toEqual({ invoiceId: invoice.invoiceId, status: 'needs_review', reason });
  expect(await invoiceOf(invoice.invoiceId)).toMatchObject({ status: 'needs_review', shipmentId: null });
  expect(await db().$count(invoiceLines, eq(invoiceLines.invoiceId, invoice.invoiceId))).toBe(0);
  expect(await countFindings(invoice.invoiceId)).toBe(0);
  expect(await reviewReasonOf(invoice.invoiceId)).toBe(reason);
});

test('of two invoices billing one charge for a shipment, reconciled at once, the second carries the duplicate', async () => {
  // A clean seeded invoice, and a second one for its shipment that bills its linehaul again.
  const first = take(clean);
  const { tenantId, carrierId, proNumber } = await invoiceOf(first.invoiceId);
  const amount = Number(first.lines[0]!.billedCents);
  const [second] = await db()
    .insert(invoices)
    .values({ tenantId, status: 'extracted', filename: 'again.pdf', contentSha256: randomBytes(32).toString('hex'), carrierId, proNumber, currency: 'USD' })
    .returning();
  const line_items = [{ line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: amount }];
  await db().insert(extractions).values({ tenantId, invoiceId: second!.id, model: 'test', inputTokens: 0, outputTokens: 0, result: { line_items } });

  // The held versions stop the first run at its line insert, after it read the lines billed so far; without the
  // shipment lock the second run would read them too, before the first commits, and miss the duplicate.
  const ids = [first.invoiceId, second!.id];
  await overlapped('SELECT 1 FROM rate_card_versions WHERE carrier_id = $1 FOR UPDATE', [carrierId], () => ids.map(run));
  const { shipmentId } = await invoiceOf(second!.id);
  const found = (await Promise.all(ids.map((id) => findingsOf(id)))).flat();
  expect(found).toEqual([
    { lineNumber: 1, type: 'duplicate_charge', status: 'open', expectedCents: 0n, billedCents: BigInt(amount), evidence: 'LINEHAUL is billed twice.', shipmentId },
  ]);
});

test('an invoice the carrier also billed under its number in another file gets one possible-duplicate finding, naming the earliest', async () => {
  const invoice = take(clean);
  const { tenantId, carrierId, invoiceNumber } = await invoiceOf(invoice.invoiceId);
  const [elsewhere] = await db().select({ id: carriers.id }).from(carriers).where(and(eq(carriers.tenantId, tenantId), ne(carriers.id, carrierId!))).limit(1);
  const other = (filename: string, status: 'approved' | 'rejected', at: string, carrier = carrierId) =>
    db().insert(invoices).values({ tenantId, status, filename, contentSha256: randomBytes(32).toString('hex'), carrierId: carrier, invoiceNumber, createdAt: new Date(at), updatedAt: new Date(at) });
  // Rejected, an invoice is no duplicate; under another carrier the number is someone else's.
  await other('bad-scan.pdf', 'rejected', '2026-09-01T10:00:00Z');
  await other('another-carrier.pdf', 'approved', '2026-09-02T10:00:00Z', elsewhere!.id);
  // 23:30 UTC is already the next day in Taipei; the finding gives the UTC day.
  await other('first-scan.pdf', 'approved', '2026-09-03T23:30:00Z');
  await other('second-scan.pdf', 'approved', '2026-09-04T10:00:00Z');
  expect(await run(invoice.invoiceId)).toMatchObject({ status: 'reconciled', discrepancies: 1 });
  const { shipmentId } = await invoiceOf(invoice.invoiceId);
  const saved = await db()
    .select({ type: discrepancies.type, status: discrepancies.status, invoiceLineId: discrepancies.invoiceLineId, expectedCents: discrepancies.expectedCents, billedCents: discrepancies.billedCents, evidence: discrepancies.evidence, shipmentId: discrepancies.shipmentId })
    .from(discrepancies)
    .where(eq(discrepancies.invoiceId, invoice.invoiceId));
  expect(saved).toEqual([
    {
      type: 'duplicate_invoice',
      status: 'open',
      invoiceLineId: null,
      expectedCents: 0n,
      billedCents: 0n,
      evidence: `Possible duplicate: invoice ${invoiceNumber} from this carrier was also received on 2026-09-03 as first-scan.pdf.`,
      shipmentId,
    },
  ]);
});

// Through the worker, each in a database of its own: data the job cannot price dead-letters it, the invoice ends failed
// with the reason on its dead letter (the api's failure_reason), and a replay after the fix reconciles it.
describe('unpriceable data', () => {
  let env: Awaited<ReturnType<typeof createTestEnv>> | undefined;
  afterEach(async () => {
    await env?.close();
    env = undefined;
  });

  // An extracted invoice billing a 500-mile linehaul at 131,250 cents (the contract gives 125,000, at 250 a mile) and
  // fuel at 25,000 (20 %), for a carrier with one version from 2025-01-01, and its reconcile job once dead-lettered.
  async function deadLettered({ shippedOn = '2026-03-02', miles = 500, terms = true }: { shippedOn?: string; miles?: number | null; terms?: boolean }) {
    const current = (env = await createTestEnv());
    const { db: database, tenantId, queues } = current;
    const [carrier] = await database.select({ id: carriers.id }).from(carriers).where(eq(carriers.tenantId, tenantId));
    const carrierId = carrier!.id;
    const contract = terms ? { minimumCents: 50_000n, fuelBp: 2_000 } : {};
    const [version] = await database
      .insert(rateCardVersions)
      .values({ tenantId, carrierId, version: 1, effective: '[2025-01-01 00:00:00+00,)', ...contract })
      .returning();
    if (terms) await database.insert(rateCardBands).values({ tenantId, rateCardVersionId: version!.id, fromMile: 0, centsPerMile: 250n });
    const proNumber = '1000000000';
    await database.insert(shipments).values({ tenantId, carrierId, proNumber, reference: 'SHP-000001', origin: 'Reno, NV', destination: 'Boise, ID', shippedOn, miles });
    const contentSha256 = randomBytes(32).toString('hex');
    const [invoice] = await database.insert(invoices).values({ tenantId, status: 'extracted', filename: 'invoice.pdf', contentSha256, carrierId, proNumber, currency: 'USD' }).returning();
    const line_items = [
      { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 131_250 },
      { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 25_000 },
    ];
    await database.insert(extractions).values({ tenantId, invoiceId: invoice!.id, model: 'test', inputTokens: 0, outputTokens: 0, result: { line_items } });
    current.runWorkers();
    await queues.queue('reconcile').add('reconcile', { tenantId, invoiceId: invoice!.id }, { jobId: contentSha256 });
    // The dead-letter copy is written last, so once it exists the move has finished.
    await waitFor(() => queues.dlq('reconcile').getJob(contentSha256));
    const [dead] = await database.select().from(deadLetters).where(eq(deadLetters.jobId, contentSha256));
    return { ...current, invoice: invoice!, dead: dead! };
  }
  const statusOf = async (database: NodePgDatabase, id: string) =>
    (await database.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0]?.status;

  test.each([
    ['no rate card version in force on the ship date', { shippedOn: '2024-06-01' }, 'no rate card version in force on 2024-06-01'],
    ['a rate card version without linehaul terms', { terms: false }, 'rate card version 1 has no linehaul terms'],
    ['a shipment without miles', { miles: null }, 'shipment has no miles'],
  ])('with %s, the job is dead-lettered and the invoice ends failed with the reason', async (_, data, reason) => {
    const { db: database, invoice, dead } = await deadLettered(data);
    expect(await statusOf(database, invoice.id)).toBe('failed');
    // Permanent: one attempt and no retries.
    expect(dead).toMatchObject({ queue: 'reconcile', attempts: 1, error: reason, replayedAt: null, payload: { invoiceId: invoice.id } });
    expect(await database.$count(invoiceLines, eq(invoiceLines.invoiceId, invoice.id))).toBe(0);
  });

  test('a replay once the data is fixed reconciles the invoice', async () => {
    const { db: database, queues, tenantId, invoice, dead } = await deadLettered({ miles: null });
    // The TMS sends the miles, then someone replays the dead letter.
    await database.update(shipments).set({ miles: 500 }).where(eq(shipments.tenantId, tenantId));
    expect(await replayDeadLetter({ db: database, queues }, tenantId, dead.id)).toEqual({ id: dead.id, jobId: invoice.contentSha256 });
    await waitFor(async () => (await queues.queue('reconcile').getJobState(invoice.contentSha256)) === 'completed');
    expect(await statusOf(database, invoice.id)).toBe('reconciled');
    const evidence = 'Rate card version 1 sets LINEHAUL at $1,250.00; billed $1,312.50.';
    expect(await findingsOf(invoice.id, database)).toEqual([
      { lineNumber: 1, type: 'rate_mismatch', status: 'open', expectedCents: 125_000n, billedCents: 131_250n, evidence, shipmentId: expect.any(String) },
    ]);
    // The dead letter is closed, so the invoice shows no failure reason, and its queue copy is gone.
    expect((await database.select().from(deadLetters).where(eq(deadLetters.id, dead.id)))[0]?.replayedAt).toBeInstanceOf(Date);
    expect(await queues.dlq('reconcile').getJob(invoice.contentSha256)).toBeUndefined();
  });
});
