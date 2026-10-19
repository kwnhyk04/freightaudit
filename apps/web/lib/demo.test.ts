import type { InvoicesQuery } from '@freightaudit/contracts/graphql';
import { demoInvoices, demoSummary } from './demo.ts';

const files = (data: InvoicesQuery) => data.invoices.edges.map(({ node }) => node.filename);

test('the sample lists its invoices newest first, filtered by status, open findings and a search like the api', () => {
  const all = demoInvoices();
  expect([all.invoices.totalCount, all.invoices.offset, all.invoices.pageInfo.hasNextPage, all.invoices.pageInfo.hasPreviousPage]).toEqual([11, 0, false, false]);
  expect(files(all).slice(0, 2)).toEqual(['g088.pdf', 'g003.pdf']);
  expect(files(demoInvoices({ status: 'RECONCILED' }))).toEqual(['g087.pdf', 'g081.pdf', 'g066.pdf', 'g069.pdf', 'g056.pdf', 'g054.pdf', 'g002.pdf']);
  expect(files(demoInvoices({ status: 'RECONCILED', open: true }))).toEqual(['g066.pdf', 'g069.pdf', 'g056.pdf']);
  expect(files(demoInvoices({ status: 'RECONCILED', open: false }))).toEqual(['g087.pdf', 'g081.pdf', 'g054.pdf', 'g002.pdf']);
  // Invoice number, PRO number or carrier name, trimmed and ignoring case; a status narrows it further.
  expect(files(demoInvoices(undefined, '96079756'))).toEqual(['g069.pdf']);
  expect(files(demoInvoices(undefined, '1036189830'))).toEqual(['g087.pdf']);
  expect(files(demoInvoices(undefined, '  TERN '))).toEqual(['g069.pdf']);
  expect(files(demoInvoices({ status: 'NEEDS_REVIEW' }, 'quarry'))).toEqual(['g088.pdf']);
  expect(demoInvoices(undefined, '%').invoices.totalCount).toBe(0);
  // A row carries what the list needs from the snapshot's detail: findings' amounts, the rate card, the reasons, and what
  // holds a checked invoice, as the api's Invoice.hold says it.
  const node = (file: string) => all.invoices.edges.find(({ node }) => node.filename === file)!.node;
  const g069 = node('g069.pdf');
  expect(g069.discrepancies.edges.map(({ node }) => [node.status, node.billedCents, node.expectedCents])).toContainEqual(['OPEN', 9_778, 0]);
  expect(g069.rateCardVersion?.id).toEqual(expect.any(String));
  expect(node('g088.pdf').reviewReason).toBe('no_shipment_match');
  expect(['g069.pdf', 'g054.pdf', 'g088.pdf'].map((file) => node(file).hold)).toEqual(['OPEN_FINDINGS', null, null]);
});

test('the sample summary counts statuses, open findings and their overcharge, held and matched invoices and open dead letters', () => {
  const summary = demoSummary();
  expect(summary).toEqual({
    statusCounts: expect.any(Array),
    receivedLast7Days: expect.any(Number),
    openFindings: 5,
    invoicesWithOpenFindings: 3,
    // The sample has no possible duplicate, so the invoices held are those with an open finding.
    invoicesHeld: 3,
    // Findings are written as an invoice reconciles: g066's move to reconciled is the oldest of the three.
    oldestOpenFindingAt: '2026-10-17T07:24:02.828Z',
    openOverchargeCents: 817_599,
    matchedRateCard: 3,
    openDeadLetters: 1,
  });
  expect(summary.statusCounts).toHaveLength(9);
  expect(summary.statusCounts.filter(({ count }) => count > 0)).toEqual([
    { status: 'RECONCILED', count: 7 },
    { status: 'NEEDS_REVIEW', count: 1 },
    { status: 'APPROVED', count: 1 },
    { status: 'REJECTED', count: 1 },
    { status: 'FAILED', count: 1 },
  ]);
});
