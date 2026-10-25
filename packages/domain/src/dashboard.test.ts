import fc from 'fast-check';
import { type DashboardInvoice, dashboardOf, dashboardSpan, type FindingAmounts, outcomeOf } from './index.ts';

fc.configureGlobal({ seed: 42, numRuns: 1_000 });

const at = (iso: string) => new Date(iso);
const invoice = (overrides: Partial<DashboardInvoice> = {}): DashboardInvoice => ({
  receivedAt: at('2026-10-14T10:00:00Z'),
  status: 'reconciled',
  carrier: 'Halcyon Ridge Freight',
  shipment: true,
  corrected: false,
  settledAt: null,
  findings: [],
  ...overrides,
});
const finding = (status: FindingAmounts['status'], billedCents: bigint, expectedCents = 0n): FindingAmounts => ({ status, billedCents, expectedCents });
const WEEKS = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];

test('a checked invoice matched the rate card only with a shipment, no finding at all and no correction', () => {
  expect(outcomeOf(invoice())).toBe('matched');
  expect(outcomeOf(invoice({ status: 'approved' }))).toBe('matched');
  expect(outcomeOf(invoice({ findings: [finding('dismissed', 500n)] }))).toBe('reviewer');
  expect(outcomeOf(invoice({ findings: [finding('open', 0n)] }))).toBe('reviewer');
  // Approved as billed from review: no shipment, so never checked against the rate card.
  expect(outcomeOf(invoice({ status: 'approved', shipment: false }))).toBe('reviewer');
  expect(outcomeOf(invoice({ corrected: true }))).toBe('reviewer');
  expect(outcomeOf(invoice({ status: 'needs_review', shipment: false }))).toBe('reviewer');
  expect(outcomeOf(invoice({ status: 'rejected' }))).toBe('reviewer');
  expect(outcomeOf(invoice({ status: 'failed', shipment: false }))).toBe('failed');
  for (const status of ['received', 'extracting', 'extracted', 'reconciling'] as const) expect(outcomeOf(invoice({ status, shipment: false }))).toBeNull();
});

test('the window counts the days from from to to, both whole, and the same number of days before it', () => {
  const invoices = [
    // Every finding but a dismissed one stands, as the invoice list's Difference counts them: 6,000 + 2,000 + 700.
    invoice({ carrier: 'Copperline Haulage', findings: [finding('open', 10_000n, 4_000n), finding('confirmed', 2_000n), finding('dismissed', 5_000n), finding('closed', 700n)] }),
    // A possible duplicate bills nothing above the rate card.
    invoice({ findings: [finding('open', 0n)] }),
    invoice({ receivedAt: at('2026-10-12T00:00:00.000Z') }),
    invoice({ receivedAt: at('2026-10-18T23:59:59.999Z'), status: 'failed', shipment: false }),
    invoice({ receivedAt: at('2026-10-11T23:59:59.999Z'), findings: [finding('open', 900n)] }),
    invoice({ receivedAt: at('2026-10-19T00:00:00.000Z') }),
    invoice({ receivedAt: at('2026-10-04T23:59:59.999Z') }),
  ];
  const { window, previous } = dashboardOf(invoices, '2026-10-12', '2026-10-18');
  expect(window).toEqual({
    from: '2026-10-12',
    to: '2026-10-18',
    received: 4,
    matchedRateCard: 1,
    overbilledCents: 8_700n,
    overbilledInvoices: 1,
    timed: 0,
    processingP50Ms: null,
    processingP95Ms: null,
  });
  expect(previous).toMatchObject({ from: '2026-10-05', to: '2026-10-11', received: 1, overbilledCents: 900n, overbilledInvoices: 1 });
  expect(dashboardOf(invoices, '2026-09-21', '2026-10-18').previous).toMatchObject({ from: '2026-08-24', to: '2026-09-20', received: 0 });
});

test('eight weeks, Monday to Sunday in UTC, end with the week of to, oldest first', () => {
  const invoices = [
    invoice({ receivedAt: at('2026-10-11T23:59:59.999Z'), findings: [finding('confirmed', 1_619n)] }),
    invoice({ receivedAt: at('2026-10-12T00:00:00.000Z') }),
    invoice({ receivedAt: at('2026-10-17T07:22:49.121Z'), status: 'needs_review', shipment: false }),
    invoice({ receivedAt: at('2026-10-17T07:24:00.000Z'), status: 'failed', shipment: false }),
    invoice({ receivedAt: at('2026-10-17T07:25:00.000Z'), status: 'extracting', shipment: false }),
    invoice({ receivedAt: at('2026-08-24T00:00:00.000Z'), findings: [finding('open', 1_249n)] }),
    invoice({ receivedAt: at('2026-08-23T23:59:59.999Z') }),
  ];
  // to on a Saturday; the window does not change the weeks.
  const { weeks } = dashboardOf(invoices, '2026-10-17', '2026-10-17');
  expect(weeks.map((week) => week.start)).toEqual(WEEKS);
  const week = (start: string) => weeks.find((each) => each.start === start);
  expect(week('2026-10-12')).toEqual({ start: '2026-10-12', matchedRateCard: 1, neededReviewer: 1, failed: 1, overbilledCents: 0n });
  expect(week('2026-10-05')).toEqual({ start: '2026-10-05', matchedRateCard: 0, neededReviewer: 1, failed: 0, overbilledCents: 1_619n });
  expect(week('2026-08-24')).toEqual({ start: '2026-08-24', matchedRateCard: 0, neededReviewer: 1, failed: 0, overbilledCents: 1_249n });
  expect(weeks.filter((each) => !['2026-10-12', '2026-10-05', '2026-08-24'].includes(each.start)).every((each) => each.matchedRateCard + each.neededReviewer + each.failed === 0)).toBe(true);
  expect(dashboardOf([], '2026-10-12', '2026-10-12').weeks.map((each) => each.start)).toEqual(WEEKS);
});

test('processing time is the nearest-rank median and 95th percentile of the timed invoices', () => {
  const timed = (seconds: number[]) =>
    dashboardOf(
      seconds.map((each) => invoice({ settledAt: new Date(Date.parse('2026-10-14T10:00:00Z') + each * 1_000) })),
      '2026-10-12',
      '2026-10-18',
    ).window;
  expect(timed([5])).toMatchObject({ timed: 1, processingP50Ms: 5_000, processingP95Ms: 5_000 });
  expect(timed([3, 1])).toMatchObject({ timed: 2, processingP50Ms: 1_000, processingP95Ms: 3_000 });
  expect(timed(Array.from({ length: 20 }, (_, i) => 20 - i))).toMatchObject({ timed: 20, processingP50Ms: 10_000, processingP95Ms: 19_000 });
  // An invoice the pipeline has not settled, or one from before the audit trail, is not timed.
  const window = dashboardOf([invoice({ settledAt: at('2026-10-14T10:00:02.500Z') }), invoice()], '2026-10-12', '2026-10-18').window;
  expect(window).toMatchObject({ received: 2, timed: 1, processingP50Ms: 2_500, processingP95Ms: 2_500 });
});

test('the carriers are the five that bill most above the rate card in the window, ties by name', () => {
  const billed = (carrier: string | null, cents: bigint, status: FindingAmounts['status'] = 'open') => invoice({ carrier, findings: [finding(status, cents)] });
  const invoices = [
    billed('Tern & Tide Carriers', 500n),
    billed('Nimbus Road Lines', 900n),
    billed('Copperline Haulage', 400n),
    billed('Copperline Haulage', 500n),
    billed('Quarry Lane Transport', 100n),
    billed('Bramblewood Express', 300n),
    billed('Halcyon Ridge Freight', 700n),
    billed('Halcyon Ridge Freight', 0n),
    billed('Granite Pass Logistics', 800n, 'dismissed'),
    billed(null, 5_000n),
    invoice({ carrier: 'Nimbus Road Lines', receivedAt: at('2026-10-11T12:00:00Z'), findings: [finding('open', 9_000n)] }),
  ];
  expect(dashboardOf(invoices, '2026-10-12', '2026-10-18').carriers).toEqual([
    { carrier: 'Copperline Haulage', overbilledCents: 900n, invoices: 2 },
    { carrier: 'Nimbus Road Lines', overbilledCents: 900n, invoices: 1 },
    { carrier: 'Halcyon Ridge Freight', overbilledCents: 700n, invoices: 1 },
    { carrier: 'Tern & Tide Carriers', overbilledCents: 500n, invoices: 1 },
    { carrier: 'Bramblewood Express', overbilledCents: 300n, invoices: 1 },
  ]);
  expect(dashboardOf([], '2026-10-12', '2026-10-18').carriers).toEqual([]);
});

test('the figures read from the earliest of the previous window and the first week to the end of to', () => {
  expect(dashboardSpan('2026-10-12', '2026-10-18')).toEqual({ start: at('2026-08-24T00:00:00Z'), end: at('2026-10-19T00:00:00Z') });
  expect(dashboardSpan('2026-08-24', '2026-10-18')).toEqual({ start: at('2026-06-29T00:00:00Z'), end: at('2026-10-19T00:00:00Z') });
});

test('over the eight weeks themselves, the weeks add up to the window', () => {
  const day = Date.parse('2026-08-24T00:00:00Z');
  const status = fc.constantFrom<DashboardInvoice['status']>('received', 'extracting', 'extracted', 'reconciling', 'reconciled', 'needs_review', 'approved', 'rejected', 'failed');
  const decision = fc.constantFrom<FindingAmounts['status']>('open', 'confirmed', 'dismissed', 'closed');
  const any = fc.record({
    offset: fc.integer({ min: -86_400_000, max: 57 * 86_400_000 }),
    status,
    shipment: fc.boolean(),
    corrected: fc.boolean(),
    findings: fc.array(fc.record({ status: decision, billed: fc.bigInt({ min: 0n, max: 10n ** 9n }) }), { maxLength: 3 }),
  });
  fc.assert(
    fc.property(fc.array(any, { maxLength: 30 }), (drawn) => {
      const invoices = drawn.map(({ offset, findings, ...rest }) => invoice({ ...rest, receivedAt: new Date(day + offset), findings: findings.map((each) => finding(each.status, each.billed)) }));
      const { window, weeks } = dashboardOf(invoices, '2026-08-24', '2026-10-18');
      const settled = invoices.filter((each) => each.receivedAt.getTime() >= day && each.receivedAt.getTime() < day + 56 * 86_400_000 && outcomeOf(each) !== null).length;
      return (
        weeks.reduce((sum, week) => sum + week.overbilledCents, 0n) === window.overbilledCents &&
        weeks.reduce((sum, week) => sum + week.matchedRateCard, 0) === window.matchedRateCard &&
        weeks.reduce((sum, week) => sum + week.matchedRateCard + week.neededReviewer + week.failed, 0) === settled
      );
    }),
  );
});
