import { holdOf } from '@freightaudit/contracts/hold';
import { carriers, discrepancies, invoices } from '@freightaudit/db';
import { serverOptions } from '@freightaudit/telemetry';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv } from './testing.ts';

// The rule for what holds a checked invoice lives in three places: the held filter behind hasOpenFindings and
// invoicesHeld (graphql.ts), the hold loader behind Invoice.hold (loaders.ts), and holdOf, which the web runs over the
// findings an invoice page reads. Changing any one alone fails this file. Its own database holds only these invoices.
let env: Awaited<ReturnType<typeof createTestEnv>>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  env = await createTestEnv();
  app = buildApp(serverOptions('silent'), { apiKeys: [apiKey], storage: env.storage, graphql: { db: env.db, queues: env.queues, tenantId: env.tenantId } });
});
afterAll(async () => {
  await app.close();
  await env.close();
});

async function gql<T>(query: string, variables: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/graphql', headers: { 'x-api-key': apiKey, 'x-actor': 'reviewer' }, payload: { query, variables } });
  const { data, errors } = response.json() as { data: T; errors?: unknown };
  expect(errors).toBeUndefined();
  return data;
}

type Decision = 'open' | 'confirmed' | 'dismissed';
// A checked invoice, named for its findings: a charge and a possible duplicate, each absent or in the given status.
async function checked(charge: Decision | undefined, duplicate: Decision | undefined, name = `charge ${charge ?? 'none'}, duplicate ${duplicate ?? 'none'}`) {
  const contentSha256 = createHash('sha256').update(name).digest('hex');
  const [invoice] = await env.db.insert(invoices).values({ tenantId: env.tenantId, status: 'reconciled', filename: name, contentSha256 }).returning();
  const finding = (type: 'rate_mismatch' | 'duplicate_invoice', status: Decision) => ({
    tenantId: env.tenantId,
    invoiceId: invoice!.id,
    type,
    status,
    expectedCents: 0n,
    billedCents: 0n,
    evidence: 'test',
    resolvedAt: status === 'open' ? null : new Date(),
  });
  const findings = [charge && finding('rate_mismatch', charge), duplicate && finding('duplicate_invoice', duplicate)].filter((row) => row !== undefined);
  if (findings.length > 0) await env.db.insert(discrepancies).values(findings);
  return invoice!.id;
}

type Finding = Parameters<typeof holdOf>[1][number];
type Row = { id: string; filename: string; status: Parameters<typeof holdOf>[0]; hold: ReturnType<typeof holdOf>; discrepancies: { edges: { node: Finding }[] } };

test('every mix of a charge and a possible duplicate, and each invoice held at its approval from review, is held alike by Invoice.hold, hasOpenFindings, invoicesHeld and holdOf', async () => {
  const decisions = [undefined, 'open', 'confirmed', 'dismissed'] as const;
  for (const charge of decisions) for (const duplicate of decisions) await checked(charge, duplicate);
  // Rejected with an open charge and a confirmed duplicate: the charge closes with it, and the duplicate holds it no more.
  const rejected = await checked('open', 'confirmed', 'rejected, charge closed, duplicate confirmed');
  await gql('mutation ($id: ID!) { rejectInvoice(id: $id, reason: "Same invoice as an earlier one") { status } }', { id: rejected });
  // Approved as billed from review while its carrier billed the number before (0016): held in reconciled, with no
  // shipment and an open possible duplicate, which a reviewer then leaves open, confirms or dismisses.
  const [carrier] = await env.db.insert(carriers).values({ tenantId: env.tenantId, name: 'Test carrier' }).returning();
  const read = async (filename: string, status: 'approved' | 'needs_review') => {
    const contentSha256 = createHash('sha256').update(filename).digest('hex');
    const [invoice] = await env.db.insert(invoices).values({ tenantId: env.tenantId, status, filename, contentSha256, carrierId: carrier!.id, invoiceNumber: '98211354' }).returning();
    return invoice!.id;
  };
  await read('first scan, approved', 'approved');
  for (const decision of ['open', 'confirmed', 'dismissed'] as const) {
    const id = await read(`held at approval, duplicate ${decision}`, 'needs_review');
    const answer = await gql<{ approveInvoice: unknown }>('mutation ($id: ID!) { approveInvoice(id: $id) { status hold } }', { id });
    expect(answer.approveInvoice).toEqual({ status: 'RECONCILED', hold: 'POSSIBLE_DUPLICATE' });
    const [finding] = await env.db.select({ id: discrepancies.id }).from(discrepancies).where(eq(discrepancies.invoiceId, id));
    if (decision !== 'open') await gql(`mutation ($id: ID!) { resolveDiscrepancy(id: $id, decision: ${decision === 'confirmed' ? 'CONFIRM' : 'DISMISS'}) { status } }`, { id: finding!.id });
  }

  const all = await gql<{ invoices: { edges: { node: Row }[] } }>(
    '{ invoices(first: 100) { edges { node { id filename status hold discrepancies { edges { node { type status } } } } } } }',
  );
  const rows = all.invoices.edges.map(({ node }) => ({ ...node, expected: holdOf(node.status, node.discrepancies.edges.map((edge) => edge.node)) }));
  expect(rows).toHaveLength(21);
  expect(rows.map((row) => [row.filename, row.hold])).toEqual(rows.map((row) => [row.filename, row.expected]));
  const held = rows.filter((row) => row.expected !== null).map((row) => row.filename);
  const listed = await gql<{ invoices: { edges: { node: { filename: string } }[] } }>('{ invoices(first: 100, hasOpenFindings: true) { edges { node { filename } } } }');
  expect(listed.invoices.edges.map((edge) => edge.node.filename).sort()).toEqual(held.sort());
  const summary = await gql<{ invoiceSummary: { invoicesHeld: number } }>('{ invoiceSummary { invoicesHeld } }');
  expect(summary.invoiceSummary.invoicesHeld).toBe(held.length);

  // No check above passed for want of a case: the mixes reach every hold, and the rejected invoice keeps a confirmed
  // duplicate beside its closed charge.
  expect(new Set(rows.map((row) => row.expected))).toEqual(new Set([null, 'OPEN_FINDINGS', 'POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE']));
  const closed = rows.find((row) => row.id === rejected)!;
  expect([closed.status, closed.discrepancies.edges.map((edge) => edge.node.status).sort()]).toEqual(['REJECTED', ['CLOSED', 'CONFIRMED']]);
  const approvals = rows.filter((row) => row.filename.startsWith('held at approval'));
  expect(Object.fromEntries(approvals.map((row) => [row.filename, row.expected]))).toEqual({
    'held at approval, duplicate open': 'POSSIBLE_DUPLICATE',
    'held at approval, duplicate confirmed': 'CONFIRMED_DUPLICATE',
    'held at approval, duplicate dismissed': null,
  });
});
