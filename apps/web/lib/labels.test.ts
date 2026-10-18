import type { InvoiceQuery } from '@freightaudit/contracts/graphql';
import {
  decisionQuestion,
  duration,
  findingTitle,
  invoiceAmounts,
  lineAmounts,
  lineLabel,
  modelName,
  openFindingsNote,
  reviewReason,
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
  expect(statusReason({ ...row, status: 'REJECTED' })).toBe('Rejected by a reviewer');
  expect(statusReason({ ...row, status: 'APPROVED' })).toBeNull();
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
  expect(words(trailRows(invoice, 1))).toEqual([
    ['Received', 'by the pipeline', ['g066.pdf']],
    ['Reading started', '', []],
    ['Read', 'by Gemini 3.5 Flash-Lite in 3.3 s', ['after 1 repair', 'Carrier read as “BRAMBLEWOOD EXPRESS”, matched Bramblewood Express after normalizing case and spacing']],
    ['Matching started', '', []],
    ['Matched', 'to shipment SHP-000413 and Bramblewood Express, checked against rate card version 2 by rules in code', ['1 finding, so it waits for a reviewer']],
    ['Overcharge disputed', 'by reviewer', ['Status: open to confirmed', 'Contract rate applies']],
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
  expect(words(trailRows(review, 0))).toEqual([
    ['Reading started', '', []],
    ['Read', 'by Qwen3.8 27B in 1.0 s', ['on the fallback model']],
    ['Matching started', '', []],
    ['Sent to review', 'by the pipeline', ['No shipment matches this carrier and PRO number.']],
    ['Status changed', 'by reviewer', ['Failed to Received']],
  ]);
  const clean = { ...invoice, auditTrail: [move(6, 'reconciling', 'reconciled')] } as unknown as Detail;
  expect(trailRows(clean, 0)[0]!.notes).toEqual(['No findings, so it waits only for approval']);
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
    result: 'Reconciled, +$144.60 over the rate card',
    tone: 'accent',
  });
  expect(uploadState({ ...settled, status: 'RECONCILED' }, now)).toMatchObject({ result: 'Matched the rate card, ready to approve', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'NEEDS_REVIEW', reviewReason: 'no_shipment_match' }, now)).toMatchObject({ result: 'Needs review: No shipment matches', tone: 'warn' });
  expect(uploadState({ ...base, status: 'FAILED', failureReason: 'shipment has no miles' }, now)).toEqual({ done: 'Done', result: 'Failed: Shipment has no miles', tone: 'bad' });
  expect(uploadState({ ...settled, status: 'APPROVED' }, now)).toMatchObject({ result: 'Approved', tone: 'ok' });
  expect(uploadState({ ...settled, status: 'REJECTED' }, now)).toMatchObject({ result: 'Rejected', tone: 'faint' });
});
