import { auditEvents, carriers, discrepancies, idempotencyKeys, invoices } from '@freightaudit/db';
import { seed } from '@freightaudit/db/scripts/seed';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createMemoryStorage, createQueues, type Queues } from '@freightaudit/pipeline';
import { serverOptions } from '@freightaudit/telemetry';
import { and, asc, eq, like, ne } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from './app.ts';
import { CHANGED } from './review.ts';
import { apiKey } from './testing.ts';

// decideInvoice and approvals on their own database, since one test adds a trigger that makes approvals fail.
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let pool: pg.Pool;
let db: NodePgDatabase;
let redis: Redis;
let queues: Queues;
let app: ReturnType<typeof buildApp>;
// Reconciled invoices whose seeded findings are all open; each test takes its own.
const fresh: string[] = [];
// Needs-review invoices whose reading saved a carrier and a number that no other invoice of the carrier has; each test
// takes its own.
const reviewed: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  const seeder = new pg.Client({ connectionString: database.url });
  await seeder.connect();
  await seed(seeder, 'small', { log: () => {} });
  await seeder.end();
  pool = new pg.Pool({ connectionString: database.url });
  db = drizzle(pool);
  const tenantId: string = (await pool.query('SELECT id FROM tenants')).rows[0].id;
  redis = new Redis(testEnv('REDIS_URL'), { maxRetriesPerRequest: 1 });
  queues = createQueues(redis, `test-${randomBytes(4).toString('hex')}`);
  // The file sends more than the default 60 requests a minute on its one key.
  const rateLimits = { general: 1_000, upload: 1_000 };
  app = buildApp(serverOptions('silent'), { apiKeys: [apiKey], storage: createMemoryStorage(), graphql: { db, queues, tenantId }, rateLimits });
  const { rows } = await pool.query(
    "SELECT d.invoice_id FROM discrepancies d JOIN invoices i ON i.id = d.invoice_id WHERE i.status = 'reconciled' GROUP BY d.invoice_id HAVING bool_and(d.status = 'open') ORDER BY d.invoice_id",
  );
  fresh.push(...rows.map((row) => row.invoice_id as string));
  const { rows: needs } = await pool.query(
    `SELECT i.id FROM invoices i WHERE i.status = 'needs_review' AND i.carrier_id IS NOT NULL AND i.invoice_number IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM invoices o WHERE o.carrier_id = i.carrier_id AND o.invoice_number = i.invoice_number AND o.id <> i.id) ORDER BY i.id`,
  );
  reviewed.push(...needs.map((row) => row.id as string));
});
afterAll(async () => {
  await app.close();
  await queues.close();
  await redis.quit();
  await pool.end();
  await database.drop();
});

type Data = Record<string, { status: string; openDiscrepancyCount?: number }>;
type Result<T = Data> = { data?: T | null; errors?: { message: string; extensions?: { code?: string } }[] };
async function gql<T = Data>(query: string, variables: Record<string, unknown> = {}): Promise<Result<T>> {
  const response = await app.inject({ method: 'POST', url: '/graphql', headers: { 'x-api-key': apiKey, 'x-actor': 'reviewer' }, payload: { query, variables } });
  return response.json();
}
const DECIDE = `mutation ($id: ID!, $decision: InvoiceDecision!, $seen: [SeenDiscrepancy!]!, $requestId: ID!) {
  decideInvoice(id: $id, decision: $decision, seen: $seen, requestId: $requestId) { status openDiscrepancyCount } }`;
type Seen = { id: string; version: string }[];
const decideInvoice = (id: string, decision: string, seen: Seen, requestId: string = randomUUID()) => gql(DECIDE, { id, decision, seen, requestId });
const resolve = (id: string, decision: 'CONFIRM' | 'DISMISS') => gql(`mutation ($id: ID!) { resolveDiscrepancy(id: $id, decision: ${decision}) { status } }`, { id });
const approveInvoice = (id: string) => gql('mutation ($id: ID!) { approveInvoice(id: $id) { status } }', { id });
const rejectInvoice = (id: string, reason: string) => gql('mutation ($id: ID!, $reason: String!) { rejectInvoice(id: $id, reason: $reason) { status } }', { id, reason });
// Findings waiting for a decision, as the review queue counts them.
const queued = async () => (await gql<{ invoiceSummary: { openFindings: number } }>('{ invoiceSummary { openFindings } }')).data!.invoiceSummary.openFindings;
// The invoice's findings with their versions, as a page shows them.
async function seenOf(id: string): Promise<Seen> {
  const { rows } = await pool.query(
    `SELECT id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version FROM discrepancies WHERE invoice_id = $1 ORDER BY id`,
    [id],
  );
  return rows;
}
// A second open finding on the invoice, so a decision covers more than one.
const addFinding = async (id: string) =>
  (
    await pool.query(
      "INSERT INTO discrepancies (tenant_id, invoice_id, shipment_id, type, expected_cents, billed_cents, evidence) SELECT tenant_id, id, shipment_id, 'uncontracted_charge', 0, 4200, 'test charge' FROM invoices WHERE id = $1 RETURNING id",
      [id],
    )
  ).rows[0].id as string;
// A possible duplicate of the whole invoice, as reconcile writes one.
const addDuplicate = async (id: string) =>
  (
    await pool.query(
      "INSERT INTO discrepancies (tenant_id, invoice_id, shipment_id, type, expected_cents, billed_cents, evidence) SELECT tenant_id, id, shipment_id, 'duplicate_invoice', 0, 0, 'Possible duplicate.' FROM invoices WHERE id = $1 RETURNING id",
      [id],
    )
  ).rows[0].id as string;
const findingsOf = (id: string) => db.select().from(discrepancies).where(eq(discrepancies.invoiceId, id)).orderBy(asc(discrepancies.id));
const invoiceOf = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
// Another file with the invoice's number, from its carrier unless another is given, as an earlier upload left it.
async function billedBefore(id: string, filename: string, status: 'approved' | 'rejected', at: string, carrierId?: string) {
  const invoice = await invoiceOf(id);
  const contentSha256 = randomBytes(32).toString('hex');
  const when = new Date(at);
  await db.insert(invoices).values({ tenantId: invoice.tenantId, status, filename, contentSha256, carrierId: carrierId ?? invoice.carrierId, invoiceNumber: invoice.invoiceNumber, createdAt: when, updatedAt: when });
}
const auditOf = (id: string) => db.select().from(auditEvents).where(eq(auditEvents.invoiceId, id)).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
const statusOf = async (id: string) => (await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0]!.status;
// Decision keys only: the seed gives most invoices an upload key too.
const keysOf = (id: string) => db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.invoiceId, id), like(idempotencyKeys.key, 'decide:%')));
// An audit row without what differs from one action to the next (its id, invoice, finding and time).
const shape = (row: typeof auditEvents.$inferSelect) => ({
  tenantId: row.tenantId,
  deadLetterId: row.deadLetterId,
  actor: row.actor,
  action: row.action,
  changes: row.changes,
  reason: row.reason,
});

test('while a possible duplicate is open, no bulk decision and no approval goes through; decided on its own, the rest can be', async () => {
  const id = fresh.shift()!;
  const duplicate = await addDuplicate(id);
  for (const decision of ['APPROVE_AS_BILLED', 'APPROVE_AT_RATE_CARD', 'DISPUTE']) {
    const refused = (await decideInvoice(id, decision, await seenOf(id))).errors?.[0];
    expect([decision, refused?.message, refused?.extensions?.code]).toEqual([decision, 'this invoice may duplicate another one; decide that finding on its own first', 'CONFLICT']);
  }
  expect((await approveInvoice(id)).errors?.[0]?.extensions?.code).toBe('CONFLICT');
  expect([await statusOf(id), (await findingsOf(id)).every((finding) => finding.status === 'open'), await keysOf(id)]).toEqual(['reconciled', true, []]);
  // Not a duplicate after all: dismissed on its own, the other findings take a bulk decision again.
  expect((await resolve(duplicate, 'DISMISS')).data!.resolveDiscrepancy).toEqual({ status: 'DISMISSED' });
  expect((await decideInvoice(id, 'APPROVE_AT_RATE_CARD', await seenOf(id))).data!.decideInvoice).toEqual({ status: 'APPROVED', openDiscrepancyCount: 0 });
});

test('a confirmed duplicate is never approved, by a bulk decision or on its own; dismissed after all, it is approved', async () => {
  const id = fresh.shift()!;
  const duplicate = await addDuplicate(id);
  expect((await resolve(duplicate, 'CONFIRM')).data!.resolveDiscrepancy).toEqual({ status: 'CONFIRMED' });
  const confirmed = 'this invoice was confirmed as a duplicate of another one; reject it instead';
  for (const decision of ['APPROVE_AS_BILLED', 'APPROVE_AT_RATE_CARD', 'DISPUTE']) {
    const refused = (await decideInvoice(id, decision, await seenOf(id))).errors?.[0];
    expect([decision, refused?.message, refused?.extensions?.code]).toEqual([decision, confirmed, 'CONFLICT']);
  }
  // With every charge decided one by one, nothing is open, and the approval is still refused.
  for (const finding of await findingsOf(id)) if (finding.status === 'open') await resolve(finding.id, 'DISMISS');
  const approval = (await approveInvoice(id)).errors?.[0];
  expect([approval?.message, approval?.extensions?.code]).toEqual([confirmed, 'CONFLICT']);
  expect([await statusOf(id), await keysOf(id)]).toEqual(['reconciled', []]);
  // Not a duplicate after all.
  await resolve(duplicate, 'DISMISS');
  expect((await approveInvoice(id)).data!.approveInvoice).toEqual({ status: 'APPROVED' });
});

test('a checked invoice says what holds it, and one with a confirmed duplicate is held, never ready to approve, until rejected', async () => {
  const id = fresh.shift()!;
  const [{ number }] = (await pool.query('SELECT invoice_number AS number FROM invoices WHERE id = $1', [id])).rows;
  const holdOf = async () => (await gql<{ invoice: { hold: string | null } }>('query ($id: ID!) { invoice(id: $id) { hold } }', { id })).data!.invoice.hold;
  // Which list the invoice is in: held (hasOpenFindings true, the Billing issues tab) or not (Ready to approve).
  const lists = async () => {
    const one = (held: boolean) =>
      gql<{ invoices: { edges: { node: { id: string } }[] } }>('query ($held: Boolean, $q: String) { invoices(status: RECONCILED, hasOpenFindings: $held, search: $q) { edges { node { id } } } }', {
        held,
        q: number,
      });
    const [held, ready] = await Promise.all([one(true), one(false)]);
    return [held, ready].map((result) => result.data!.invoices.edges.some(({ node }) => node.id === id));
  };
  expect([await holdOf(), await lists()]).toEqual(['OPEN_FINDINGS', [true, false]]);
  const duplicate = await addDuplicate(id);
  expect(await holdOf()).toBe('POSSIBLE_DUPLICATE');
  // Confirmed, with every charge decided, nothing is open, and still it waits to be rejected.
  await resolve(duplicate, 'CONFIRM');
  for (const finding of await findingsOf(id)) if (finding.status === 'open') await resolve(finding.id, 'DISMISS');
  expect([await holdOf(), await lists()]).toEqual(['CONFIRMED_DUPLICATE', [true, false]]);
  await rejectInvoice(id, 'Same invoice as first-scan.pdf');
  expect([await holdOf(), await lists()]).toEqual([null, [false, false]]);
});

test('approved as billed from review, an invoice its carrier billed before under its number is not approved but held with the possible duplicate, and the answer says so', async () => {
  const id = reviewed.shift()!;
  await billedBefore(id, 'first-scan.pdf', 'approved', '2026-10-01T10:00:00Z');
  const { carrierId, invoiceNumber } = await invoiceOf(id);
  const held = await gql<{ approveInvoice: unknown }>('mutation ($id: ID!) { approveInvoice(id: $id) { status hold shipment { id } discrepancies { edges { node { type status evidence } } } } }', { id });
  const evidence = `Possible duplicate: invoice ${invoiceNumber} from this carrier was also received on 2026-10-01 as first-scan.pdf.`;
  expect(held.data!.approveInvoice).toEqual({ status: 'RECONCILED', hold: 'POSSIBLE_DUPLICATE', shipment: null, discrepancies: { edges: [{ node: { type: 'DUPLICATE_INVOICE', status: 'OPEN', evidence } }] } });
  // The finding as reconcile writes one, with no line, shipment or money, and the move in the trail as the reviewer's.
  expect((await findingsOf(id)).map(({ type, invoiceLineId, shipmentId, expectedCents, billedCents }) => ({ type, invoiceLineId, shipmentId, expectedCents, billedCents }))).toEqual([
    { type: 'duplicate_invoice', invoiceLineId: null, shipmentId: null, expectedCents: 0n, billedCents: 0n },
  ]);
  expect((await auditOf(id)).map((row) => [row.actor, row.action, row.changes, row.reason])).toEqual([
    ['reviewer', 'status', [{ field: 'status', from: 'needs_review', to: 'reconciled' }], 'not approved: another invoice from this carrier has the same number'],
  ]);
  // Then decided as usual: no approval while it is open; not a duplicate, approved.
  expect((await approveInvoice(id)).errors?.[0]?.extensions?.code).toBe('CONFLICT');
  await resolve((await findingsOf(id))[0]!.id, 'DISMISS');
  expect((await approveInvoice(id)).data!.approveInvoice).toEqual({ status: 'APPROVED' });
  // Another one under the number: confirmed, it is never approved, and rejected.
  const again = reviewed.shift()!;
  await db.update(invoices).set({ carrierId, invoiceNumber }).where(eq(invoices.id, again));
  expect((await approveInvoice(again)).data!.approveInvoice).toEqual({ status: 'RECONCILED' });
  await resolve((await findingsOf(again))[0]!.id, 'CONFIRM');
  expect((await approveInvoice(again)).errors?.[0]?.message).toBe('this invoice was confirmed as a duplicate of another one; reject it instead');
  expect((await rejectInvoice(again, 'Same invoice as first-scan.pdf')).data!.rejectInvoice).toEqual({ status: 'REJECTED' });
});

const CORRECT = `mutation ($id: ID!, $carrierId: ID, $pro: String, $number: String) {
  correctInvoice(id: $id, carrierId: $carrierId, proNumber: $pro, number: $number) { status number hold discrepancies { edges { node { type status evidence } } } } }`;
const correct = (id: string, read: { carrierId?: string; pro?: string; number?: string }) => gql<{ correctInvoice: unknown }>(CORRECT, { id, ...read });
// Held at its approval from review: an earlier invoice of its carrier under its number, then Approve as billed.
async function held(id: string) {
  await billedBefore(id, 'first-scan.pdf', 'approved', '2026-10-01T10:00:00Z');
  expect((await approveInvoice(id)).data!.approveInvoice).toEqual({ status: 'RECONCILED' });
}
const carrierName = async (carrierId: string) => (await db.select({ name: carriers.name }).from(carriers).where(eq(carriers.id, carrierId)))[0]!.name;

test('a held invoice whose corrected number matches no other invoice has its possible duplicate closed, saying why, and waits for approval as billed', async () => {
  const id = reviewed.shift()!;
  await held(id);
  const { invoiceNumber, contentSha256 } = await invoiceOf(id);
  const [finding] = await findingsOf(id);
  const number = `${invoiceNumber}9`;
  expect((await correct(id, { number })).data!.correctInvoice).toEqual({
    status: 'RECONCILED',
    number,
    hold: null,
    discrepancies: { edges: [{ node: { type: 'DUPLICATE_INVOICE', status: 'CLOSED', evidence: finding!.evidence } }] },
  });
  expect((await auditOf(id)).slice(1).map((row) => [row.actor, row.action, row.changes, row.reason, row.discrepancyId])).toEqual([
    ['reviewer', 'corrected', [{ field: 'invoiceNumber', from: invoiceNumber, to: number }], null, null],
    ['reviewer', 'discrepancy_closed', [{ field: 'status', from: 'open', to: 'closed' }], 'the corrected reading matches no other invoice', finding!.id],
  ]);
  // Nothing goes back to matching: it waits for Approve as billed.
  expect(await queues.queue('reconcile').getJob(contentSha256)).toBeUndefined();
  expect((await approveInvoice(id)).data!.approveInvoice).toEqual({ status: 'APPROVED' });
});

test('a held invoice whose corrected carrier has another invoice under the number stays held, its finding naming that one', async () => {
  const id = reviewed.shift()!;
  const { carrierId, invoiceNumber } = await invoiceOf(id);
  const [other] = await db.select({ id: carriers.id, name: carriers.name }).from(carriers).where(ne(carriers.id, carrierId!)).limit(1);
  await billedBefore(id, 'other-carrier.pdf', 'approved', '2026-10-02T10:00:00Z', other!.id);
  await held(id);
  const evidence = `Possible duplicate: invoice ${invoiceNumber} from this carrier was also received on 2026-10-02 as other-carrier.pdf.`;
  expect((await correct(id, { carrierId: other!.id })).data!.correctInvoice).toEqual({
    status: 'RECONCILED',
    number: invoiceNumber,
    hold: 'POSSIBLE_DUPLICATE',
    discrepancies: { edges: [{ node: { type: 'DUPLICATE_INVOICE', status: 'OPEN', evidence } }] },
  });
  expect((await auditOf(id)).slice(1).map((row) => [row.action, row.changes])).toEqual([['corrected', [{ field: 'carrier', from: await carrierName(carrierId!), to: other!.name }]]]);
});

test('a held invoice takes a corrected reading only while its possible duplicate is open, never a PRO number, and only it takes an invoice number', async () => {
  const id = reviewed.shift()!;
  await held(id);
  const refused = async (target: string, read: Parameters<typeof correct>[1]) => (await correct(target, read)).errors?.[0];
  expect(await refused(id, { pro: '1234567' })).toMatchObject({
    message: 'a held invoice is not matched to a shipment again, so its PRO number stays as read',
    extensions: { code: 'BAD_USER_INPUT' },
  });
  await resolve((await findingsOf(id))[0]!.id, 'DISMISS');
  expect((await refused(id, { number: '1' }))?.extensions?.code).toBe('CONFLICT');
  // A checked invoice was matched to its shipment, and one in review is matched again instead.
  expect((await refused(fresh.shift()!, { number: '1' }))?.extensions?.code).toBe('CONFLICT');
  expect((await refused(reviewed.shift()!, { number: '1' }))?.extensions?.code).toBe('BAD_USER_INPUT');
  expect((await invoiceOf(id)).invoiceNumber).not.toBe('1');
});

test("approved as billed from review with no such invoice, it is approved as before: a rejected one or another carrier's is none, and a reading without a carrier or a number has nothing to compare", async () => {
  const id = reviewed.shift()!;
  const [other] = await db.select({ id: carriers.id }).from(carriers).where(ne(carriers.id, (await invoiceOf(id)).carrierId!)).limit(1);
  await billedBefore(id, 'bad-scan.pdf', 'rejected', '2026-10-01T10:00:00Z');
  await billedBefore(id, 'another-carrier.pdf', 'approved', '2026-10-02T10:00:00Z', other!.id);
  // An invalid reading saves neither.
  const unread = reviewed.shift()!;
  await db.update(invoices).set({ carrierId: null, invoiceNumber: null }).where(eq(invoices.id, unread));
  for (const each of [id, unread]) {
    expect((await approveInvoice(each)).data!.approveInvoice).toEqual({ status: 'APPROVED' });
    expect(await findingsOf(each)).toEqual([]);
    expect((await auditOf(each)).map((row) => [row.actor, row.action, row.changes, row.reason])).toEqual([['reviewer', 'approved', [{ field: 'status', from: 'needs_review', to: 'approved' }], null]]);
  }
});

test('each decision and closing in the trail names its discrepancy; every other entry names none', async () => {
  const id = fresh.shift()!;
  await addFinding(id);
  const [decided, ...closed] = await findingsOf(id);
  await resolve(decided!.id, 'CONFIRM');
  await resolve(decided!.id, 'DISMISS');
  await rejectInvoice(id, 'Billed to the wrong customer');
  const trail = (await gql<{ invoice: { auditTrail: { action: string; discrepancyId: string | null }[] } }>('query ($id: ID!) { invoice(id: $id) { auditTrail { action discrepancyId } } }', { id }))
    .data!.invoice.auditTrail;
  expect(trail.filter(({ action }) => action !== 'DISCREPANCY_CLOSED')).toEqual([
    { action: 'RECEIVED', discrepancyId: null },
    { action: 'DISCREPANCY_CONFIRMED', discrepancyId: decided!.id },
    { action: 'DISCREPANCY_DISMISSED', discrepancyId: decided!.id },
    { action: 'REJECTED', discrepancyId: null },
  ]);
  const closings = trail.filter(({ action }) => action === 'DISCREPANCY_CLOSED').map(({ discrepancyId }) => discrepancyId);
  expect(new Set(closings)).toEqual(new Set(closed.map((finding) => finding.id)));
  expect(closings).toHaveLength(closed.length);
});

test('a reconciled invoice is rejected with a reason; its open findings close with it, each audited, and leave the review queue', async () => {
  const id = fresh.shift()!;
  await addFinding(id);
  const [decided, ...open] = await findingsOf(id);
  await resolve(decided!.id, 'CONFIRM');
  const before = await queued();
  // The reason rules of a needs_review rejection.
  for (const reason of ['  ', 'x'.repeat(1001)]) expect((await rejectInvoice(id, reason)).errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  expect(await rejectInvoice(id, 'Billed again as invoice 4471')).toEqual({ data: { rejectInvoice: { status: 'REJECTED' } } });

  expect((await findingsOf(id)).map((finding) => [finding.id, finding.status, finding.resolvedAt !== null])).toEqual([
    [decided!.id, 'confirmed', true],
    ...open.map((finding) => [finding.id, 'closed', true]),
  ]);
  expect(await queued()).toBe(before - open.length);
  const rows = await auditOf(id);
  expect(rows.map((row) => row.action)).toEqual(['discrepancy_confirmed', ...open.map(() => 'discrepancy_closed'), 'rejected']);
  const closings = rows.filter((row) => row.action === 'discrepancy_closed');
  expect(new Set(closings.map((row) => row.discrepancyId))).toEqual(new Set(open.map((finding) => finding.id)));
  for (const row of closings) expect([row.actor, row.changes, row.reason]).toEqual(['reviewer', [{ field: 'status', from: 'open', to: 'closed' }], 'the invoice was rejected']);
  expect(shape(rows.at(-1)!)).toMatchObject({ actor: 'reviewer', changes: [{ field: 'status', from: 'reconciled', to: 'rejected' }], reason: 'Billed again as invoice 4471' });

  // The api names the closed findings and their entries in the trail.
  const read = await gql<{ invoice: { discrepancies: { edges: { node: { status: string } }[] }; auditTrail: { action: string; detail: string | null }[] } }>(
    'query ($id: ID!) { invoice(id: $id) { discrepancies { edges { node { status } } } auditTrail { action detail } } }',
    { id },
  );
  expect(read.data!.invoice.discrepancies.edges.map(({ node }) => node.status).sort()).toEqual(['CONFIRMED', ...open.map(() => 'CLOSED')].sort());
  expect(read.data!.invoice.auditTrail.filter((entry) => entry.action === 'DISCREPANCY_CLOSED')).toEqual(open.map(() => ({ action: 'DISCREPANCY_CLOSED', detail: 'the invoice was rejected' })));
  // Final, and a closed finding takes no decision.
  expect((await rejectInvoice(id, 'again')).errors?.[0]?.extensions?.code).toBe('CONFLICT');
  expect((await resolve(open[0]!.id, 'DISMISS')).errors?.[0]?.extensions?.code).toBe('CONFLICT');
});

test('approve at rate card disputes every open finding and approves, writing the audit rows a manual decision writes', async () => {
  const [id, manual] = [fresh.shift()!, fresh.shift()!];
  await addFinding(id);
  const result = await decideInvoice(id, 'APPROVE_AT_RATE_CARD', await seenOf(id));
  expect(result.data!.decideInvoice).toEqual({ status: 'APPROVED', openDiscrepancyCount: 0 });
  const findings = await findingsOf(id);
  expect(findings.map((finding) => finding.status)).toEqual(['confirmed', 'confirmed']);
  expect(findings.every((finding) => finding.resolvedAt !== null && finding.note === null)).toBe(true);

  // The same kind of finding decided on its own writes a row of exactly the same shape.
  const [single] = await findingsOf(manual);
  await resolve(single!.id, 'CONFIRM');
  const [manualRow] = await auditOf(manual);
  const rows = await auditOf(id);
  expect(rows.map((row) => row.action)).toEqual(['discrepancy_confirmed', 'discrepancy_confirmed', 'approved']);
  for (const row of rows.slice(0, 2)) expect(shape(row)).toEqual(shape(manualRow!));
  expect(new Set(rows.slice(0, 2).map((row) => row.discrepancyId))).toEqual(new Set(findings.map((finding) => finding.id)));
  expect(shape(rows[2]!)).toEqual({
    tenantId: manualRow!.tenantId,
    deadLetterId: null,
    actor: 'reviewer',
    action: 'approved',
    changes: [{ field: 'status', from: 'reconciled', to: 'approved' }],
    reason: 'at rate card',
  });
});

test('approve as billed dismisses every open finding and approves', async () => {
  const id = fresh.shift()!;
  await addFinding(id);
  expect((await decideInvoice(id, 'APPROVE_AS_BILLED', await seenOf(id))).data!.decideInvoice!.status).toBe('APPROVED');
  expect((await findingsOf(id)).map((finding) => finding.status)).toEqual(['dismissed', 'dismissed']);
  expect((await auditOf(id)).map((row) => [row.action, row.reason])).toEqual([
    ['discrepancy_dismissed', null],
    ['discrepancy_dismissed', null],
    ['approved', 'as billed'],
  ]);
});

test('dispute confirms every open finding and leaves the invoice reconciled, ready for approval', async () => {
  const id = fresh.shift()!;
  await addFinding(id);
  expect((await decideInvoice(id, 'DISPUTE', await seenOf(id))).data!.decideInvoice).toEqual({ status: 'RECONCILED', openDiscrepancyCount: 0 });
  expect((await findingsOf(id)).map((finding) => finding.status)).toEqual(['confirmed', 'confirmed']);
  expect((await auditOf(id)).map((row) => row.action)).toEqual(['discrepancy_confirmed', 'discrepancy_confirmed']);
  expect((await gql('mutation ($id: ID!) { approveInvoice(id: $id) { status } }', { id })).data!.approveInvoice!.status).toBe('APPROVED');
});

test('findings that changed since the page loaded refuse the decision, and nothing is written', async () => {
  const unchanged = async (id: string, refused: Result, audited: number) => {
    expect(refused.errors?.[0]).toMatchObject({ message: CHANGED, extensions: { code: 'CONFLICT' } });
    expect([await statusOf(id), (await auditOf(id)).length, (await keysOf(id)).length]).toEqual(['reconciled', audited, 0]);
  };
  // Another reviewer decided a finding.
  const decided = fresh.shift()!;
  const before = await seenOf(decided);
  await resolve(before[0]!.id, 'DISMISS');
  await unchanged(decided, await decideInvoice(decided, 'APPROVE_AT_RATE_CARD', before), 1);
  // A finding appeared.
  const grown = fresh.shift()!;
  const seen = await seenOf(grown);
  await addFinding(grown);
  await unchanged(grown, await decideInvoice(grown, 'DISPUTE', seen), 0);
  // The page listed a finding of another invoice, or left one out.
  const other = fresh.shift()!;
  await unchanged(other, await decideInvoice(other, 'DISPUTE', [...(await seenOf(other)), ...(await seenOf(fresh[0]!))]), 0);
  await unchanged(other, await decideInvoice(other, 'DISPUTE', []), 0);
});

test('a repeated request writes nothing more, and its requestId cannot decide another invoice', async () => {
  const id = fresh.shift()!;
  const seen = await seenOf(id);
  const requestId = randomUUID();
  const first = await decideInvoice(id, 'DISPUTE', seen, requestId);
  const audited = (await auditOf(id)).length;
  const again = await decideInvoice(id, 'DISPUTE', seen, requestId);
  expect(again.data).toEqual(first.data);
  expect((await auditOf(id)).length).toBe(audited);
  expect((await keysOf(id)).map((row) => row.key)).toEqual([`decide:DISPUTE:${requestId}`]);
  const elsewhere = fresh.shift()!;
  const refused = await decideInvoice(elsewhere, 'DISPUTE', await seenOf(elsewhere), requestId.toUpperCase());
  expect(refused.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  expect((await auditOf(elsewhere)).length).toBe(0);
});

test('a failure part-way changes nothing, and the same request then goes through', async () => {
  const id = fresh.shift()!;
  await addFinding(id);
  const seen = await seenOf(id);
  const requestId = randomUUID();
  // After both findings are decided, the approval's audit row fails.
  await pool.query(`CREATE FUNCTION fail_approval() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'approved' AND NEW.invoice_id = '${id}' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER fail_approval BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_approval()');
  try {
    const failed = await decideInvoice(id, 'APPROVE_AS_BILLED', seen, requestId);
    expect(failed.errors?.[0]?.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await seenOf(id)).toEqual(seen);
    expect((await findingsOf(id)).map((finding) => finding.status)).toEqual(['open', 'open']);
    expect([await statusOf(id), (await auditOf(id)).length, (await keysOf(id)).length]).toEqual(['reconciled', 0, 0]);
  } finally {
    await pool.query('DROP TRIGGER fail_approval ON audit_events');
    await pool.query('DROP FUNCTION fail_approval()');
  }
  expect((await decideInvoice(id, 'APPROVE_AS_BILLED', seen, requestId)).data!.decideInvoice!.status).toBe('APPROVED');
});

test('of two decisions sent at once, one goes through and the other is told the invoice changed', async () => {
  const id = fresh.shift()!;
  const seen = await seenOf(id);
  const results = await Promise.all([decideInvoice(id, 'DISPUTE', seen), decideInvoice(id, 'DISPUTE', seen)]);
  expect(results.filter((result) => result.data?.decideInvoice)).toHaveLength(1);
  expect(results.flatMap((result) => result.errors ?? []).map((error) => error.message)).toEqual([CHANGED]);
  expect((await auditOf(id)).length).toBe(1);
});

test('a single decision beside a decision on the whole invoice never deadlocks', async () => {
  const id = fresh.shift()!;
  const second = await addFinding(id);
  for (let round = 0; round < 10; round++) {
    await pool.query("UPDATE discrepancies SET status = 'open', resolved_at = NULL WHERE invoice_id = $1", [id]);
    const results = await Promise.all([resolve(second, 'DISMISS'), decideInvoice(id, 'DISPUTE', await seenOf(id))]);
    expect(results.flatMap((result) => result.errors ?? []).every((error) => error.extensions?.code === 'CONFLICT')).toBe(true);
  }
});

test('only a reconciled invoice with an open finding can be decided, and only with a UUID requestId', async () => {
  const approved: string = (await pool.query("SELECT id FROM invoices WHERE status = 'approved' LIMIT 1")).rows[0].id;
  expect((await decideInvoice(approved, 'DISPUTE', await seenOf(approved))).errors?.[0]?.extensions?.code).toBe('CONFLICT');
  const decided = fresh.shift()!;
  await resolve((await seenOf(decided))[0]!.id, 'CONFIRM');
  expect((await decideInvoice(decided, 'DISPUTE', await seenOf(decided))).errors?.[0]).toMatchObject({
    message: 'no finding of this invoice is open',
    extensions: { code: 'CONFLICT' },
  });
  const id = fresh.shift()!;
  expect((await decideInvoice(id, 'DISPUTE', await seenOf(id), 'not-a-uuid')).errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
});
