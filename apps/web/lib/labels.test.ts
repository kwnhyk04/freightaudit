import type { InvoiceQuery } from '@freightaudit/contracts/graphql';
import {
  decideWords,
  decisionLabel,
  decisionQuestion,
  duplicateNote,
  duration,
  FILTERS,
  filterCount,
  findingText,
  findingTitle,
  firstParams,
  invoiceAmounts,
  listFilter,
  isExampleData,
  lineAmounts,
  lineLabel,
  modelName,
  openFindingsNote,
  reviewReason,
  statusLabel,
  statusReason,
  statusTotals,
  trailRows,
  uploadState,
} from './labels.ts';

type Detail = NonNullable<InvoiceQuery['invoice']>;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, 0, seconds * 1000)).toISOString();
const move = (seconds: number, from: string, to: string, detail: string | null = null, actor: string | null = null) => ({
  id: `${seconds}`,
  at: at(seconds),
  actor,
  action: 'STATUS_CHANGED' as const,
  detail,
  changes: [{ field: 'status', from, to }],
});

test('a description printed in capitals reads in sentence case; any other stays as read', () => {
  expect(lineLabel('FUEL SURCHARGE')).toBe('Fuel surcharge');
  expect(lineLabel('Liftgate service')).toBe('Liftgate service');
  expect(lineLabel('LINEHAUL 4,200 LB')).toBe('Linehaul 4,200 lb');
});

test('a finding title names the line and what is wrong with it, or the type alone without a line', () => {
  expect(findingTitle('RATE_MISMATCH', 'FUEL SURCHARGE')).toBe('Fuel surcharge above the rate card');
  expect(findingTitle('UNCONTRACTED_CHARGE', 'Residential delivery')).toBe('Residential delivery charged, but not on the rate card');
  expect(findingTitle('DUPLICATE_CHARGE', 'Fuel surcharge')).toBe('Fuel surcharge billed twice');
  expect(findingTitle('RATE_MISMATCH')).toBe('Rate mismatch');
  expect(findingTitle('DUPLICATE_INVOICE')).toBe('Possible duplicate invoice');
});

test("a decision reads in its finding's words: a charge is disputed or approved, a possible duplicate confirmed or not", () => {
  expect(decideWords('UNCONTRACTED_CHARGE')).toEqual({ dismiss: 'Approve charge', confirm: 'Dispute' });
  expect(decideWords('DUPLICATE_INVOICE')).toEqual({ dismiss: 'Not a duplicate', confirm: 'Confirm duplicate' });
  expect(decisionLabel('CONFIRMED', 'DUPLICATE_CHARGE')).toEqual({ label: 'Disputed', tone: 'neutral' });
  expect(decisionLabel('DISMISSED', 'RATE_MISMATCH')).toEqual({ label: 'Charge approved', tone: 'ok' });
  expect(decisionLabel('CONFIRMED', 'DUPLICATE_INVOICE')).toEqual({ label: 'Duplicate confirmed', tone: 'warn' });
  expect(decisionLabel('DISMISSED', 'DUPLICATE_INVOICE')).toEqual({ label: 'Not a duplicate', tone: 'ok' });
  expect(decisionLabel('OPEN', 'DUPLICATE_INVOICE')).toEqual({ label: 'Open', tone: 'bad' });
  // A finding closed with its rejected invoice was never decided, whatever its type.
  expect(decisionLabel('CLOSED', 'DUPLICATE_CHARGE')).toEqual({ label: 'Closed with the invoice', tone: 'neutral' });
  expect(decisionLabel('CLOSED', 'DUPLICATE_INVOICE')).toEqual({ label: 'Closed with the invoice', tone: 'neutral' });
});

test("the trail names each decision in its finding's words, found by the moment it was made, and a closed finding plainly", () => {
  const decided = (seconds: number, action: string, from: string, to: string, detail: string | null = null) => ({
    id: `d${seconds}`,
    at: at(seconds),
    actor: 'reviewer',
    action,
    detail,
    changes: [{ field: 'status', from, to }],
  });
  // A charge disputed; the duplicate confirmed, then found not to be one; the invoice rejected with an open charge.
  const invoice = {
    status: 'REJECTED',
    auditTrail: [
      decided(10, 'DISCREPANCY_CONFIRMED', 'open', 'confirmed'),
      decided(20, 'DISCREPANCY_CONFIRMED', 'open', 'confirmed'),
      decided(30, 'DISCREPANCY_DISMISSED', 'confirmed', 'dismissed'),
      decided(40, 'DISCREPANCY_CLOSED', 'open', 'closed', 'the invoice was rejected'),
      { ...decided(40, 'REJECTED', 'reconciled', 'rejected', 'Same invoice as first-scan.pdf'), id: 'r' },
    ],
  } as unknown as Detail;
  const findings = [
    { type: 'RATE_MISMATCH' as const, resolvedAt: at(10) },
    { type: 'DUPLICATE_INVOICE' as const, resolvedAt: at(30) },
    { type: 'DUPLICATE_CHARGE' as const, resolvedAt: at(40) },
  ];
  const words = (rows: ReturnType<typeof trailRows>) => rows.map(({ verb, notes }) => [verb, notes]);
  expect(words(trailRows(invoice, findings))).toEqual([
    ['Overcharge disputed', []],
    // A decision a later one replaced matches no finding's time, so it names no kind.
    ['Finding confirmed', []],
    ['Marked not a duplicate', ['Changed from Duplicate confirmed']],
    ['Finding closed', ['The invoice was rejected']],
    ['Rejected', ['Status: Checked to Rejected', 'Same invoice as first-scan.pdf']],
  ]);
  // With no possible duplicate on the invoice, every decision is a charge's, matched or not.
  expect(trailRows(invoice, [findings[0]!])[1]!.verb).toBe('Overcharge disputed');
});

test('a finding names its line as the invoice prints it, not by its charge code', () => {
  const finding = (type: 'RATE_MISMATCH' | 'UNCONTRACTED_CHARGE' | 'DUPLICATE_CHARGE', expectedCents: number, billedCents: number) => ({
    type,
    evidence: 'Stored text with CODE.',
    expectedCents,
    billedCents,
  });
  expect(findingText(finding('UNCONTRACTED_CHARGE', 0, 16025), { description: 'INSIDE DELIVERY' }, 1, 'USD')).toBe('Inside delivery is not on rate card version 1.');
  expect(findingText(finding('RATE_MISMATCH', 534360, 614514), { description: 'LINEHAUL' }, 2, 'USD')).toBe('Rate card version 2 sets Linehaul at $5,343.60; billed $6,145.14.');
  expect(findingText(finding('DUPLICATE_CHARGE', 0, 3806), { description: 'Fuel surcharge' }, 1, 'USD')).toBe('Fuel surcharge is billed twice.');
  // Without the version, as in the review queue, the sentence says "the rate card"; without a line, the stored text stands.
  expect(findingText(finding('UNCONTRACTED_CHARGE', 0, 9500), { description: 'Liftgate service' }, undefined, 'USD')).toBe('Liftgate service is not on the rate card.');
  expect(findingText(finding('RATE_MISMATCH', 34720, 39680), { description: 'FUEL SURCHARGE' }, undefined, 'USD')).toBe('The rate card sets Fuel surcharge at $347.20; billed $396.80.');
  expect(findingText(finding('RATE_MISMATCH', 34720, 39680), null, 1, 'USD')).toBe('Stored text with CODE.');
});

test('a repeated URL parameter reads as its first value, so a pasted link cannot break a page', async () => {
  expect(await firstParams(Promise.resolve({ q: ['a', 'b'], status: 'reconciled', after: undefined }))).toEqual({ q: 'a', status: 'reconciled', after: undefined });
});

test('a review reason is a sentence on the invoice and a short phrase in a list row', () => {
  expect(reviewReason('no_shipment_match')).toBe('No shipment matches this carrier and PRO number.');
  expect(reviewReason('no_shipment_match', true)).toBe('No shipment matches');
  expect(reviewReason('unsupported_currency: CAD', true)).toBe('Billed in CAD');
  expect(reviewReason('fallback_page_cap', true)).toBe('Too many scanned pages');
  expect(reviewReason(null, true)).toBe('Reading not trusted');
  expect(reviewReason('lines[0].amount: expected number', true)).toBe('Reading failed its checks');
});

test('a list row explains its status: open findings, the review or failure reason, or the step in progress', () => {
  const row = { openDiscrepancyCount: 0, reviewReason: null, failureReason: null, findings: 0 };
  expect(statusReason({ ...row, status: 'RECONCILED', openDiscrepancyCount: 2, findings: 2 })).toBe('2 open findings');
  expect(statusReason({ ...row, status: 'RECONCILED', openDiscrepancyCount: 1, findings: 3 })).toBe('1 open finding');
  expect(statusReason({ ...row, status: 'RECONCILED', findings: 1 })).toBe('Findings decided');
  expect(statusReason({ ...row, status: 'RECONCILED' })).toBe('Matched the rate card');
  expect(statusReason({ ...row, status: 'NEEDS_REVIEW', reviewReason: 'unsupported_currency: CAD' })).toBe('Billed in CAD');
  expect(statusReason({ ...row, status: 'FAILED', failureReason: 'shipment has no miles' })).toBe('Shipment has no miles');
  expect(statusReason({ ...row, status: 'EXTRACTING' })).toBe('Reading the document');
  expect(statusReason({ ...row, status: 'EXTRACTED' })).toBe('Waiting to be checked');
  expect(statusReason({ ...row, status: 'REJECTED' })).toBe('Rejected by a reviewer');
  expect(statusReason({ ...row, status: 'APPROVED' })).toBeNull();
});

test('a status reads in plain words; a checked invoice says whether billing issues wait or it is ready to approve', () => {
  expect(statusLabel('RECONCILED', 2)).toBe('Billing issues (2)');
  expect(statusLabel('RECONCILED', 0)).toBe('Ready to approve');
  // A confirmed duplicate is never approved, whatever else is open.
  expect(statusLabel('RECONCILED', 2, true)).toBe('Confirmed duplicate');
  expect(statusLabel('EXTRACTING', 0)).toBe('Reading');
  expect(statusLabel('EXTRACTED', 0)).toBe('Checking');
  expect(statusLabel('RECONCILING', 0)).toBe('Checking');
  expect(statusLabel('NEEDS_REVIEW', 1)).toBe('Reading needs a check');
});

test('an exact duplicate upload names the invoice it already is, by its number or else its file name, on its day in UTC', () => {
  // 23:30 UTC on Oct 17 is already Oct 18 east of UTC, so the day must be read in UTC.
  expect(duplicateNote({ number: '98211354', filename: 'digital.pdf', createdAt: '2026-10-17T23:30:00.000Z' })).toBe(
    'Already uploaded as invoice 98211354 on Oct 17, 2026. Nothing new was created.',
  );
  expect(duplicateNote({ number: null, filename: 'photo.png', createdAt: '2026-10-18T08:00:00.000Z' })).toBe(
    'Already uploaded as photo.png on Oct 18, 2026. Nothing new was created.',
  );
});

const received = { action: 'RECEIVED' as const };
test('a seeded invoice, with no stored PDF and only the Received entry, is example data', () => {
  expect(isExampleData({ stored: false, trail: [received] })).toBe(true);
});

test('a real upload still waiting, with its PDF stored and only the Received entry, is not example data', () => {
  expect(isExampleData({ stored: true, trail: [received] })).toBe(false);
});

test('an invoice with no stored PDF whose trail has pipeline rows is not example data', () => {
  expect(isExampleData({ stored: false, trail: [received, { action: 'STATUS_CHANGED' as const }] })).toBe(false);
});

test('status counts give every tab, the invoices waiting for a decision and those still processing', () => {
  const totals = statusTotals([
    { status: 'RECONCILED', count: 8 },
    { status: 'NEEDS_REVIEW', count: 4 },
    { status: 'EXTRACTING', count: 2 },
    { status: 'RECEIVED', count: 1 },
    { status: 'APPROVED', count: 20 },
  ]);
  expect(totals).toMatchObject({ all: 35, waiting: 12, processing: 3 });
  expect(totals.count('FAILED')).toBe(0);
  expect(totals.count('APPROVED')).toBe(20);
});

test('a list filter is a tab by its key, any other status without a tab, or all; checked invoices split by open findings', () => {
  expect(listFilter('billing_issues')).toMatchObject({ status: 'RECONCILED', open: true, label: 'Billing issues' });
  expect(listFilter('READY_TO_APPROVE')).toMatchObject({ status: 'RECONCILED', open: false, label: 'Ready to approve' });
  expect(listFilter('needs_review')).toMatchObject({ key: 'needs_review', status: 'NEEDS_REVIEW' });
  // A status with no tab of its own, such as an older link to every checked invoice, still filters.
  expect(listFilter('reconciled')).toEqual({ key: 'reconciled', status: 'RECONCILED', label: 'Checked' });
  expect(listFilter('extracting')).toMatchObject({ key: 'extracting', status: 'EXTRACTING' });
  expect([listFilter('nonsense'), listFilter(undefined)]).toEqual([FILTERS[0], FILTERS[0]]);
  // Findings are open only on checked invoices: those with one are billing issues, the rest are ready to approve.
  const totals = statusTotals([
    { status: 'RECONCILED', count: 8 },
    { status: 'NEEDS_REVIEW', count: 4 },
    { status: 'APPROVED', count: 20 },
  ]);
  expect(FILTERS.map((filter) => [filter.label, filterCount(filter, totals, 3)])).toEqual([
    ['All', 32],
    ['Reading needs a check', 4],
    ['Billing issues', 3],
    ['Ready to approve', 5],
    ['Failed', 0],
    ['Approved', 20],
    ['Rejected', 0],
    ['Received', 0],
    ['Checking', 0],
  ]);
  expect(filterCount(listFilter('reconciled'), totals, 3)).toBe(8);
});

test('the open findings card says how many invoices wait and for how long', () => {
  const now = Date.parse(at(0));
  const summary = { openFindings: 9, invoicesWithOpenFindings: 6, oldestOpenFindingAt: new Date(now - 2.5 * 86_400_000).toISOString() };
  expect(openFindingsNote(summary, now)).toBe('On 6 invoices, the oldest waiting 2 days');
  expect(openFindingsNote({ ...summary, invoicesWithOpenFindings: 1, oldestOpenFindingAt: new Date(now - 3_600_000).toISOString() }, now)).toBe(
    'On 1 invoice, the oldest waiting under a day',
  );
  expect(openFindingsNote({ openFindings: 0, invoicesWithOpenFindings: 0, oldestOpenFindingAt: null }, now)).toBe('Nothing waits for a decision');
});

test('a duration reads in seconds, then minutes, then hours', () => {
  expect(duration(3_350)).toBe('3.4 s');
  expect(duration(-5)).toBe('0.0 s');
  expect(duration(12 * 60_000)).toBe('12 min');
  expect(duration(5 * 3_600_000)).toBe('5 h');
});

test('money for review comes from the domain: what stands, what the rate card allows, and each line', () => {
  const findings = [
    { status: 'OPEN' as const, billedCents: 39_680, expectedCents: 34_720 },
    { status: 'DISMISSED' as const, billedCents: 9_500, expectedCents: 0 },
  ];
  expect(invoiceAmounts(173_180, findings)).toEqual({ openCents: 4_960n, standingCents: 4_960n, expectedCents: 168_220n });
  expect(lineAmounts(39_680, findings[0])).toEqual({ expectedCents: 34_720n, differenceCents: 4_960n });
  expect(lineAmounts(9_500, findings[1])).toEqual({ expectedCents: 9_500n, differenceCents: 0n });
  expect(lineAmounts(124_000)).toEqual({ expectedCents: 124_000n, differenceCents: 0n });
});

test('each bulk decision asks first, naming what it does and the amount approved or disputed', () => {
  const amounts = { openCents: 14_460n, standingCents: 14_460n, expectedCents: 158_720n };
  expect(decisionQuestion('APPROVE_AT_RATE_CARD', 2, 173_180, amounts, 'USD')).toBe(
    'Approve at rate card? 2 open findings are disputed and $1,587.20 is approved for payment.',
  );
  expect(decisionQuestion('APPROVE_AS_BILLED', 1, 173_180, amounts, 'USD')).toBe(
    'Approve as billed? 1 open finding is dismissed and $1,731.80 is approved for payment.',
  );
  expect(decisionQuestion('DISPUTE', 2, 173_180, amounts, 'USD')).toBe('Dispute $144.60? 2 open findings are disputed and the invoice waits for approval.');
});

test('the audit trail reads as plain words: who read it with which model and how fast, what it matched, and what follows', () => {
  const invoice = {
    extraction: { model: 'gemini/gemini-3.5-flash-lite', step: 'repair' },
    shipment: { reference: 'SHP-000413' },
    carrier: 'Bramblewood Express',
    rateCardVersion: { version: 2 },
    auditTrail: [
      { id: 'r', at: at(0), actor: null, action: 'RECEIVED' as const, detail: 'g066.pdf', changes: [] },
      move(1, 'received', 'extracting'),
      {
        ...move(4.3, 'extracting', 'extracted', 'normalized'),
        changes: [
          { field: 'status', from: 'extracting', to: 'extracted' },
          { field: 'carrier', from: 'BRAMBLEWOOD EXPRESS', to: 'Bramblewood Express' },
        ],
      },
      move(5, 'extracted', 'reconciling'),
      move(6, 'reconciling', 'reconciled'),
      {
        id: 'd',
        at: at(9),
        actor: 'reviewer',
        action: 'DISCREPANCY_CONFIRMED' as const,
        detail: 'Contract rate applies',
        changes: [{ field: 'status', from: 'open', to: 'confirmed' }],
      },
    ],
  } as unknown as Detail;
  const words = (rows: ReturnType<typeof trailRows>) => rows.map(({ verb, rest, notes }) => [verb, rest, notes]);
  expect(words(trailRows(invoice, [{ type: 'RATE_MISMATCH', resolvedAt: at(9) }]))).toEqual([
    ['Received', 'by the pipeline', ['g066.pdf']],
    ['Reading started', '', []],
    ['Read', 'by Gemini 3.5 Flash-Lite in 3.3 s', ['after 1 repair', 'Carrier read as “BRAMBLEWOOD EXPRESS”, matched Bramblewood Express after normalizing case and spacing']],
    ['Checking started', '', []],
    ['Matched', 'to shipment SHP-000413 and Bramblewood Express, checked against rate card version 2 by rules in code', ['1 finding, so it waits for a reviewer']],
    ['Overcharge disputed', 'by reviewer', ['Contract rate applies']],
  ]);
  const review = {
    ...invoice,
    extraction: { model: 'groq/qwen/qwen3.8-27b', step: 'fallback' },
    auditTrail: [
      move(1, 'received', 'extracting'),
      move(2, 'extracting', 'extracted'),
      move(3, 'extracted', 'reconciling'),
      move(4, 'reconciling', 'needs_review', 'no_shipment_match'),
      move(9, 'failed', 'received', null, 'reviewer'),
    ],
  } as unknown as Detail;
  expect(words(trailRows(review, []))).toEqual([
    ['Reading started', '', []],
    ['Read', 'by Qwen3.8 27B in 1.0 s', ['on the fallback model']],
    ['Checking started', '', []],
    ['Sent to review', 'by the pipeline', ['No shipment matches this carrier and PRO number.']],
    ['Status changed', 'by reviewer', ['Failed to Received']],
  ]);
  const clean = { ...invoice, auditTrail: [move(6, 'reconciling', 'reconciled')] } as unknown as Detail;
  expect(trailRows(clean, [])[0]!.notes).toEqual(['No findings, so it waits only for approval']);
  // Example data has only its Received entry, whose note says the seed set the status and no one decided it.
  const seeded = { ...invoice, status: 'APPROVED', auditTrail: invoice.auditTrail.slice(0, 1) } as unknown as Detail;
  expect(trailRows(seeded, [], true)[0]!.notes).toEqual(['g066.pdf', 'Approved in the example data; no reviewer decision is recorded.']);
  expect(trailRows({ ...seeded, status: 'RECONCILED' }, [], true)[0]!.notes).toEqual(['g066.pdf', 'Example data: the seed set this status; no pipeline or reviewer record exists.']);
  expect(modelName('someone/new-model')).toBe('someone/new-model');
});

test('a recent upload shows its step while in flight, then how long it took and the result', () => {
  const now = Date.parse(at(1.4));
  const base = { createdAt: at(0), currency: 'USD', totalCents: 173_180, reviewReason: null, failureReason: null, discrepancies: { edges: [] }, auditTrail: [] };
  expect(uploadState({ ...base, status: 'EXTRACTING' }, now)).toEqual({ step: 1, result: 'Working, 1.4 s so far', tone: 'faint' });
  expect(uploadState({ ...base, status: 'RECEIVED' }, now).step).toBe(1);
  expect(uploadState({ ...base, status: 'RECONCILING' }, now).step).toBe(2);
  const settled = { ...base, auditTrail: [{ id: 'x', at: at(3.4), action: 'STATUS_CHANGED' as const, changes: [{ field: 'status', to: 'reconciled' }] }] };
  const finding = { node: { id: 'f', status: 'OPEN' as const, billedCents: 39_680, expectedCents: 25_220 } };
  expect(uploadState({ ...settled, status: 'RECONCILED', discrepancies: { edges: [finding] } }, now)).toEqual({
    done: 'Done in 3.4 s',
    result: 'Billing issues (1), +$144.60 over the rate card',
    tone: 'accent',
  });
  // A disputed finding still stands over the rate card, but no billing issue is left open.
  const disputed = { node: { ...finding.node, status: 'CONFIRMED' as const } };
  expect(uploadState({ ...settled, status: 'RECONCILED', discrepancies: { edges: [disputed] } }, now)).toMatchObject({ result: 'Ready to approve, +$144.60 over the rate card' });
  expect(uploadState({ ...settled, status: 'RECONCILED' }, now)).toMatchObject({ result: 'Ready to approve, matched the rate card', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'NEEDS_REVIEW', reviewReason: 'no_shipment_match' }, now)).toMatchObject({
    result: 'Reading needs a check: No shipment matches',
    tone: 'warn',
  });
  expect(uploadState({ ...base, status: 'FAILED', failureReason: 'shipment has no miles' }, now)).toEqual({ done: 'Done', result: 'Failed: Shipment has no miles', tone: 'bad' });
  expect(uploadState({ ...settled, status: 'APPROVED' }, now)).toMatchObject({ result: 'Approved', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'REJECTED' }, now)).toMatchObject({ result: 'Rejected', tone: 'faint' });
});
