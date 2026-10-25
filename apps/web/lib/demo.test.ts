import type { InvoicesQuery } from '@freightaudit/contracts/graphql';
import { DEMO_OVERVIEW_NOTE, demoDashboard, demoInvoiceFile, demoInvoices, demoSummary } from './demo.ts';
import { rangeOf } from './overview.ts';

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

test("the landing page's invoice is the sample's g066: one open finding, its linehaul above the rate card", () => {
  const hero = demoInvoiceFile('g066.pdf');
  expect(hero).toMatchObject({ carrier: 'Bramblewood Express', number: '76644482', status: 'RECONCILED', openDiscrepancyCount: 1 });
  expect(hero!.discrepancies.edges.map(({ node }) => [node.type, node.status, node.billedCents - node.expectedCents])).toEqual([['RATE_MISMATCH', 'OPEN', 80_154]]);
  expect(demoInvoiceFile('nothing.pdf')).toBeUndefined();
});

// By hand from the eleven, all received on 2026-10-17. Matched the rate card: g002 and g081; g087 has no finding but a
// reviewer corrected it. Failed: g003; the other eight needed a reviewer. Standing findings: g069's three open
// (731,456), g066's open one (80,154), g054's confirmed one (10,323) and g056's open one (5,989); g055's is dismissed.
// Upload to the pipeline's first stop, ascending, in ms: 1,305 1,614 2,696 3,361 5,141 19,641 26,584 48,976 66,960
// 84,408 102,352 (g087's first stop is its move to needs review), so the 6th and the 11th are the median and the 95th.
test("the sample's overview ends on its newest day, with every figure counted by hand from its eleven invoices", () => {
  const month = demoDashboard(rangeOf('4w'));
  expect(month.window).toEqual({
    from: '2026-09-20',
    to: '2026-10-17',
    received: 11,
    matchedRateCard: 2,
    overbilledCents: 827_922,
    overbilledInvoices: 4,
    timed: 11,
    processingP50Ms: 19_641,
    processingP95Ms: 102_352,
    modelCostPerInvoiceMicroUsd: null,
  });
  expect(month.previous).toEqual({ received: 0, overbilledCents: 0 });
  // Eight weeks, Monday to Sunday, and only the last holds the sample.
  const empty = { matchedRateCard: 0, neededReviewer: 0, failed: 0, overbilledCents: 0 };
  expect(month.weeks).toEqual([
    ...['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].map((start) => ({ start, ...empty })),
    { start: '2026-10-12', matchedRateCard: 2, neededReviewer: 8, failed: 1, overbilledCents: 827_922 },
  ]);
  expect(month.carriers).toEqual([
    { carrier: 'Tern & Tide Carriers', overbilledCents: 731_456, invoices: 1 },
    { carrier: 'Bramblewood Express', overbilledCents: 90_477, invoices: 2 },
    { carrier: 'Quarry Lane Transport', overbilledCents: 5_989, invoices: 1 },
  ]);
  // No invoice waits to be read and one dead letter is open; the sample made no model calls.
  expect(month.pipeline).toEqual({ waitingToBeRead: 0, openDeadLetters: 1, claudeTokensToday: 0, freeModelTokensToday: 0 });
  expect(demoDashboard(rangeOf('7d')).window).toMatchObject({ from: '2026-10-11', to: '2026-10-17', received: 11 });
  expect(demoDashboard(rangeOf('8w')).window).toMatchObject({ from: '2026-08-23', to: '2026-10-17', received: 11 });
  expect(DEMO_OVERVIEW_NOTE).toBe('The sample covers one week: its 11 invoices arrived on Oct 17, 2026.');
});
