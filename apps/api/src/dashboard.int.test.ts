import { auditEvents, carriers, deadLetters, discrepancies, invoices, llmCalls, shipments, tenants } from '@freightaudit/db';
import { type DashboardInvoice, dashboardOf, type FindingAmounts, type InvoiceState } from '@freightaudit/domain';
import { serverOptions } from '@freightaudit/telemetry';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv } from './testing.ts';

// Query.dashboard counts the facts the api reads per invoice with dashboardOf, which the web's sample runs too. This file
// seeds every case the definitions name and checks the answer against dashboardOf over the same facts and against
// figures worked out by hand, then what dashboardOf never sees: split uploads, model cost, the pipeline now, refusals
// and another tenant. Its own database holds only these rows.
let env: Awaited<ReturnType<typeof createTestEnv>>;
let app: ReturnType<typeof buildApp>;

const DASHBOARD = `query ($from: Date!, $to: Date!) { dashboard(from: $from, to: $to) {
  window { from to received matchedRateCard overbilledCents overbilledInvoices timed processingP50Ms processingP95Ms modelCostPerInvoiceMicroUsd }
  previous { from to received matchedRateCard overbilledCents overbilledInvoices timed processingP50Ms processingP95Ms modelCostPerInvoiceMicroUsd }
  weeks { start matchedRateCard neededReviewer failed overbilledCents }
  carriers { carrier overbilledCents invoices }
  pipeline { waitingToBeRead openDeadLetters claudeTokensToday freeModelTokensToday } } }`;

async function dashboard(from: string, to: string) {
  const response = await app.inject({ method: 'POST', url: '/graphql', headers: { 'x-api-key': apiKey }, payload: { query: DASHBOARD, variables: { from, to } } });
  return response.json() as { data?: { dashboard: Record<string, unknown> }; errors?: { message: string; extensions?: { code?: string } }[] };
}

const H = 'Halcyon Ridge Freight';
const N = 'Nimbus Road Lines';
// An invoice as seeded: when it arrived, where it stands, and the pipeline's status moves, each so many ms after it
// arrived. held is a reviewer's move to reconciled at its approval from review, which is no pipeline move. A split
// upload's parts are invoices of their own; the upload itself ends extracted.
type Seed = {
  name: string;
  at: string;
  status: InvoiceState;
  carrier?: string;
  shipment?: boolean;
  corrected?: boolean;
  moves?: [number, InvoiceState][];
  held?: number;
  findings?: [FindingAmounts['status'], number, number?][];
  parts?: Seed[];
};
const SEEDS: Seed[] = [
  { name: 'matched', at: '2026-10-12T00:00:00.000Z', status: 'reconciled', carrier: H, shipment: true, moves: [[500, 'extracted'], [2_300, 'reconciled']] },
  { name: 'approved clean', at: '2026-10-01T09:00:00.000Z', status: 'approved', carrier: N, shipment: true, moves: [[4_700, 'reconciled']] },
  {
    name: 'findings in every state',
    at: '2026-10-05T12:00:00.000Z',
    status: 'reconciled',
    carrier: H,
    shipment: true,
    moves: [[3_100, 'reconciled']],
    findings: [['open', 10_000, 4_000], ['confirmed', 2_000], ['dismissed', 5_000], ['closed', 700]],
  },
  // Held at its approval from review: no shipment, and a possible duplicate that bills nothing above the rate card.
  { name: 'possible duplicate', at: '2026-09-28T08:00:00.000Z', status: 'reconciled', carrier: N, moves: [[1_200, 'needs_review']], held: 40_000, findings: [['open', 0]] },
  { name: 'corrected', at: '2026-10-14T10:00:00.000Z', status: 'reconciled', carrier: H, shipment: true, corrected: true, moves: [[900, 'needs_review'], [60_000, 'reconciled']] },
  { name: 'approved from review', at: '2026-10-15T10:00:00.000Z', status: 'approved', carrier: N, moves: [[1_500, 'needs_review']] },
  // Only a reviewer moved it, so it is not timed.
  { name: 'rejected', at: '2026-10-16T10:00:00.000Z', status: 'rejected', carrier: H, held: 5_000 },
  { name: 'failed', at: '2026-10-17T07:24:00.000Z', status: 'failed', moves: [[8_000, 'failed']] },
  { name: 'reading', at: '2026-10-18T23:59:59.999Z', status: 'extracting' },
  {
    name: 'split upload',
    at: '2026-10-10T10:00:00.000Z',
    status: 'extracted',
    parts: [
      { name: 'part 1', at: '2026-10-10T10:00:05.000Z', status: 'reconciled', carrier: H, shipment: true, moves: [[2_000, 'reconciled']] },
      { name: 'part 2', at: '2026-10-10T10:00:05.001Z', status: 'needs_review', moves: [[1_000, 'needs_review']] },
    ],
  },
  { name: 'previous window', at: '2026-09-20T23:59:59.999Z', status: 'reconciled', carrier: N, shipment: true, findings: [['open', 900]] },
  { name: 'before the first week', at: '2026-08-23T23:59:59.999Z', status: 'reconciled', carrier: H, shipment: true, findings: [['open', 50_000]] },
  { name: 'after to', at: '2026-10-19T00:00:00.000Z', status: 'reconciled', carrier: H, shipment: true, findings: [['open', 70_000]] },
];
const SETTLED = new Set<InvoiceState>(['reconciled', 'needs_review', 'failed']);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// One invoice and what hangs off it: its shipment, findings, status moves and a reviewer's correction. ids collects each
// invoice's id by name, parts included.
async function insert(tenantId: string, seed: Seed, carrierIds: Map<string, string>, ids: Map<string, string>, parentInvoiceId?: string) {
  const carrierId = seed.carrier ? carrierIds.get(seed.carrier)! : null;
  let shipmentId: string | null = null;
  if (seed.shipment) {
    const values = { tenantId, carrierId: carrierId!, proNumber: hash(`${tenantId} ${seed.name}`).slice(0, 10), reference: seed.name, origin: 'A', destination: 'B', shippedOn: '2026-09-01' };
    shipmentId = (await env.db.insert(shipments).values(values).returning())[0]!.id;
  }
  const at = new Date(seed.at);
  const values = { tenantId, status: seed.status, filename: seed.name, contentSha256: hash(`${tenantId} ${seed.name}`), carrierId, shipmentId, parentInvoiceId, createdAt: at };
  const id = (await env.db.insert(invoices).values(values).returning())[0]!.id;
  ids.set(seed.name, id);
  const later = (ms: number) => new Date(at.getTime() + ms);
  for (const [status, billed, expected = 0] of seed.findings ?? []) {
    await env.db.insert(discrepancies).values({
      tenantId,
      invoiceId: id,
      type: billed === 0 ? 'duplicate_invoice' : 'rate_mismatch',
      status,
      billedCents: BigInt(billed),
      expectedCents: BigInt(expected),
      evidence: 'test',
      resolvedAt: status === 'open' ? null : at,
    });
  }
  let from: InvoiceState = 'extracting';
  for (const [ms, to] of seed.moves ?? []) {
    await env.db.insert(auditEvents).values({ tenantId, invoiceId: id, action: 'status', changes: [{ field: 'status', from, to }], createdAt: later(ms) });
    from = to;
  }
  if (seed.held !== undefined) {
    const changes = [{ field: 'status', from: 'needs_review', to: 'reconciled' }];
    await env.db.insert(auditEvents).values({ tenantId, invoiceId: id, actor: 'reviewer', action: 'status', changes, reason: 'held', createdAt: later(seed.held) });
  }
  if (seed.corrected) {
    await env.db.insert(auditEvents).values({ tenantId, invoiceId: id, actor: 'reviewer', action: 'corrected', changes: [{ field: 'proNumber', from: '1', to: '2' }], createdAt: later(30_000) });
  }
  for (const part of seed.parts ?? []) await insert(tenantId, part, carrierIds, ids, id);
  return id;
}

// What dashboardOf sees of the seeds: each invoice, a split upload as its parts, settled at its first pipeline move to
// reconciled, needs_review or failed.
const facts = (seeds: Seed[]): DashboardInvoice[] =>
  seeds.flatMap((seed) => {
    if (seed.parts) return facts(seed.parts);
    const settled = seed.moves?.find(([, to]) => SETTLED.has(to))?.[0];
    return [
      {
        receivedAt: new Date(seed.at),
        status: seed.status,
        carrier: seed.carrier ?? null,
        shipment: seed.shipment ?? false,
        corrected: seed.corrected ?? false,
        settledAt: settled === undefined ? null : new Date(Date.parse(seed.at) + settled),
        findings: (seed.findings ?? []).map(([status, billed, expected = 0]) => ({ status, billedCents: BigInt(billed), expectedCents: BigInt(expected) })),
      },
    ];
  });
// Cents leave the api as JSON numbers.
const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_, each: unknown) => (typeof each === 'bigint' ? Number(each) : each))) as Record<string, unknown>;

// A model call of an invoice, with its tokens split between input and output.
const call = (tenantId: string, invoiceId: string, provider: string, costMicroUsd: number, tokens: number, createdAt: Date) => ({
  tenantId,
  invoiceId,
  role: 'primary',
  step: 'first_pass',
  provider,
  model: `${provider}-model`,
  outcome: 'valid',
  inputTokens: tokens - Math.floor(tokens / 3),
  outputTokens: Math.floor(tokens / 3),
  latencyMs: 1_000,
  costMicroUsd: BigInt(costMicroUsd),
  createdAt,
});

beforeAll(async () => {
  env = await createTestEnv();
  app = buildApp(serverOptions('silent'), { apiKeys: [apiKey], storage: env.storage, graphql: { db: env.db, queues: env.queues, tenantId: env.tenantId } });
  const other = randomUUID();
  await env.db.insert(tenants).values({ id: other, name: 'Another tenant' });
  const ids = new Map<string, string>();
  const now = new Date();
  for (const tenantId of [env.tenantId, other]) {
    const carrierIds = new Map<string, string>();
    for (const name of [H, N]) carrierIds.set(name, (await env.db.insert(carriers).values({ tenantId, name }).returning())[0]!.id);
    // The other tenant has an invoice of each kind in the window, which nothing may count.
    const own = new Map<string, string>();
    const seeds = tenantId === env.tenantId ? SEEDS : SEEDS.filter((each) => ['matched', 'findings in every state', 'reading'].includes(each.name));
    for (const seed of [...seeds, { name: 'just uploaded', at: now.toISOString(), status: 'received' as const }]) await insert(tenantId, seed, carrierIds, own);
    if (tenantId === env.tenantId) for (const [name, id] of own) ids.set(name, id);
    else await env.db.insert(llmCalls).values(call(other, own.get('just uploaded')!, 'anthropic', 900, 9_999, now));
    await env.db.insert(deadLetters).values([
      { tenantId, queue: 'extract', jobId: 'open', payload: {}, error: 'test', attempts: 3 },
      { tenantId, queue: 'extract', jobId: 'replayed', payload: {}, error: 'test', attempts: 3, replayedAt: now },
    ]);
  }
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  await env.db.insert(llmCalls).values([
    call(env.tenantId, ids.get('matched')!, 'groq', 0, 1_500, new Date('2026-10-12T00:00:01Z')),
    call(env.tenantId, ids.get('findings in every state')!, 'anthropic', 1_234, 2_600, new Date('2026-10-05T12:00:01Z')),
    call(env.tenantId, ids.get('split upload')!, 'anthropic', 3_000, 4_900, new Date('2026-10-10T10:00:02Z')),
    call(env.tenantId, ids.get('part 1')!, 'groq', 0, 1_100, new Date('2026-10-10T10:00:06Z')),
    call(env.tenantId, ids.get('previous window')!, 'gemini', 0, 700, new Date('2026-09-21T00:00:01Z')),
    // Today: Claude 2,700 tokens and the free models 1,200; the last millisecond of yesterday counts for neither.
    call(env.tenantId, ids.get('just uploaded')!, 'anthropic', 0, 2_700, now),
    call(env.tenantId, ids.get('just uploaded')!, 'gemini', 0, 1_200, now),
    call(env.tenantId, ids.get('just uploaded')!, 'anthropic', 0, 5_000, new Date(midnight - 1)),
  ]);
});
afterAll(async () => {
  await app.close();
  await env.close();
});

test("the window, the previous window, the weeks and the carriers are dashboardOf's, over the facts of each invoice", async () => {
  for (const [from, to] of [
    ['2026-09-21', '2026-10-18'],
    ['2026-10-12', '2026-10-18'],
    ['2026-08-24', '2026-10-18'],
    ['2026-10-17', '2026-10-17'],
  ] as const) {
    const { data, errors } = await dashboard(from, to);
    expect(errors).toBeUndefined();
    const { window, previous, weeks, carriers: top } = data!.dashboard;
    // The cost per invoice is the api's alone; toMatchObject leaves it out.
    expect({ window, previous, weeks, carriers: top }).toMatchObject(wire(dashboardOf(facts(SEEDS), from, to)));
  }
});

test('the four weeks to 2026-10-18, worked out by hand', async () => {
  const { data } = await dashboard('2026-09-21', '2026-10-18');
  expect(data!.dashboard).toEqual({
    // Eleven invoices: the split upload counts as its two parts. Matched: matched, approved clean and part 1; the corrected
    // one needed a reviewer. Its findings bill 6,000 + 2,000 + 700 above the rate card; the dismissed one lets 5,000 stand.
    // Timed, in ms: 900, 1,000, 1,200, 1,500, 2,000, 2,300, 3,100, 4,700 and 8,000; the rejected one has no pipeline move.
    // Model cost: 1,234 + 3,000 micro-dollars (the upload's own call included) over 11 invoices, 384.9, so 385.
    window: {
      from: '2026-09-21',
      to: '2026-10-18',
      received: 11,
      matchedRateCard: 3,
      overbilledCents: 8_700,
      overbilledInvoices: 1,
      timed: 9,
      processingP50Ms: 2_000,
      processingP95Ms: 8_000,
      modelCostPerInvoiceMicroUsd: 385,
    },
    previous: {
      from: '2026-08-24',
      to: '2026-09-20',
      received: 1,
      matchedRateCard: 0,
      overbilledCents: 900,
      overbilledInvoices: 1,
      timed: 0,
      processingP50Ms: null,
      processingP95Ms: null,
      modelCostPerInvoiceMicroUsd: 0,
    },
    weeks: [
      { start: '2026-08-24', matchedRateCard: 0, neededReviewer: 0, failed: 0, overbilledCents: 0 },
      { start: '2026-08-31', matchedRateCard: 0, neededReviewer: 0, failed: 0, overbilledCents: 0 },
      { start: '2026-09-07', matchedRateCard: 0, neededReviewer: 0, failed: 0, overbilledCents: 0 },
      { start: '2026-09-14', matchedRateCard: 0, neededReviewer: 1, failed: 0, overbilledCents: 900 },
      { start: '2026-09-21', matchedRateCard: 0, neededReviewer: 0, failed: 0, overbilledCents: 0 },
      { start: '2026-09-28', matchedRateCard: 1, neededReviewer: 1, failed: 0, overbilledCents: 0 },
      { start: '2026-10-05', matchedRateCard: 1, neededReviewer: 2, failed: 0, overbilledCents: 8_700 },
      { start: '2026-10-12', matchedRateCard: 1, neededReviewer: 3, failed: 1, overbilledCents: 0 },
    ],
    carriers: [{ carrier: H, overbilledCents: 8_700, invoices: 1 }],
    // Waiting to be read: the one being read and the one just uploaded. One dead letter is open, one replayed.
    pipeline: { waitingToBeRead: 2, openDeadLetters: 1, claudeTokensToday: 2_700, freeModelTokensToday: 1_200 },
  });
});

test('a window with no invoice has no processing time and no cost per invoice', async () => {
  const { data } = await dashboard('2026-07-01', '2026-07-07');
  expect(data!.dashboard.window).toEqual({
    from: '2026-07-01',
    to: '2026-07-07',
    received: 0,
    matchedRateCard: 0,
    overbilledCents: 0,
    overbilledInvoices: 0,
    timed: 0,
    processingP50Ms: null,
    processingP95Ms: null,
    modelCostPerInvoiceMicroUsd: null,
  });
});

test('the dashboard refuses a from after to, a window over 56 days and a day that is not one', async () => {
  const refused = async (from: string, to: string) => (await dashboard(from, to)).errors?.[0];
  expect(await refused('2026-10-19', '2026-10-18')).toMatchObject({ message: 'from (2026-10-19) is after to (2026-10-18)', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused('2026-08-23', '2026-10-18')).toMatchObject({ message: 'from (2026-08-23) to (2026-10-18) is 57 days; the most is 56', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused('2026-02-30', '2026-03-01')).toMatchObject({ message: 'from must be a day such as 2026-10-19', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused('2026-10-01', 'today')).toMatchObject({ message: 'to must be a day such as 2026-10-19', extensions: { code: 'BAD_USER_INPUT' } });
});
