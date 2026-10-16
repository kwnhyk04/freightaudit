import { auditEvents, invoices } from '@freightaudit/db';
import { seed } from '@freightaudit/db/scripts/seed';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createMemoryStorage, createQueues, type Queues } from '@freightaudit/pipeline';
import { serverOptions } from '@freightaudit/telemetry';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp } from './app.ts';
import { createService } from './service.ts';
import { apiKey } from './testing.ts';

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
