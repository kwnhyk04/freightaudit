import type { AuditAction, DiscrepancyStatus, DiscrepancyType, InvoiceDecision, InvoiceQuery, InvoiceStatus, RecentUploadsQuery } from '@freightaudit/contracts/graphql';
import { type FindingStatus, formatMoney, lineExpectedCents, overchargeCents, reviewAmounts } from '@freightaudit/domain';

// The words the UI uses for the API's codes. Color always comes with a word, never alone.
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'busy';

// Each status's pill, and the reason line a list row shows under it where the status alone says why.
export const STATUS: Record<InvoiceStatus, { label: string; tone: Tone; reason?: string }> = {
  RECEIVED: { label: 'Received', tone: 'busy', reason: 'Waiting to be read' },
  EXTRACTING: { label: 'Extracting', tone: 'busy', reason: 'Reading the document' },
  EXTRACTED: { label: 'Extracted', tone: 'busy', reason: 'Waiting for matching' },
  RECONCILING: { label: 'Reconciling', tone: 'busy', reason: 'Comparing with the rate card' },
  RECONCILED: { label: 'Reconciled', tone: 'neutral' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'neutral', reason: 'Rejected by a reviewer' },
  FAILED: { label: 'Failed', tone: 'bad' },
};
// A status from a URL parameter such as ?status=needs_review; anything else means all.
export const statusParam = (raw: string | undefined) => {
  const upper = raw?.toUpperCase();
  return upper && Object.hasOwn(STATUS, upper) ? (upper as InvoiceStatus) : undefined;
};
// Statuses the pipeline is still moving through; a page showing one refreshes until it settles.
export const IN_FLIGHT = new Set<InvoiceStatus>(['RECEIVED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING']);

// The list's filters, in the order a reviewer works through them.
export const FILTERS: { status?: InvoiceStatus; label: string }[] = [
  { label: 'All' },
  { status: 'NEEDS_REVIEW', label: 'Needs review' },
  { status: 'RECONCILED', label: 'Reconciled' },
  { status: 'FAILED', label: 'Failed' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
  { status: 'RECEIVED', label: 'Received' },
  { status: 'EXTRACTED', label: 'Extracted' },
];

export const FINDING: Record<DiscrepancyType, string> = {
  RATE_MISMATCH: 'Rate mismatch',
  UNCONTRACTED_CHARGE: 'Uncontracted charge',
  DUPLICATE_CHARGE: 'Duplicate charge',
  WEIGHT_MISMATCH: 'Weight mismatch',
  ARITHMETIC_ERROR: 'Arithmetic error',
};

// A finding's title from its line: what is wrong with which charge.
const TITLE: Record<DiscrepancyType, (line: string) => string> = {
  RATE_MISMATCH: (line) => `${line} above the rate card`,
  UNCONTRACTED_CHARGE: (line) => `${line} charged, but not on the rate card`,
  DUPLICATE_CHARGE: (line) => `${line} billed twice`,
  WEIGHT_MISMATCH: (line) => `${line} billed for another weight`,
  ARITHMETIC_ERROR: (line) => `${line} does not add up`,
};
export const findingTitle = (type: DiscrepancyType, description?: string) => (description ? TITLE[type](lineLabel(description)) : FINDING[type]);

// A description printed in capitals, as some layouts print every line, reads in sentence case; any other stays as read.
export const lineLabel = (text: string) => (/[a-z]/.test(text) ? text : `${text.charAt(0)}${text.slice(1).toLowerCase()}`);

export const DECISION: Record<DiscrepancyStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'bad' },
  CONFIRMED: { label: 'Disputed', tone: 'neutral' },
  DISMISSED: { label: 'Charge approved', tone: 'ok' },
};

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// Why an invoice needs review, in words a reviewer can act on: a sentence on the invoice, a short phrase in a list row.
export function reviewReason(code: string | null | undefined, short = false) {
  const say = (sentence: string, phrase: string) => (short ? phrase : sentence);
  if (!code) return say('The extraction could not be trusted.', 'Reading not trusted');
  if (code === 'no_shipment_match') return say('No shipment matches this carrier and PRO number.', 'No shipment matches');
  if (code === 'missing_currency') return say('The invoice shows no currency.', 'No currency shown');
  if (code.startsWith('unsupported_currency')) {
    const currency = code.split(':')[1]?.trim() || 'another currency';
    return say(`Billed in ${currency}; rate cards are in USD.`, `Billed in ${currency}`);
  }
  if (code.startsWith('fallback_page_cap')) return say('The scan has more pages than the fallback model reads.', 'Too many scanned pages');
  return say("The model's reading failed validation.", 'Reading failed its checks');
}

// The line under a list row's status pill: open findings, the review or failure reason, or the step in progress.
export function statusReason(row: { status: InvoiceStatus; openDiscrepancyCount: number; reviewReason: string | null; failureReason: string | null; findings: number }) {
  if (row.status === 'RECONCILED') {
    if (row.openDiscrepancyCount > 0) return plural(row.openDiscrepancyCount, 'open finding');
    return row.findings > 0 ? 'Findings decided' : 'Matched the rate card';
  }
  if (row.status === 'NEEDS_REVIEW') return reviewReason(row.reviewReason, true);
  if (row.status === 'FAILED') return row.failureReason ? capital(row.failureReason) : 'Used up its retries';
  return STATUS[row.status].reason ?? null;
}

// The status counts as tabs and sums: all invoices, those waiting for a reviewer, those the pipeline still moves.
export function statusTotals(counts: { status: InvoiceStatus; count: number }[]) {
  const count = (status: InvoiceStatus) => counts.find((each) => each.status === status)?.count ?? 0;
  const sum = (statuses: Iterable<InvoiceStatus>) => [...statuses].reduce((total, status) => total + count(status), 0);
  return { count, all: sum(Object.keys(STATUS) as InvoiceStatus[]), waiting: sum(['RECONCILED', 'NEEDS_REVIEW']), processing: sum(IN_FLIGHT) };
}

const DAY = 86_400_000;
// The open findings card's note: on how many invoices, and how long the oldest has waited.
export function openFindingsNote(summary: { openFindings: number; invoicesWithOpenFindings: number; oldestOpenFindingAt: string | null }, now: number) {
  if (summary.openFindings === 0 || !summary.oldestOpenFindingAt) return 'Nothing waits for a decision';
  const days = Math.floor((now - Date.parse(summary.oldestOpenFindingAt)) / DAY);
  return `On ${plural(summary.invoicesWithOpenFindings, 'invoice')}, the oldest waiting ${days < 1 ? 'under a day' : plural(days, 'day')}`;
}

export const duration = (ms: number) => {
  const time = Math.max(0, ms);
  if (time < 60_000) return `${(time / 1000).toFixed(1)} s`;
  return time < 3_600_000 ? `${Math.round(time / 60_000)} min` : `${Math.round(time / 3_600_000)} h`;
};

type Finding = { status: DiscrepancyStatus; billedCents: number; expectedCents: number };
const amounts = (finding: Finding) => ({
  status: finding.status.toLowerCase() as FindingStatus,
  billedCents: BigInt(finding.billedCents),
  expectedCents: BigInt(finding.expectedCents),
});
// Money for review comes from packages/domain, so the UI never adds or subtracts: the invoice's open and standing
// overcharges and what the rate card allows, and each line's expected amount and difference.
export const invoiceAmounts = (totalCents: number, findings: Finding[]) => reviewAmounts(BigInt(totalCents), findings.map(amounts));
export const overcharge = (finding: Finding) => overchargeCents(amounts(finding));
export function lineAmounts(amountCents: number, finding?: Finding) {
  const expectedCents = lineExpectedCents(BigInt(amountCents), finding && amounts(finding));
  return { expectedCents, differenceCents: overchargeCents({ billedCents: BigInt(amountCents), expectedCents }) };
}

// The question a bulk decision asks before it runs.
export function decisionQuestion(decision: InvoiceDecision, open: number, totalCents: number, money: ReturnType<typeof reviewAmounts>, currency: string | null) {
  const findings = `${plural(open, 'open finding')} ${open === 1 ? 'is' : 'are'}`;
  if (decision === 'APPROVE_AS_BILLED') return `Approve as billed? ${findings} dismissed and ${formatMoney(totalCents, currency)} is approved for payment.`;
  if (decision === 'DISPUTE') return `Dispute ${formatMoney(money.openCents, currency)}? ${findings} disputed and the invoice waits for approval.`;
  return `Approve at rate card? ${findings} disputed and ${formatMoney(money.expectedCents, currency)} is approved for payment.`;
}

export const CARRIER_MATCH: Record<string, string> = {
  exact: 'as printed',
  normalized: 'after normalizing case and spacing',
  contained: 'inside a longer line',
  no_match: 'no known carrier matched',
};

export const ACTION: Record<AuditAction, string> = {
  RECEIVED: 'Received',
  STATUS_CHANGED: 'Status changed',
  CORRECTED: 'Corrected',
  REJECTED: 'Rejected',
  APPROVED: 'Approved for payment',
  DISCREPANCY_CONFIRMED: 'Overcharge disputed',
  DISCREPANCY_DISMISSED: 'Charge approved',
  REPLAYED: 'Replayed',
};

export const FIELD: Record<string, string> = { status: 'Status', carrier: 'Carrier', proNumber: 'PRO number' };

// The pipeline step behind each queue.
export const QUEUE: Record<string, string> = { extract: 'Extraction', reconcile: 'Reconciliation', 'tms-sync': 'TMS sync' };

// Display names of the models that read invoices; an unknown one shows its id.
const MODEL: Record<string, string> = {
  'gemini/gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini/gemini-3.8-flash': 'Gemini 3.8 Flash',
  'groq/openai/gpt-oss-120b': 'GPT-OSS 120B',
  'groq/qwen/qwen3.8-27b': 'Qwen3.8 27B',
  'mistral/mistral-small-2603': 'Mistral Small',
  'anthropic/claude-haiku-5-5': 'Claude Haiku 5.5',
};
export const modelName = (id: string) => MODEL[id] ?? id;

type Detail = NonNullable<InvoiceQuery['invoice']>;
type Entry = Detail['auditTrail'][number];
const statusLabel = (status: string | null) => (status ? (STATUS[status.toUpperCase() as InvoiceStatus]?.label ?? status) : 'none');
// An audit detail in words: a review reason code, or free text such as a failure or a note.
const reasonText = (detail: string) => (/^[a-z_]+(:|$)/.test(detail) ? reviewReason(detail) : capital(detail));
// A field change in words: statuses by their labels, and on extraction the carrier as read and how it matched.
function changeText(entry: Entry, { field, from, to }: Entry['changes'][number]) {
  if (field === 'status') return `${entry.action === 'STATUS_CHANGED' ? '' : 'Status: '}${statusLabel(from)} to ${statusLabel(to)}`;
  if (field === 'carrier' && entry.action === 'STATUS_CHANGED') {
    return `Carrier read as “${from}”, ${to ? `matched ${to} ${CARRIER_MATCH[entry.detail ?? 'exact'] ?? ''}` : CARRIER_MATCH.no_match}`;
  }
  return `${FIELD[field] ?? field}: ${from ?? 'none'} to ${to ?? 'none'}`;
}

export type TrailRow = { id: string; at: string; verb: string; rest: string; notes: string[] };
// The audit trail in plain words: each pipeline move says what happened, reviewer rows say who did what. findings is the
// number the reconcile run wrote.
export function trailRows(invoice: Pick<Detail, 'auditTrail' | 'extraction' | 'shipment' | 'carrier' | 'rateCardVersion'>, findings: number): TrailRow[] {
  let readingFrom: string | undefined;
  return invoice.auditTrail.map((entry) => {
    const row = (verb: string, rest = '', notes: string[] = []) => ({ id: entry.id, at: entry.at, verb, rest, notes });
    const by = entry.actor ? `by ${entry.actor}` : 'by the pipeline';
    const status = entry.changes.find((change) => change.field === 'status');
    if (entry.action === 'RECEIVED') return row('Received', 'by the pipeline', entry.detail ? [entry.detail] : []);
    if (entry.action !== 'STATUS_CHANGED' || !status || entry.actor) {
      const carrier = entry.changes.some((change) => change.field === 'carrier');
      const notes = entry.changes.map((change) => changeText(entry, change));
      return row(ACTION[entry.action], by, entry.detail && !carrier ? [...notes, reasonText(entry.detail)] : notes);
    }
    const { from, to } = status;
    if (to === 'extracting') {
      readingFrom = entry.at;
      return row('Reading started');
    }
    if (from === 'extracting' && to === 'extracted') {
      const model = invoice.extraction ? ` ${modelName(invoice.extraction.model)}` : ' the model';
      const time = readingFrom ? ` in ${duration(Date.parse(entry.at) - Date.parse(readingFrom))}` : '';
      const step = { repair: ['after 1 repair'], fallback: ['on the fallback model'] }[invoice.extraction?.step ?? ''] ?? [];
      const carrier = entry.changes.filter((change) => change.field === 'carrier').map((change) => changeText(entry, change));
      return row('Read', `by${model}${time}`, [...step, ...carrier]);
    }
    if (to === 'reconciling') return row('Matching started');
    if (from === 'reconciling' && to === 'reconciled') {
      const shipment = invoice.shipment ? `shipment ${invoice.shipment.reference}` : 'its shipment';
      const carrier = invoice.carrier ? ` and ${invoice.carrier}` : '';
      const card = invoice.rateCardVersion ? `rate card version ${invoice.rateCardVersion.version}` : 'the rate card';
      const next = findings > 0 ? `${plural(findings, 'finding')}, so it waits for a reviewer` : 'No findings, so it waits only for approval';
      return row('Matched', `to ${shipment}${carrier}, checked against ${card} by rules in code`, [next]);
    }
    if (to === 'needs_review') return row('Sent to review', by, [reviewReason(entry.detail)]);
    if (to === 'failed') return row('Failed', by, [entry.detail ? reasonText(entry.detail) : 'The step used up its retries.']);
    return row('Status changed', by, [changeText(entry, status)]);
  });
}

// The upload page's progress steps; a step index says which one is under way.
export const STEPS = ['Uploaded', 'Reading', 'Matching', 'Checked'] as const;
const SETTLED = new Set(['reconciled', 'needs_review', 'failed']);
type Recent = Omit<RecentUploadsQuery['invoices']['edges'][number]['node'], 'id' | 'filename'>;
export type UploadState = { step?: number; done?: string; result: string; tone: 'ok' | 'warn' | 'bad' | 'accent' | 'faint' };
// A recent upload: its step while in flight, else how long it took (upload to its first settled status) and the result.
export function uploadState(upload: Recent, now: number): UploadState {
  const created = Date.parse(upload.createdAt);
  if (IN_FLIGHT.has(upload.status)) {
    const step = upload.status === 'RECEIVED' || upload.status === 'EXTRACTING' ? 1 : 2;
    return { step, result: `Working, ${duration(now - created)} so far`, tone: 'faint' };
  }
  const settled = upload.auditTrail.find((entry) => entry.changes.some((change) => change.field === 'status' && SETTLED.has(change.to ?? '')));
  const done = settled ? `Done in ${duration(Date.parse(settled.at) - created)}` : 'Done';
  if (upload.status === 'RECONCILED') {
    const findings = upload.discrepancies.edges.map(({ node }) => node);
    const { standingCents } = invoiceAmounts(upload.totalCents ?? 0, findings);
    return standingCents > 0n
      ? { done, result: `Reconciled, +${formatMoney(standingCents, upload.currency)} over the rate card`, tone: 'accent' }
      : { done, result: 'Matched the rate card, ready to approve', tone: 'ok' };
  }
  if (upload.status === 'NEEDS_REVIEW') return { done, result: `Needs review: ${reviewReason(upload.reviewReason, true)}`, tone: 'warn' };
  if (upload.status === 'FAILED') return { done, result: `Failed: ${upload.failureReason ? capital(upload.failureReason) : 'Used up its retries'}`, tone: 'bad' };
  return { done, result: STATUS[upload.status].label, tone: upload.status === 'APPROVED' ? 'ok' : 'faint' };
}
