import type { InvoiceQuery } from '@freightaudit/contracts/graphql';
import {
  ALREADY_BILLED,
  alreadyBilled,
  type BilledBefore,
  billedBefore,
  decideWords,
  decisionLabel,
  decisionQuestion,
  duplicateNote,
  duration,
  FILTERS,
  filterCount,
  finishedNote,
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
  rebilledText,
  rebillNote,
  refusal,
  resultBadge,
  reviewReason,
  statusLabel,
  statusReason,
  statusTotals,
  trailRows,
  unmatchedNote,
  uploadState,
  type Words,
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

test('a possible duplicate closed because its corrected reading matches no other invoice reads so, by its closing row', () => {
  expect(decisionLabel('CLOSED', 'DUPLICATE_INVOICE', 'the corrected reading matches no other invoice')).toEqual({ label: 'Closed: reading corrected', tone: 'ok' });
  expect(decisionLabel('CLOSED', 'DUPLICATE_INVOICE', 'the invoice was rejected')).toEqual({ label: 'Closed with the invoice', tone: 'neutral' });
});

test("the trail names each decision in the words of the finding it names, a replaced one included, and a closed finding plainly", () => {
  const decided = (seconds: number, action: string, from: string, to: string, discrepancyId: string | null, detail: string | null = null) => ({
    id: `d${seconds}`,
    at: at(seconds),
    actor: 'reviewer',
    action,
    detail,
    changes: [{ field: 'status', from, to }],
    discrepancyId,
  });
  // A charge disputed; the duplicate confirmed, then found not to be one; the invoice rejected with an open charge.
  const invoice = {
    status: 'REJECTED',
    auditTrail: [
      decided(10, 'DISCREPANCY_CONFIRMED', 'open', 'confirmed', 'rate'),
      decided(20, 'DISCREPANCY_CONFIRMED', 'open', 'confirmed', 'duplicate'),
      decided(30, 'DISCREPANCY_DISMISSED', 'confirmed', 'dismissed', 'duplicate'),
      decided(40, 'DISCREPANCY_CLOSED', 'open', 'closed', 'twice', 'the invoice was rejected'),
      { ...decided(40, 'REJECTED', 'reconciled', 'rejected', null, 'Same invoice as first-scan.pdf'), id: 'r' },
    ],
  } as unknown as Detail;
  const findings = [
    { id: 'rate', type: 'RATE_MISMATCH' as const },
    { id: 'duplicate', type: 'DUPLICATE_INVOICE' as const },
    { id: 'twice', type: 'DUPLICATE_CHARGE' as const },
  ];
  const words = (rows: ReturnType<typeof trailRows>) => rows.map(({ verb, notes }) => [verb, notes]);
  expect(words(trailRows(invoice, findings))).toEqual([
    ['Overcharge disputed', []],
    ['Duplicate confirmed', []],
    ['Marked not a duplicate', ['Changed from Duplicate confirmed']],
    ['Finding closed', ['The invoice was rejected']],
    ['Rejected', ['Status: Checked to Rejected', 'Same invoice as first-scan.pdf']],
  ]);
  // A row that names no finding, as the sample's exported before the api named them: a charge's where the invoice has no
  // possible duplicate, else a finding's.
  const unnamed = { ...invoice, auditTrail: invoice.auditTrail.map((entry) => ({ ...entry, discrepancyId: undefined })) } as unknown as Detail;
  expect(trailRows(unnamed, [findings[0]!])[1]!.verb).toBe('Overcharge disputed');
  expect(trailRows(unnamed, findings)[1]!.verb).toBe('Finding confirmed');
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

// A sentence's words as read, and its links to other invoices.
const said = (words?: Words) => (words ?? []).map((part) => (typeof part === 'string' ? part : part.text)).join('');
const linksOf = (words?: Words) => (words ?? []).filter((part) => typeof part !== 'string');
const first = { id: 'e1', number: '74731111', filename: 'g070.pdf', issuedOn: '2026-09-12' };
const second = { id: 'e2', number: '74731222', filename: 'g072.pdf', issuedOn: '2026-09-20' };

test('a duplicate charge was billed first on the earlier invoice the api names, else on an earlier line of its own, else on an unnamed earlier invoice', () => {
  const lines = [
    { lineNumber: 1, chargeCode: 'LINEHAUL' },
    { lineNumber: 2, chargeCode: 'APPOINTMENT' },
    { lineNumber: 3, chargeCode: 'APPOINTMENT' },
    { lineNumber: 4, chargeCode: 'APPOINTMENT' },
    { lineNumber: 5, chargeCode: 'FUEL' },
  ];
  const charge = (lineNumber: number, earlierInvoice: typeof first | null = null) => ({ type: 'DUPLICATE_CHARGE' as const, lineItem: { lineNumber }, earlierInvoice });
  expect(billedBefore(charge(1, first), lines)).toEqual({ invoice: first });
  // A repeat on its own invoice names the first line that billed the code, not the one just before it.
  expect(billedBefore(charge(4), lines)).toEqual({ line: 2 });
  // A code an earlier invoice and an earlier line both billed names the invoice: that is the re-bill.
  expect(billedBefore(charge(3, first), lines)).toEqual({ invoice: first });
  // With neither, an earlier invoice billed it; the sample's findings, exported before the api named it, lack the field.
  expect(billedBefore(charge(5), lines)).toEqual({ unnamed: true });
  expect(billedBefore({ type: 'DUPLICATE_CHARGE', lineItem: { lineNumber: 5 } }, lines)).toEqual({ unnamed: true });
  // A named invoice needs no line; without one and without a name nothing is known, and other findings say nothing.
  expect(billedBefore(charge(9, first), lines)).toEqual({ invoice: first });
  expect(billedBefore(charge(9), lines)).toBeUndefined();
  expect(billedBefore({ type: 'DUPLICATE_CHARGE', lineItem: null, earlierInvoice: null }, lines)).toBeUndefined();
  expect(billedBefore({ type: 'RATE_MISMATCH', lineItem: { lineNumber: 1 }, earlierInvoice: null }, lines)).toBeUndefined();
});

test('a re-billed charge names where it was billed first: an earlier invoice by number or file name with its printed date, linked, or its earlier line', () => {
  const named = rebilledText('LINEHAUL', { invoice: first });
  expect(said(named)).toBe('Linehaul was already billed on invoice 74731111 (Sep 12, 2026) for the same shipment.');
  expect(linksOf(named)).toEqual([{ invoice: 'e1', text: 'invoice 74731111' }]);
  // Read without a number or a date, it goes by its file name, and the date is left out.
  expect(said(rebilledText('Linehaul', { invoice: { ...first, number: null, issuedOn: null } }))).toBe('Linehaul was already billed on g070.pdf for the same shipment.');
  expect(said(rebilledText('DELIVERY APPOINTMENT', { line: 3 }))).toBe('Delivery appointment was already billed on line 3 of this invoice.');
  expect(said(rebilledText('Fuel surcharge', { unnamed: true }))).toBe('Fuel surcharge was already billed on an earlier invoice for the same shipment.');
  // The Expected cell says it in short, with the same link, while the finding stands; one line above the table says why
  // it is $0. Once the charge is approved, its billed amount stands, so the cell shows money again.
  const open = { status: 'OPEN' as const };
  expect(alreadyBilled(open, { invoice: first })).toEqual(['Already billed on ', { invoice: 'e1', text: 'invoice 74731111' }]);
  expect(alreadyBilled(open, { line: 3 })).toEqual(['Already billed on line 3']);
  expect(alreadyBilled(open, { unnamed: true })).toEqual(['Already billed on an earlier invoice']);
  expect(alreadyBilled({ status: 'CONFIRMED' }, { line: 3 })).toEqual(['Already billed on line 3']);
  expect(alreadyBilled({ status: 'CLOSED' }, { line: 3 })).toEqual(['Already billed on line 3']);
  expect(alreadyBilled({ status: 'DISMISSED' }, { invoice: first })).toBeUndefined();
  expect(alreadyBilled(open, undefined)).toBeUndefined();
  expect(ALREADY_BILLED).toBe('Expected is $0 for a charge already billed, on an earlier invoice for this shipment or on an earlier line, so it is not paid twice.');
});

test("a re-bill's header says how many of its lines an earlier invoice billed first, naming each, and that the others are checked as usual", () => {
  const header = (lines: number, befores: BilledBefore[]) => rebillNote('SHP-001426', lines, befores);
  expect(said(header(3, [{ invoice: first }, { invoice: first }, { invoice: first }]))).toBe(
    'Re-bills shipment SHP-001426: 3 of 3 lines were already billed on invoice 74731111 (Sep 12, 2026).',
  );
  expect(linksOf(header(3, [{ invoice: first }, { invoice: first }]))).toEqual([{ invoice: 'e1', text: 'invoice 74731111' }]);
  expect(said(header(4, [{ invoice: first }, { invoice: first }]))).toBe(
    'Re-bills shipment SHP-001426: 2 of 4 lines were already billed on invoice 74731111 (Sep 12, 2026). The other 2 are checked against the rate card as usual.',
  );
  expect(said(header(2, [{ invoice: first }]))).toBe(
    'Re-bills shipment SHP-001426: 1 of 2 lines was already billed on invoice 74731111 (Sep 12, 2026). The other 1 is checked against the rate card as usual.',
  );
  // Lines first billed on different invoices name each, in the order the findings come.
  const both = header(3, [{ invoice: second }, { invoice: first }, { invoice: second }]);
  expect(said(both)).toBe(
    'Re-bills shipment SHP-001426: 3 of 3 lines were already billed on earlier invoices: invoice 74731222 (Sep 20, 2026) and invoice 74731111 (Sep 12, 2026).',
  );
  expect(linksOf(both)).toEqual([
    { invoice: 'e2', text: 'invoice 74731222' },
    { invoice: 'e1', text: 'invoice 74731111' },
  ]);
  // The sample's re-bill names no invoice; a repeat on its own invoice is no re-bill, and neither is an invoice without one.
  expect(said(header(3, [{ unnamed: true }, { unnamed: true }, { unnamed: true }]))).toBe('Re-bills shipment SHP-001426: 3 of 3 lines were already billed on an earlier invoice.');
  expect(header(6, [{ line: 3 }])).toBeUndefined();
  expect(header(6, [])).toBeUndefined();
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

test('a list row explains its status: what holds a checked invoice, the review or failure reason, or the step in progress', () => {
  const row = { openDiscrepancyCount: 0, reviewReason: null, failureReason: null, findings: 0, hold: null, matched: true };
  // A possible duplicate is decided before the charges, and a confirmed one only waits to be rejected.
  expect(statusReason({ ...row, status: 'RECONCILED', hold: 'POSSIBLE_DUPLICATE', openDiscrepancyCount: 2, findings: 2 })).toBe('Possible duplicate to decide');
  expect(statusReason({ ...row, status: 'RECONCILED', hold: 'CONFIRMED_DUPLICATE', findings: 3 })).toBe('Waits to be rejected');
  expect(statusReason({ ...row, status: 'RECONCILED', hold: 'OPEN_FINDINGS', openDiscrepancyCount: 2, findings: 2 })).toBe('2 open findings');
  expect(statusReason({ ...row, status: 'RECONCILED', openDiscrepancyCount: 1, findings: 3 })).toBe('1 open finding');
  expect(statusReason({ ...row, status: 'RECONCILED', findings: 1 })).toBe('Findings decided');
  expect(statusReason({ ...row, status: 'RECONCILED' })).toBe('Matched the rate card');
  // Held at its approval from review, it matched no shipment: once no duplicate, nothing was checked against the rate card.
  expect(statusReason({ ...row, status: 'RECONCILED', findings: 1, matched: false })).toBe('Not checked against the rate card');
  expect(statusReason({ ...row, status: 'RECONCILED', hold: 'POSSIBLE_DUPLICATE', openDiscrepancyCount: 1, findings: 1, matched: false })).toBe('Possible duplicate to decide');
  expect(statusReason({ ...row, status: 'NEEDS_REVIEW', reviewReason: 'unsupported_currency: CAD' })).toBe('Billed in CAD');
  expect(statusReason({ ...row, status: 'FAILED', failureReason: 'shipment has no miles' })).toBe('Shipment has no miles');
  expect(statusReason({ ...row, status: 'EXTRACTING' })).toBe('Reading the document');
  expect(statusReason({ ...row, status: 'EXTRACTED' })).toBe('Waiting to be checked');
  expect(statusReason({ ...row, status: 'REJECTED' })).toBe('Rejected by a reviewer');
  expect(statusReason({ ...row, status: 'APPROVED' })).toBeNull();
  expect(statusReason({ ...row, status: 'APPROVED', matched: false })).toBe('Not checked against the rate card');
});

test('a status reads in plain words; a checked invoice says whether billing issues wait or it is ready to approve', () => {
  expect(statusLabel('RECONCILED', 2, 'OPEN_FINDINGS')).toBe('Billing issues (2)');
  expect(statusLabel('RECONCILED', 0, null)).toBe('Ready to approve');
  // A possible duplicate is one of the billing issues; a confirmed one is never approved, whatever else is open.
  expect(statusLabel('RECONCILED', 2, 'POSSIBLE_DUPLICATE')).toBe('Billing issues (2)');
  expect(statusLabel('RECONCILED', 2, 'CONFIRMED_DUPLICATE')).toBe('Confirmed duplicate');
  expect(statusLabel('RECONCILED', 0, 'CONFIRMED_DUPLICATE')).toBe('Confirmed duplicate');
  // With no matched shipment, as when held at its approval from review, it is approved as billed once nothing holds it.
  expect(statusLabel('RECONCILED', 0, null, false)).toBe('Ready to approve as billed');
  expect(statusLabel('RECONCILED', 1, 'POSSIBLE_DUPLICATE', false)).toBe('Billing issues (1)');
  // Approved with no shipment, from review or after a hold, it was approved as billed.
  expect(statusLabel('APPROVED', 0, null, false)).toBe('Approved as billed');
  expect(statusLabel('APPROVED', 0)).toBe('Approved');
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

test('a list filter is a tab by its key, any other status without a tab, or all; checked invoices split by what holds them', () => {
  expect(listFilter('billing_issues')).toMatchObject({ status: 'RECONCILED', open: true, label: 'Billing issues' });
  expect(listFilter('READY_TO_APPROVE')).toMatchObject({ status: 'RECONCILED', open: false, label: 'Ready to approve' });
  expect(listFilter('needs_review')).toMatchObject({ key: 'needs_review', status: 'NEEDS_REVIEW' });
  // A status with no tab of its own, such as an older link to every checked invoice, still filters.
  expect(listFilter('reconciled')).toEqual({ key: 'reconciled', status: 'RECONCILED', label: 'Checked' });
  expect(listFilter('extracting')).toMatchObject({ key: 'extracting', status: 'EXTRACTING' });
  expect([listFilter('nonsense'), listFilter(undefined)]).toEqual([FILTERS[0], FILTERS[0]]);
  // Of 8 checked invoices a reviewer holds 3 (an open finding, or a confirmed duplicate): billing issues; 5 are ready.
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
        discrepancyId: 'fuel',
      },
    ],
  } as unknown as Detail;
  const words = (rows: ReturnType<typeof trailRows>) => rows.map(({ verb, rest, notes }) => [verb, rest, notes]);
  expect(words(trailRows(invoice, [{ id: 'fuel', type: 'RATE_MISMATCH' }]))).toEqual([
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

test('a read while Claude reads first says why the free models had it, on its Read or Sent to review row', () => {
  const handedOff = (to: string, reason: string, detail: string | null = null) => ({
    ...move(3, 'extracting', to, detail),
    changes: [
      { field: 'status', from: 'extracting', to },
      { field: 'claude', from: null, to: reason },
    ],
  });
  const notes = (entry: unknown, step = 'first_pass') => trailRows({ extraction: { model: 'groq/openai/gpt-oss-120b', step }, auditTrail: [move(1, 'received', 'extracting'), entry] } as unknown as Detail, [])[1]!.notes;
  expect(notes(handedOff('extracted', 'daily_budget'))).toEqual(["Handed to the free models: Claude's budget for the day was spent"]);
  expect(notes(handedOff('extracted', 'extraction_cap'), 'fallback')).toEqual(['on the fallback model', "Handed to the free models: the invoice would have passed Claude's cap for one invoice"]);
  expect(notes(handedOff('needs_review', 'switched_off', 'output is not valid JSON'))).toEqual(["The model's reading failed validation.", 'Handed to the free models: Claude was switched off']);
  expect(notes(handedOff('extracted', '5xx'))).toEqual(['Handed to the free models: Claude answered with a server error']);
  // A reason this page has no words for yet shows as the api sent it.
  expect(notes(handedOff('extracted', 'something_new'))).toEqual(['Handed to the free models: something_new']);
});

test('an approval from review held for a possible duplicate reads as held, not approved, with why', () => {
  const held = { auditTrail: [move(9, 'needs_review', 'reconciled', 'not approved: another invoice from this carrier has the same number', 'reviewer')] } as unknown as Detail;
  expect(trailRows(held, []).map(({ verb, rest, notes }) => [verb, rest, notes])).toEqual([
    ['Held for a possible duplicate', 'when reviewer approved it as billed', ['Not approved: another invoice from this carrier has the same number']],
  ]);
});

test('an approval as billed, with no shipment, says so in the trail; one checked against the rate card keeps its status change', () => {
  const approval = (from: string) => ({ ...move(20, from, 'approved', null, 'reviewer'), action: 'APPROVED' as const });
  const words = (invoice: unknown) => trailRows(invoice as Detail, []).map(({ verb, rest, notes }) => [verb, rest, notes]);
  // Straight from review, and after a hold for a possible duplicate.
  for (const from of ['needs_review', 'reconciled']) {
    expect(words({ shipment: null, auditTrail: [approval(from)] })).toEqual([['Approved as billed', 'by reviewer', ['Not checked against the rate card']]]);
  }
  expect(words({ shipment: { reference: 'SHP-000413' }, auditTrail: [approval('reconciled')] })).toEqual([['Approved for payment', 'by reviewer', ['Status: Checked to Approved']]]);
});

test('a held invoice whose corrected reading matches no other invoice shows the correction, then why its possible duplicate closed', () => {
  const invoice = {
    shipment: null,
    auditTrail: [
      { id: 'c', at: at(10), actor: 'reviewer', action: 'CORRECTED' as const, detail: null, changes: [{ field: 'invoiceNumber', from: '98211354', to: '98211355' }] },
      {
        id: 'x',
        at: at(10),
        actor: 'reviewer',
        action: 'DISCREPANCY_CLOSED' as const,
        detail: 'the corrected reading matches no other invoice',
        changes: [{ field: 'status', from: 'open', to: 'closed' }],
        discrepancyId: 'duplicate',
      },
    ],
  } as unknown as Detail;
  expect(trailRows(invoice, [{ id: 'duplicate', type: 'DUPLICATE_INVOICE' }]).map(({ verb, rest, notes }) => [verb, rest, notes])).toEqual([
    ['Corrected', 'by reviewer', ['Invoice number: 98211354 to 98211355']],
    ['Finding closed', 'by reviewer', ['The corrected reading matches no other invoice']],
  ]);
});

test('an invoice held at its approval from review says why it was not approved, what it matches and what to do next, by its possible duplicate', () => {
  const evidence = 'Possible duplicate: invoice 98211354 from this carrier was also received on 2026-10-17 as digital.pdf.';
  const duplicate = (status: 'OPEN' | 'CONFIRMED' | 'DISMISSED' | 'CLOSED') => [{ type: 'DUPLICATE_INVOICE' as const, status, evidence }];
  // The evidence names the invoice it matches now: the api rewrites it on each check of a corrected reading.
  expect(unmatchedNote(duplicate('OPEN'))).toEqual({
    title: 'Not approved: possible duplicate',
    text: 'Another invoice from this carrier has the same number, so this one was not approved. Decide the possible duplicate below: Not a duplicate, then approve it as billed; Confirm duplicate, then reject it. If its carrier or invoice number was misread, correct it and check again.',
    match: evidence,
  });
  expect(unmatchedNote(duplicate('CLOSED'))).toEqual({
    title: 'Not checked against the rate card',
    text: 'It came from review with no matched shipment, and its corrected reading matches no other invoice. Approve it as billed, or reject it.',
  });
  expect(unmatchedNote(duplicate('DISMISSED'))).toEqual({
    title: 'Not checked against the rate card',
    text: 'It came from review with no matched shipment and is not a duplicate. Approve it as billed, or reject it.',
  });
  expect(unmatchedNote(duplicate('CONFIRMED'))).toEqual({
    title: 'Not checked against the rate card',
    text: 'It came from review with no matched shipment and is a confirmed duplicate. Reject it.',
  });
});

test("the api's refusals read as sentences, and the two a page out of date meets on correcting a held invoice in plain words", () => {
  expect(refusal('give the carrier, the PRO number or the invoice number')).toBe('Give the carrier, the PRO number or the invoice number.');
  expect(refusal('Sample data is read-only.')).toBe('Sample data is read-only.');
  expect(refusal('its possible duplicate is already decided, so its reading stays as it is')).toBe(
    'Its possible duplicate was decided after this page loaded, so its carrier and invoice number can no longer be corrected. Reload the page to see the decision.',
  );
  expect(refusal('a held invoice is not matched to a shipment again, so its PRO number stays as read')).toBe(
    'It was held for a possible duplicate after this page loaded, so it is not matched to a shipment again and its PRO number cannot be corrected. Reload the page to correct its carrier or invoice number instead.',
  );
});

test('a recent upload shows its step while in flight, then how long it took and the result', () => {
  const base = {
    createdAt: at(0),
    currency: 'USD',
    totalCents: 173_180,
    reviewReason: null,
    failureReason: null,
    hold: null,
    shipment: { id: 's', reference: 'SHP-000413' },
    lineItems: [],
    discrepancies: { edges: [] },
    auditTrail: [],
  };
  // While the pipeline has it, a row reads what it does: reading, then checking.
  expect(uploadState({ ...base, status: 'EXTRACTING' })).toEqual({ step: 1, result: 'Reading…', tone: 'faint' });
  expect(uploadState({ ...base, status: 'RECEIVED' })).toEqual({ step: 1, result: 'Reading…', tone: 'faint' });
  expect(uploadState({ ...base, status: 'RECONCILING' })).toEqual({ step: 2, result: 'Checking…', tone: 'faint' });
  const settled = { ...base, auditTrail: [{ id: 'x', at: at(3.4), action: 'STATUS_CHANGED' as const, changes: [{ field: 'status', to: 'reconciled' }] }] };
  const finding = { node: { id: 'f', status: 'OPEN' as const, billedCents: 39_680, expectedCents: 25_220, earlierInvoice: null } };
  expect(uploadState({ ...settled, status: 'RECONCILED', hold: 'OPEN_FINDINGS', discrepancies: { edges: [finding] } })).toEqual({
    done: 'Done in 3.4 s',
    result: 'Billing issues (1), +$144.60 over the rate card',
    tone: 'accent',
  });
  // A possible duplicate bills nothing over the rate card, and still holds the invoice back; a confirmed one only waits
  // to be rejected.
  const duplicate = { node: { id: 'd', status: 'OPEN' as const, billedCents: 0, expectedCents: 0, earlierInvoice: null } };
  expect(uploadState({ ...settled, status: 'RECONCILED', hold: 'POSSIBLE_DUPLICATE', discrepancies: { edges: [duplicate] } })).toMatchObject({
    result: 'Billing issues (1), possible duplicate to decide',
    tone: 'accent',
  });
  const confirmed = { node: { ...duplicate.node, status: 'CONFIRMED' as const } };
  expect(uploadState({ ...settled, status: 'RECONCILED', hold: 'CONFIRMED_DUPLICATE', discrepancies: { edges: [confirmed] } })).toMatchObject({
    result: 'Confirmed duplicate, waits to be rejected',
    tone: 'warn',
  });
  // A disputed finding still stands over the rate card, but no billing issue is left open.
  const disputed = { node: { ...finding.node, status: 'CONFIRMED' as const } };
  expect(uploadState({ ...settled, status: 'RECONCILED', discrepancies: { edges: [disputed] } })).toMatchObject({ result: 'Ready to approve, +$144.60 over the rate card' });
  expect(uploadState({ ...settled, status: 'RECONCILED' })).toMatchObject({ result: 'Ready to approve, matched the rate card', tone: 'ok' });
  // Held at its approval from review, it matched no shipment; found no duplicate, it is approved as billed.
  const dismissed = { node: { ...duplicate.node, status: 'DISMISSED' as const } };
  expect(uploadState({ ...settled, status: 'RECONCILED', shipment: null, discrepancies: { edges: [dismissed] } })).toMatchObject({
    result: 'Ready to approve as billed, not checked against the rate card',
    tone: 'ok',
  });
  expect(uploadState({ ...settled, status: 'NEEDS_REVIEW', reviewReason: 'no_shipment_match' })).toMatchObject({
    result: 'Reading needs a check: No shipment matches',
    tone: 'warn',
  });
  expect(uploadState({ ...base, status: 'FAILED', failureReason: 'shipment has no miles' })).toEqual({ done: 'Done', result: 'Failed: Shipment has no miles', tone: 'bad' });
  expect(uploadState({ ...settled, status: 'APPROVED' })).toMatchObject({ result: 'Approved', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'APPROVED', shipment: null })).toMatchObject({ result: 'Approved as billed', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'REJECTED' })).toMatchObject({ result: 'Rejected', tone: 'faint' });
});

test('an upload that settles while the page is open says so in a toast: what was read and what waits for the reviewer', () => {
  const finding = (status: 'OPEN' | 'CONFIRMED') => ({ node: { id: status, status, billedCents: 100, expectedCents: 0, earlierInvoice: null } });
  const upload = {
    number: '74732749',
    filename: 'g071.pdf',
    status: 'RECONCILED' as const,
    hold: 'OPEN_FINDINGS' as const,
    shipment: { id: 's', reference: 'SHP-001426' },
    reviewReason: null,
    failureReason: null,
    discrepancies: { edges: [finding('OPEN'), finding('OPEN'), finding('OPEN'), finding('CONFIRMED')] },
  };
  expect(finishedNote(upload)).toEqual({ text: 'Invoice 74732749 read: 3 findings to review', tone: 'ok' });
  expect(finishedNote({ ...upload, discrepancies: { edges: [finding('OPEN')] } }).text).toBe('Invoice 74732749 read: 1 finding to review');
  expect(finishedNote({ ...upload, hold: null, discrepancies: { edges: [] } }).text).toBe('Invoice 74732749 read: ready to approve');
  // Without a number, the file's name; a reading in doubt or a failure says so, the failure until closed.
  expect(finishedNote({ ...upload, number: null, status: 'NEEDS_REVIEW', discrepancies: { edges: [] } }).text).toBe('g071.pdf read: its reading needs a check');
  expect(finishedNote({ ...upload, number: null, status: 'FAILED', failureReason: 'shipment has no miles', discrepancies: { edges: [] } })).toEqual({
    text: 'g071.pdf failed: Shipment has no miles',
    tone: 'bad',
  });
});

test('a recent upload that re-bills a shipment says so beside its result, naming the invoice that billed its lines first', () => {
  const charge = (id: string, earlierInvoice: typeof first | null) => ({ node: { id, status: 'OPEN' as const, billedCents: 9_778, expectedCents: 0, earlierInvoice } });
  const upload = {
    status: 'RECONCILED' as const,
    createdAt: at(0),
    currency: 'USD',
    totalCents: 731_456,
    reviewReason: null,
    failureReason: null,
    hold: 'OPEN_FINDINGS' as const,
    shipment: { id: 's', reference: 'SHP-001426' },
    lineItems: [{ id: '1' }, { id: '2' }, { id: '3' }],
    discrepancies: { edges: [charge('a', first), charge('b', first), charge('c', first)] },
    auditTrail: [{ id: 'x', at: at(3.4), action: 'STATUS_CHANGED' as const, changes: [{ field: 'status', to: 'reconciled' }] }],
  };
  const state = uploadState(upload);
  expect(state).toMatchObject({ done: 'Done in 3.4 s', result: 'Billing issues (3), +$293.34 over the rate card', tone: 'accent' });
  expect(state.rebill).toEqual(['Re-bills SHP-001426: 3 of 3 lines already billed on ', { invoice: 'e1', text: 'invoice 74731111' }]);
  // Only charges with an earlier invoice count; a repeat on its own invoice has none.
  expect(said(uploadState({ ...upload, discrepancies: { edges: [charge('a', first), charge('b', null)] } }).rebill!)).toBe(
    'Re-bills SHP-001426: 1 of 3 lines already billed on invoice 74731111',
  );
  const both = uploadState({ ...upload, discrepancies: { edges: [charge('a', first), charge('b', second)] } }).rebill!;
  expect(said(both)).toBe('Re-bills SHP-001426: 2 of 3 lines already billed on earlier invoices: invoice 74731111 and invoice 74731222');
  expect(linksOf(both)).toEqual([
    { invoice: 'e1', text: 'invoice 74731111' },
    { invoice: 'e2', text: 'invoice 74731222' },
  ]);
  expect(uploadState({ ...upload, discrepancies: { edges: [charge('b', null)] } }).rebill).toBeUndefined();
  expect(uploadState({ ...upload, status: 'APPROVED' }).rebill).toBeUndefined();
});

// Every row of golden set v2's official results meets its target, so the landing page shows no miss today.
test("the landing page's results read Met, or Below target in the warning tone for a result that misses its target", () => {
  expect(resultBadge(true)).toEqual({ label: 'Met', tone: 'ok' });
  expect(resultBadge(false)).toEqual({ label: 'Below target', tone: 'warn' });
});
