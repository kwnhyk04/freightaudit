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
// The eleven exported invoices, all received on 2026-10-17, add to the generated history (lib/demo-history.json, from
// scripts/demo-history.ts with a fixed seed) over the four weeks to that day; these are the figures the two make together.
test("the sample's overview ends on its newest day and counts its eleven invoices with the generated four weeks before", () => {
  const month = demoDashboard(rangeOf('4w'));
  expect(month.window).toEqual({
    from: '2026-09-20',
    to: '2026-10-17',
    received: 1_330,
    matchedRateCard: 620,
    overbilledCents: 13_123_077,
    overbilledInvoices: 427,
    timed: 1_330,
    processingP50Ms: 12_885,
    processingP95Ms: 81_377,
    modelCostPerInvoiceMicroUsd: null,
  });
  // Nothing before the four weeks, so the change notes say none.
  expect(month.previous).toEqual({ received: 0, overbilledCents: 0 });
  // The weeks hold the four, the first of them from its Sunday; the four weeks before are empty.
  expect(month.weeks.map((week) => week.received > 0)).toEqual([false, false, false, true, true, true, true, true]);
  expect(month.weeks.reduce((sum, week) => sum + week.received, 0)).toBe(1_330);
  // 28 uneven days: two quiet Sundays, the rest about 40 to 60, the last with the eleven; overbilling on most days.
  expect(month.days).toHaveLength(28);
  const quiet = month.days.filter((day) => day.received < 10).map((day) => day.day);
  expect(quiet).toEqual(['2026-10-04', '2026-10-11']);
  expect(month.days.filter((day) => !quiet.includes(day.day)).every((day) => day.received >= 38 && day.received <= 62)).toBe(true);
  expect(new Set(month.days.map((day) => day.received)).size).toBeGreaterThan(15);
  expect(month.days.filter((day) => day.overbilledCents > 0).length).toBeGreaterThan(20);
  // Shares a reviewer would believe: about half matched, a few failed.
  expect([month.window.matchedRateCard / month.window.received, month.days.reduce((sum, day) => sum + day.failed, 0) / month.window.received].map((share) => Math.round(share * 100))).toEqual([47, 3]);
  expect(month.carriers.map((row) => row.carrier)).toHaveLength(5);
  expect(month.carriers.every((row, i) => i === 0 || row.overbilledCents <= month.carriers[i - 1]!.overbilledCents)).toBe(true);
  // No invoice waits to be read and one dead letter is open; the sample made no model calls.
  expect(month.pipeline).toEqual({ waitingToBeRead: 0, openDeadLetters: 1, claudeTokensToday: 0, freeModelTokensToday: 0 });
  expect(demoDashboard(rangeOf('7d')).window).toMatchObject({ from: '2026-10-11', to: '2026-10-17' });
  expect(demoDashboard(rangeOf('8w')).window).toMatchObject({ from: '2026-08-23', to: '2026-10-17', received: 1_330 });
  expect(DEMO_OVERVIEW_NOTE).toBe('Sample data from Sep 20 to Oct 17, 2026: 11 invoices you can open, plus 1,319 generated ones that only feed these charts.');
});
