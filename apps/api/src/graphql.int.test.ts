import { auditEvents, deadLetters, discrepancies, invoices, invoiceStatus } from '@freightaudit/db';
import { seed } from '@freightaudit/db/scripts/seed';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createMemoryStorage, createQueues, type Queues } from '@freightaudit/pipeline';
import { serverOptions } from '@freightaudit/telemetry';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp } from './app.ts';
import { MAX_DEPTH } from './query-limits.ts';
import { createService } from './service.ts';
import { apiKey, deepQuery } from './testing.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let pool: pg.Pool;
let db: NodePgDatabase;
let redis: Redis;
let queues: Queues;
let tenantId: string;
let app: ReturnType<typeof buildApp>;
const logged: string[] = [];
// Every query the resolvers send outside a transaction goes through pool.query, so this counts them.
let queries = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  const seeder = new pg.Client({ connectionString: database.url });
  await seeder.connect();
  await seed(seeder, 'small', { log: () => {} });
  await seeder.end();
  pool = new pg.Pool({ connectionString: database.url });
  const query = pool.query.bind(pool);
  pool.query = ((...args: Parameters<typeof query>) => {
    queries++;
    return query(...args);
  }) as typeof pool.query;
  db = drizzle(pool);
  tenantId = (await pool.query('SELECT id FROM tenants')).rows[0].id;
  redis = new Redis(testEnv('REDIS_URL'), { maxRetriesPerRequest: 1 });
  queues = createQueues(redis, `test-${randomBytes(4).toString('hex')}`);
  const storage = createMemoryStorage();
  const options = serverOptions('info');
  app = buildApp(
    { ...options, logger: { ...options.logger, stream: { write: (line: string) => logged.push(line) } } },
    { apiKeys: [apiKey], storage, service: createService({ db, queues, tenantId, storage }), graphql: { db, queues, tenantId } },
  );
});
afterAll(async () => {
  await app.close();
  await queues.close();
  await redis.quit();
  await pool.end();
  await database.drop();
});

// The GraphQL response as JSON, read by path in the assertions.
async function gql(query: string, variables: Record<string, unknown> = {}, actor?: string) {
  const headers = { 'x-api-key': apiKey, ...(actor ? { 'x-actor': actor } : {}) };
  const response = await app.inject({ method: 'POST', url: '/graphql', headers, payload: { query, variables } });
  return response.json();
}
const statusOf = async (id: string) => (await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0]?.status;
const idsWith = async (status: 'needs_review' | 'reconciled') =>
  (await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, status)))).map((row) => row.id);

test('invoices page by keyset with no gap or repeat, filtered by status, with money as integer cents', async () => {
  const seen: string[] = [];
  let after: string | null = null;
  do {
    const { data } = await gql('query ($after: String) { invoices(first: 7, after: $after, status: NEEDS_REVIEW) { edges { node { id status totalCents } } pageInfo { hasNextPage endCursor } } }', { after });
    const page = data!.invoices;
    for (const { node } of page.edges) {
      expect(node.status).toBe('NEEDS_REVIEW');
      expect(Number.isSafeInteger(node.totalCents)).toBe(true);
      seen.push(node.id);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen.sort()).toEqual((await idsWith('needs_review')).sort());
});

test('invoices page forward to the end and back to the start, with the total, each page offset and no gap or repeat', async () => {
  const page = async (variables: Record<string, unknown>) => {
    const query = `query ($first: Int, $after: String, $last: Int, $before: String) {
      invoices(first: $first, after: $after, last: $last, before: $before, status: APPROVED) {
        totalCount offset edges { node { id } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`;
    const { data, errors } = await gql(query, variables);
    expect(errors).toBeUndefined();
    return data!.invoices as {
      totalCount: number;
      offset: number;
      edges: { node: { id: string } }[];
      pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string; endCursor: string };
    };
  };
  const ids = (each: Awaited<ReturnType<typeof page>>) => each.edges.map(({ node }) => node.id);
  const approved = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'approved')))
    .orderBy(desc(invoices.createdAt), desc(invoices.id));
  const forward: string[][] = [];
  let current = await page({ first: 40 });
  for (;;) {
    expect([current.totalCount, current.offset, current.pageInfo.hasPreviousPage]).toEqual([approved.length, forward.flat().length, forward.length > 0]);
    forward.push(ids(current));
    if (!current.pageInfo.hasNextPage) break;
    current = await page({ first: 40, after: current.pageInfo.endCursor });
  }
  expect(forward.length).toBeGreaterThan(2);
  expect(forward.flat()).toEqual(approved.map((row) => row.id));
  // Back from the last page, each page is the one that came before it going forward.
  let cursor = current.pageInfo.startCursor;
  for (let i = forward.length - 2; i >= 0; i--) {
    const back = await page({ last: 40, before: cursor });
    expect(ids(back)).toEqual(forward[i]);
    expect([back.offset, back.pageInfo.hasPreviousPage, back.pageInfo.hasNextPage]).toEqual([i * 40, i > 0, true]);
    cursor = back.pageInfo.startCursor;
  }
  expect((await gql('{ invoices(after: "x", before: "y") { totalCount } }')).errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  expect((await gql('{ invoices(last: 0) { totalCount } }')).errors?.[0]?.message).toBe('last must be between 1 and 100');
});

test('search finds invoices by number, PRO or carrier, ignoring case, and takes LIKE wildcards literally', async () => {
  const search = async (term: string, status?: string) => {
    const query = 'query ($term: String, $status: InvoiceStatus) { invoices(first: 100, search: $term, status: $status) { totalCount edges { node { id status } } } }';
    const { data, errors } = await gql(query, { term, status });
    expect(errors).toBeUndefined();
    return data!.invoices as { totalCount: number; edges: { node: { id: string; status: string } }[] };
  };
  const { rows } = await pool.query(
    'SELECT i.id, i.invoice_number, i.pro_number, c.name FROM invoices i JOIN carriers c ON c.id = i.carrier_id WHERE i.invoice_number IS NOT NULL AND i.pro_number IS NOT NULL LIMIT 1',
  );
  const [{ id, invoice_number: number, pro_number: pro, name }] = rows;
  for (const term of [number, pro]) expect((await search(term)).edges.map(({ node }) => node.id)).toContain(id);
  const { rows: carried } = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE i.status = 'reconciled')::int AS reconciled FROM invoices i JOIN carriers c ON c.id = i.carrier_id WHERE c.name = $1", [name]);
  // Trimmed and in capitals, the carrier's name finds every invoice it billed; numbers never contain carrier names.
  expect((await search(` ${name.toUpperCase()} `)).totalCount).toBe(carried[0].n);
  const reconciled = await search(name.toLowerCase(), 'RECONCILED');
  expect([reconciled.totalCount, reconciled.edges.every(({ node }) => node.status === 'RECONCILED')]).toEqual([carried[0].reconciled, true]);
  // Unescaped, % and _ would match every invoice.
  for (const wildcard of ['%', '_']) expect((await search(wildcard)).totalCount).toBe(0);
  expect((await gql(`{ invoices(search: "${'7'.repeat(101)}") { totalCount } }`)).errors?.[0]?.message).toBe('search is longer than 100 characters');
});

const SUMMARY = `query ($carrierId: ID, $from: Date, $to: Date) { invoiceSummary(carrierId: $carrierId, from: $from, to: $to) {
  statusCounts { status count } receivedLast7Days openFindings invoicesWithOpenFindings oldestOpenFindingAt openOverchargeCents matchedRateCard
  openDeadLetters } }`;
type Invoice = typeof invoices.$inferSelect;
// The summary read from the tables, of the invoices keep accepts; with no keep, of all of them and every dead letter.
async function expectedSummary(keep?: (invoice: Invoice) => boolean) {
  const all = (await db.select().from(invoices).where(eq(invoices.tenantId, tenantId))).filter(keep ?? (() => true));
  const kept = new Set(all.map((invoice) => invoice.id));
  const findings = (await db.select().from(discrepancies).where(eq(discrepancies.tenantId, tenantId))).filter((finding) => kept.has(finding.invoiceId));
  const letters = (await db.select().from(deadLetters).where(eq(deadLetters.tenantId, tenantId))).filter((letter) => {
    const invoiceId = (letter.payload as { invoiceId?: string }).invoiceId;
    return invoiceId === undefined ? !keep : kept.has(invoiceId);
  });
  const open = findings.filter((finding) => finding.status === 'open');
  const flagged = new Set(findings.map((finding) => finding.invoiceId));
  const weekAgo = Date.now() - 7 * 86_400_000;
  return {
    statusCounts: invoiceStatus.enumValues.map((status) => ({ status: status.toUpperCase(), count: all.filter((row) => row.status === status).length })),
    receivedLast7Days: all.filter((row) => row.createdAt.getTime() > weekAgo).length,
    openFindings: open.length,
    invoicesWithOpenFindings: new Set(open.map((finding) => finding.invoiceId)).size,
    oldestOpenFindingAt: open.length > 0 ? new Date(Math.min(...open.map((finding) => finding.createdAt.getTime()))).toISOString() : null,
    openOverchargeCents: Number(open.reduce((cents, finding) => cents + finding.billedCents - finding.expectedCents, 0n)),
    matchedRateCard: all.filter((row) => row.status === 'reconciled' && !flagged.has(row.id)).length,
    openDeadLetters: letters.filter((letter) => letter.replayedAt === null).length,
  };
}
const summaryOf = async (variables: Record<string, unknown> = {}) => {
  const { data, errors } = await gql(SUMMARY, variables);
  expect(errors).toBeUndefined();
  return data!.invoiceSummary;
};

test('the summary counts what the tables hold', async () => {
  const want = await expectedSummary();
  expect(want.openFindings).toBeGreaterThan(0);
  expect(await summaryOf()).toEqual(want);
});

test('the summary narrows to the carrier that bills, to the UTC days invoices were received, or both', async () => {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  // The middle invoice by received time, so every filter below leaves invoices out on each side.
  const carried = await db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), isNotNull(invoices.carrierId))).orderBy(invoices.createdAt);
  const sample = carried[Math.floor(carried.length / 2)];
  const carrierId = sample!.carrierId!;
  const from = day(sample!.createdAt);
  const to = day(new Date(sample!.createdAt.getTime() + 3 * 86_400_000));
  const billed = (invoice: Invoice) => invoice.carrierId === carrierId;
  const received = (invoice: Invoice) => day(invoice.createdAt) >= from && day(invoice.createdAt) <= to;
  const cases: [Record<string, string>, (invoice: Invoice) => boolean][] = [
    [{ carrierId }, billed],
    [{ from, to }, received],
    [{ carrierId, from, to }, (invoice) => billed(invoice) && received(invoice)],
    [{ from }, (invoice) => day(invoice.createdAt) >= from],
    [{ to }, (invoice) => day(invoice.createdAt) <= to],
    [{ from, to: from }, (invoice) => day(invoice.createdAt) === from],
  ];
  const everything = await expectedSummary();
  for (const [variables, keep] of cases) {
    const want = await expectedSummary(keep);
    // Each filter keeps some invoices and leaves out others, so it is tested on both sides.
    const total = (summary: typeof want) => summary.statusCounts.reduce((sum, { count }) => sum + count, 0);
    expect([variables, total(want) > 0, total(want) < total(everything)]).toEqual([variables, true, true]);
    expect([variables, await summaryOf(variables)]).toEqual([variables, want]);
  }
});

test('the summary refuses a range whose from is after its to, a day that is not one, and a carrier id that is not one', async () => {
  const refused = async (variables: Record<string, string>) => (await gql(SUMMARY, variables)).errors?.[0];
  expect(await refused({ from: '2026-10-20', to: '2026-10-19' })).toMatchObject({ message: 'from (2026-10-20) is after to (2026-10-19)', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused({ from: '2026-02-30' })).toMatchObject({ message: 'from must be a day such as 2026-10-19', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused({ to: 'yesterday' })).toMatchObject({ message: 'to must be a day such as 2026-10-19', extensions: { code: 'BAD_USER_INPUT' } });
  expect(await refused({ carrierId: 'acme' })).toMatchObject({ message: 'carrierId is not a carrier id', extensions: { code: 'BAD_USER_INPUT' } });
});

test('reconciled invoices filter by whether an open finding waits: billing issues, or ready to approve', async () => {
  const listed = async (variables: Record<string, unknown>) => {
    const query = 'query ($open: Boolean) { invoices(first: 100, status: RECONCILED, hasOpenFindings: $open) { totalCount edges { node { id openDiscrepancyCount } } } }';
    const { data, errors } = await gql(query, variables);
    expect(errors).toBeUndefined();
    return data!.invoices as { totalCount: number; edges: { node: { id: string; openDiscrepancyCount: number } }[] };
  };
  const { rows } = await pool.query(
    "SELECT count(*) FILTER (WHERE waits)::int AS waiting, count(*) FILTER (WHERE NOT waits)::int AS ready FROM (SELECT EXISTS (SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id AND d.status = 'open') AS waits FROM invoices i WHERE i.status = 'reconciled') t",
  );
  const [issues, ready, all] = [await listed({ open: true }), await listed({ open: false }), await listed({})];
  expect([issues.totalCount, ready.totalCount, all.totalCount]).toEqual([rows[0].waiting, rows[0].ready, rows[0].waiting + rows[0].ready]);
  expect([rows[0].waiting > 0, rows[0].ready > 0]).toEqual([true, true]);
  expect(issues.edges.every(({ node }) => node.openDiscrepancyCount > 0)).toBe(true);
  expect(ready.edges.every(({ node }) => node.openDiscrepancyCount === 0)).toBe(true);
});

test('a page of 25 discrepancies with invoice, line, shipment and rate card costs a fixed number of queries', async () => {
  const fields = '{ edges { node { id expectedCents invoice { id carrier } lineItem { description } shipment { reference } rateCardVersion { version effectiveFrom } } } }';
  queries = 0;
  const { data, errors } = await gql(`{ discrepancies(first: 25) ${fields} }`);
  expect(errors).toBeUndefined();
  expect(data!.discrepancies.edges).toHaveLength(25);
  // The page itself and one batched query per relation, however many rows.
  expect(queries).toBeLessThanOrEqual(5);
  queries = 0;
  await gql(`{ discrepancies(first: 5) ${fields} }`);
  expect(queries).toBeLessThanOrEqual(5);
});

test('a reviewer corrects a needs_review PRO number, which queues matching again, or rejects one; both are audited', async () => {
  const [corrected, rejected] = await idsWith('needs_review');
  const { rows } = await pool.query('SELECT pro_number, content_sha256 FROM invoices WHERE id = $1', [corrected]);
  const misread: string = rows[0].pro_number;
  // The seed misreads the PRO number's last digit as one more (seed.ts).
  const pro = `${misread.slice(0, -1)}${(Number(misread.at(-1)) + 9) % 10}`;
  const fixed = await gql('mutation ($id: ID!, $pro: String) { correctInvoice(id: $id, proNumber: $pro) { status proNumber } }', { id: corrected, pro }, 'reviewer');
  expect(fixed.data!.correctInvoice).toEqual({ status: 'EXTRACTED', proNumber: pro });
  const job = await queues.queue('reconcile').getJob(rows[0].content_sha256);
  expect(job?.data).toMatchObject({ tenantId, invoiceId: corrected });

  const refused = await gql('mutation ($id: ID!) { rejectInvoice(id: $id, reason: "  ") { status } }', { id: rejected }, 'reviewer');
  expect(refused.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  const done = await gql('mutation ($id: ID!) { rejectInvoice(id: $id, reason: "Billed twice by the carrier") { status } }', { id: rejected }, 'reviewer');
  expect(done.data!.rejectInvoice.status).toBe('REJECTED');
  const again = await gql('mutation ($id: ID!) { rejectInvoice(id: $id, reason: "again") { status } }', { id: rejected }, 'reviewer');
  expect(again.errors?.[0]?.extensions?.code).toBe('CONFLICT');

  const trail = await gql('query ($id: ID!) { invoice(id: $id) { auditTrail { action actor detail changes { field from to } } } }', { id: corrected });
  expect(trail.data!.invoice.auditTrail.at(-1)).toEqual({
    action: 'CORRECTED',
    actor: 'reviewer',
    detail: null,
    changes: [
      { field: 'proNumber', from: misread, to: pro },
      { field: 'status', from: 'needs_review', to: 'extracted' },
    ],
  });
  const audited = await db.select().from(auditEvents).where(eq(auditEvents.invoiceId, rejected!));
  expect(audited).toMatchObject([{ actor: 'reviewer', action: 'rejected', reason: 'Billed twice by the carrier' }]);
});

test('approval waits for every discrepancy decision; the decisions and the approval are audited', async () => {
  const { rows } = await pool.query(
    "SELECT d.invoice_id FROM discrepancies d JOIN invoices i ON i.id = d.invoice_id WHERE i.status = 'reconciled' AND d.status = 'open' LIMIT 1",
  );
  const id: string = rows[0].invoice_id;
  const refused = await gql('mutation ($id: ID!) { approveInvoice(id: $id) { status } }', { id }, 'reviewer');
  expect(refused.errors?.[0]).toMatchObject({ message: expect.stringMatching(/^decide the \d+ open discrepanc/), extensions: { code: 'CONFLICT' } });
  const open = await gql('query ($id: ID!) { invoice(id: $id) { discrepancies(status: OPEN) { edges { node { id } } } } }', { id });
  for (const { node } of open.data!.invoice.discrepancies.edges) {
    const decided = await gql('mutation ($id: ID!) { resolveDiscrepancy(id: $id, decision: CONFIRM, note: "Contract rate applies") { status note } }', { id: node.id }, 'reviewer');
    expect(decided.data!.resolveDiscrepancy).toEqual({ status: 'CONFIRMED', note: 'Contract rate applies' });
  }
  const approved = await gql('mutation ($id: ID!) { approveInvoice(id: $id) { status openDiscrepancyCount } }', { id }, 'reviewer');
  expect(approved.data!.approveInvoice).toEqual({ status: 'APPROVED', openDiscrepancyCount: 0 });
  expect(await statusOf(id)).toBe('approved');
  const actions = (await db.select().from(auditEvents).where(eq(auditEvents.invoiceId, id))).map((row) => row.action);
  expect(actions.at(-1)).toBe('approved');
  expect(actions.filter((action) => action === 'discrepancy_confirmed')).toHaveLength(open.data!.invoice.discrepancies.edges.length);
});

test('a document over the limits is refused before any resolver runs: no database query, and no mutation acts', async () => {
  const { rows } = await pool.query("SELECT id FROM invoices i WHERE i.status = 'reconciled' AND NOT EXISTS (SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id) LIMIT 1");
  const id: string = rows[0].id;
  queries = 0;
  const aliased = await gql('mutation ($id: ID!) { done: approveInvoice(id: $id) { status } }', { id }, 'reviewer');
  const deep = await gql(deepQuery(MAX_DEPTH + 1));
  const messages = (response: { errors?: { message: string }[] }) => response.errors?.map((error) => error.message);
  expect([messages(aliased), messages(deep), queries]).toEqual([
    ['Aliases are not accepted: done.'],
    [`The query nests ${MAX_DEPTH + 1} fields deep; the limit is ${MAX_DEPTH}.`],
    0,
  ]);
  expect(await statusOf(id)).toBe('reconciled');
});

test('dead letters list by status and replay with the actor recorded', async () => {
  const open = await gql('{ deadLetters(first: 5, status: OPEN) { edges { node { id queue error invoice { id status } } } } }');
  const letter = open.data!.deadLetters.edges[0].node;
  expect(letter.invoice.status).toBe('FAILED');
  const replayed = await gql('mutation ($id: ID!) { replayDeadLetter(id: $id) { id replayedAt } }', { id: letter.id }, 'reviewer');
  expect(replayed.data!.replayDeadLetter.replayedAt).not.toBeNull();
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.deadLetterId, letter.id));
  expect(rows).toMatchObject([{ actor: 'reviewer', action: 'replayed', changes: [{ field: 'status', from: 'failed', to: 'received' }] }]);
});

test('client errors say what is wrong; an unexpected failure is masked and logs no bound value', async () => {
  expect((await gql('{ invoices(after: "nope") { edges { cursor } } }')).errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  expect((await gql('{ invoices(first: 101) { edges { cursor } } }')).errors?.[0]?.message).toBe('first must be between 1 and 100');
  expect((await gql('{ invoice(id: "not-a-uuid") { id } }')).data!.invoice).toBeNull();
  const actor = await gql('mutation { rejectInvoice(id: "00000000-0000-0000-0000-000000000000", reason: "x") { id } }', {}, 'bad;actor');
  expect(actor.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  const names = (await pool.query('SELECT name FROM carriers')).rows.map((row) => row.name as string);
  expect((await gql('{ carriers { name } }')).data!.carriers.map((carrier: { name: string }) => carrier.name)).toEqual(names.sort());

  // A well-formed cursor whose date Postgres cannot read fails the query, which carries the cursor as a bound value.
  const canary = '2026-13-45T00:00:00.000000Z';
  const cursor = Buffer.from(JSON.stringify([canary, '00000000-0000-0000-0000-000000000000'])).toString('base64url');
  const failed = await gql('query ($after: String) { invoices(after: $after) { edges { cursor } } }', { after: cursor });
  expect(failed.errors?.[0]).toMatchObject({ message: 'Unexpected error.', extensions: { code: 'INTERNAL_SERVER_ERROR' } });
  expect(logged.join('')).toContain('graphql resolver failed');
  expect(logged.join('')).not.toContain(canary);
});
