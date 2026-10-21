import type { AuditAction, DiscrepancyStatus, DiscrepancyType, InvoiceDecision, InvoiceHold, InvoiceQuery, InvoiceStatus, RecentUploadsQuery } from '@freightaudit/contracts/graphql';
import { type FindingStatus, formatMoney, lineExpectedCents, overchargeCents, reviewAmounts } from '@freightaudit/domain';

// The words the UI uses for the API's codes. Color always comes with a word, never alone.
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'busy';

// Each status's pill, and the reason line a list row shows under it where the status alone says why.
export const STATUS: Record<InvoiceStatus, { label: string; tone: Tone; reason?: string }> = {
  RECEIVED: { label: 'Received', tone: 'busy', reason: 'Waiting to be read' },
  EXTRACTING: { label: 'Reading', tone: 'busy', reason: 'Reading the document' },
  EXTRACTED: { label: 'Checking', tone: 'busy', reason: 'Waiting to be checked' },
  RECONCILING: { label: 'Checking', tone: 'busy', reason: 'Comparing with the rate card' },
  RECONCILED: { label: 'Checked', tone: 'neutral' },
  NEEDS_REVIEW: { label: 'Reading needs a check', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'neutral', reason: 'Rejected by a reviewer' },
  FAILED: { label: 'Failed', tone: 'bad' },
};
// A status pill's words; a checked invoice says whether it is a confirmed duplicate, which is never approved, billing
// issues wait for a decision, or it is ready to approve, as billed when it matched no shipment (held at its approval
// from review, it was never checked against the rate card); approved with no shipment, it was approved as billed.
export const statusLabel = (status: InvoiceStatus, open: number, hold: InvoiceHold | null = null, matched = true) => {
  if (status === 'APPROVED' && !matched) return 'Approved as billed';
  if (status !== 'RECONCILED') return STATUS[status].label;
  if (hold === 'CONFIRMED_DUPLICATE') return 'Confirmed duplicate';
  if (open > 0) return `Billing issues (${open})`;
  return matched ? 'Ready to approve' : 'Ready to approve as billed';
};
// Why a possible duplicate holds a checked invoice, in a list's words; open findings say how many instead.
const HELD: Partial<Record<InvoiceHold, string>> = { CONFIRMED_DUPLICATE: 'Waits to be rejected', POSSIBLE_DUPLICATE: 'Possible duplicate to decide' };
// A status from a URL parameter such as ?status=needs_review; anything else means all.
export const statusParam = (raw: string | undefined) => {
  const upper = raw?.toUpperCase();
  return upper && Object.hasOwn(STATUS, upper) ? (upper as InvoiceStatus) : undefined;
};
// The first value of each URL parameter: a repeated ?q=a&q=b reads as a, so a pasted link never hands a page a list.
export const firstParams = async (params: Promise<Record<string, string | string[] | undefined>>) =>
  Object.fromEntries(Object.entries(await params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])) as Record<string, string | undefined>;
// Statuses the pipeline is still moving through; a page showing one refreshes until it settles.
export const IN_FLIGHT = new Set<InvoiceStatus>(['RECEIVED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING']);

// The list's filters, in the order a reviewer works through them: each tab's key in ?status=, the invoices it holds and
// the line that says what they are. A checked invoice has billing issues while a reviewer holds it (Invoice.hold), else
// it is ready; open is the api's hasOpenFindings, which goes by that hold.
export type Filter = { key: string; status?: InvoiceStatus; open?: boolean; label: string; note?: string };
export const FILTERS: Filter[] = [
  { key: 'all', label: 'All', note: 'Every invoice, newest first.' },
  { key: 'needs_review', status: 'NEEDS_REVIEW', label: 'Reading needs a check', note: "The AI's reading matched no shipment or failed its checks; a reviewer corrects or rejects it." },
  { key: 'billing_issues', status: 'RECONCILED', open: true, label: 'Billing issues', note: 'Checked against the rate card, with findings to decide or a confirmed duplicate to reject.' },
  {
    key: 'ready_to_approve',
    status: 'RECONCILED',
    open: false,
    label: 'Ready to approve',
    note: 'Checked against the rate card with no finding left to decide, or from review with no matched shipment, ready to approve as billed.',
  },
  { key: 'failed', status: 'FAILED', label: 'Failed', note: 'Processing used up its retries; each invoice shows why.' },
  { key: 'approved', status: 'APPROVED', label: 'Approved', note: 'Approved for payment.' },
  { key: 'rejected', status: 'REJECTED', label: 'Rejected', note: 'Rejected by a reviewer, with a reason.' },
  { key: 'received', status: 'RECEIVED', label: 'Received', note: 'Uploaded, waiting to be read.' },
  { key: 'extracted', status: 'EXTRACTED', label: 'Checking', note: 'Read, waiting to be checked against the rate card.' },
];
// The filter a ?status= value names: a tab's key, or any other status, listed without a tab; anything else is all.
export function listFilter(raw: string | undefined): Filter {
  const key = raw?.toLowerCase();
  const status = statusParam(raw);
  return FILTERS.find((filter) => filter.key === key) ?? (status ? { key: status.toLowerCase(), status, label: STATUS[status].label } : FILTERS[0]!);
}
// A filter's value in the address; all needs none.
export const filterKey = (filter: Filter) => (filter.status ? filter.key : undefined);

const uploadDay = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
type Brief = { number: string | null; filename: string; createdAt: string };
// An exact duplicate upload's warning in three parts, the middle one naming the invoice it already is: its number, or
// else its file name. The upload page links that part.
export const duplicateParts = ({ number, filename, createdAt }: Brief) =>
  ['Already uploaded as ', number ? `invoice ${number}` : filename, ` on ${uploadDay.format(new Date(createdAt))}. Nothing new was created.`] as const;
export const duplicateNote = (brief: Brief) => duplicateParts(brief).join('');

// Example data is what the seed wrote: no stored PDF and nothing in the trail past the synthetic Received entry. Both
// must hold, so a real upload still waiting, its PDF stored, is never taken for it.
export const isExampleData = ({ stored, trail }: { stored: boolean; trail: { action: AuditAction }[] }) =>
  !stored && trail.length === 1 && trail[0]!.action === 'RECEIVED';

export const FINDING: Record<DiscrepancyType, string> = {
  RATE_MISMATCH: 'Rate mismatch',
  UNCONTRACTED_CHARGE: 'Uncontracted charge',
  DUPLICATE_CHARGE: 'Duplicate charge',
  DUPLICATE_INVOICE: 'Possible duplicate invoice',
  WEIGHT_MISMATCH: 'Weight mismatch',
  ARITHMETIC_ERROR: 'Arithmetic error',
};

// A finding's title from its line: what is wrong with which charge. A possible duplicate is of the whole invoice, with
// no line, so its type is its title.
const TITLE: Record<Exclude<DiscrepancyType, 'DUPLICATE_INVOICE'>, (line: string) => string> = {
  RATE_MISMATCH: (line) => `${line} above the rate card`,
  UNCONTRACTED_CHARGE: (line) => `${line} charged, but not on the rate card`,
  DUPLICATE_CHARGE: (line) => `${line} billed twice`,
  WEIGHT_MISMATCH: (line) => `${line} billed for another weight`,
  ARITHMETIC_ERROR: (line) => `${line} does not add up`,
};
export const findingTitle = (type: DiscrepancyType, description?: string) =>
  type !== 'DUPLICATE_INVOICE' && description ? TITLE[type](lineLabel(description)) : FINDING[type];
// A finding's sentence naming its line as printed; the stored evidence, which names the code in capitals, stands only without a line.
export function findingText(
  finding: { type: DiscrepancyType; evidence: string; expectedCents: number; billedCents: number },
  line?: { description: string } | null,
  version?: number,
  currency?: string | null,
) {
  if (!line) return finding.evidence;
  const label = lineLabel(line.description);
  const card = version === undefined ? 'the rate card' : `rate card version ${version}`;
  if (finding.type === 'DUPLICATE_CHARGE') return `${label} is billed twice.`;
  if (finding.type === 'UNCONTRACTED_CHARGE') return `${label} is not on ${card}.`;
  if (finding.type === 'RATE_MISMATCH') return `${capital(card)} sets ${label} at ${formatMoney(finding.expectedCents, currency)}; billed ${formatMoney(finding.billedCents, currency)}.`;
  return finding.evidence;
}

// A description printed in capitals, as some layouts print every line, reads in sentence case; any other stays as read.
export const lineLabel = (text: string) => (/[a-z]/.test(text) ? text : `${text.charAt(0)}${text.slice(1).toLowerCase()}`);

// The invoice that billed a re-billed charge first, as the api names it (Discrepancy.earlierInvoice).
export type EarlierInvoice = { id: string; number: string | null; filename: string; issuedOn: string | null };
// Where a duplicate charge was billed before: on that earlier invoice, on an earlier line of its own invoice, or on an
// earlier invoice with no name here (the sample's findings were exported before the api named it).
export type BilledBefore = { invoice: EarlierInvoice } | { line: number } | { unnamed: true };
// A sentence whose parts may link to another invoice: the page links each { invoice, text } part to that invoice.
export type Words = (string | { invoice: string; text: string })[];
// Where a duplicate charge was billed before. The earlier invoice the api names comes first, since that is the re-bill;
// else the first earlier line of this invoice with its code; else an earlier invoice, unnamed. Undefined for any other
// finding, and for a duplicate whose line is not loaded and whose earlier invoice is not named.
export function billedBefore(
  finding: { type: DiscrepancyType; lineItem?: { lineNumber: number } | null; earlierInvoice?: EarlierInvoice | null },
  lines: readonly { lineNumber: number; chargeCode: string | null }[],
): BilledBefore | undefined {
  if (finding.type !== 'DUPLICATE_CHARGE') return undefined;
  if (finding.earlierInvoice) return { invoice: finding.earlierInvoice };
  const line = lines.find((each) => each.lineNumber === finding.lineItem?.lineNumber);
  if (!line) return undefined;
  const earlier = lines.filter((each) => each.lineNumber < line.lineNumber && each.chargeCode !== null && each.chargeCode === line.chargeCode);
  return earlier.length > 0 ? { line: Math.min(...earlier.map((each) => each.lineNumber)) } : { unnamed: true };
}
// An earlier invoice in a sentence, linked: its number, or else its file name, as an exact duplicate upload names it.
const earlierLink = (earlier: EarlierInvoice) => ({ invoice: earlier.id, text: earlier.number ? `invoice ${earlier.number}` : earlier.filename });
// Its printed date in brackets, when one was read.
const printedOn = (earlier: EarlierInvoice) => (earlier.issuedOn ? ` (${uploadDay.format(new Date(`${earlier.issuedOn}T00:00:00Z`))})` : '');
// A duplicate charge's sentence on the invoice page, naming where it was billed first.
export function rebilledText(description: string, before: BilledBefore): Words {
  const label = lineLabel(description);
  if ('invoice' in before) return [`${label} was already billed on `, earlierLink(before.invoice), `${printedOn(before.invoice)} for the same shipment.`];
  if ('line' in before) return [`${label} was already billed on line ${before.line} of this invoice.`];
  return [`${label} was already billed on an earlier invoice for the same shipment.`];
}
// The Expected cell of a charge billed before, in place of its $0, while its finding stands: once approved, the charge's
// billed amount stands and the cell shows money again.
export function alreadyBilled(finding: { status: DiscrepancyStatus }, before: BilledBefore | undefined): Words | undefined {
  if (!before || finding.status === 'DISMISSED') return undefined;
  if ('invoice' in before) return ['Already billed on ', earlierLink(before.invoice)];
  return ['line' in before ? `Already billed on line ${before.line}` : 'Already billed on an earlier invoice'];
}
// The line above a charges table that has such a cell.
export const ALREADY_BILLED = 'Expected is $0 for a charge already billed, on an earlier invoice for this shipment or on an earlier line, so it is not paid twice.';
// The earlier invoices of a re-bill's lines: how many lines, and each named invoice once, in the order they come. A
// repeat on the invoice's own lines is no re-bill.
function rebilled(befores: readonly BilledBefore[]) {
  const earlier = befores.filter((before) => !('line' in before));
  const named = [...new Map(earlier.flatMap((before) => ('invoice' in before ? [[before.invoice.id, before.invoice] as const] : []))).values()];
  return { count: earlier.length, named };
}
// Named invoices in a list: "a", "a and b", "a, b and c".
function listed(parts: Words[]): Words {
  return parts.flatMap((part, i) => (i === 0 ? part : [i === parts.length - 1 ? ' and ' : ', ', ...part]));
}
// The invoice header's line on a re-bill: how many of its lines an earlier invoice for the shipment billed first, each
// named with its date, and that the others are checked as usual.
export function rebillNote(shipment: string, lines: number, befores: readonly BilledBefore[]): Words | undefined {
  const { count, named } = rebilled(befores);
  if (count === 0) return undefined;
  const which: Words =
    named.length === 0
      ? ['an earlier invoice']
      : named.length === 1
        ? [earlierLink(named[0]!), printedOn(named[0]!)]
        : ['earlier invoices: ', ...listed(named.map((earlier) => [earlierLink(earlier), printedOn(earlier)]))];
  const others = lines - count;
  const rest = others > 0 ? ` The other ${others} ${others === 1 ? 'is' : 'are'} checked against the rate card as usual.` : '';
  return [`Re-bills shipment ${shipment}: ${count} of ${plural(lines, 'line')} ${count === 1 ? 'was' : 'were'} already billed on `, ...which, `.${rest}`];
}
// The same on a recent upload's row, in short: only the charges the api names an earlier invoice for count, since the row
// has no lines to tell a repeat on the invoice itself from an unnamed earlier invoice.
function rebillRow(shipment: string, lines: number, earlier: readonly EarlierInvoice[]): Words | undefined {
  const { count, named } = rebilled(earlier.map((invoice) => ({ invoice })));
  if (count === 0) return undefined;
  const which = named.length === 1 ? [earlierLink(named[0]!)] : ['earlier invoices: ', ...listed(named.map((each) => [earlierLink(each)]))];
  return [`Re-bills ${shipment}: ${count} of ${plural(lines, 'line')} already billed on `, ...which];
}

// A finding's decision in a charge's words. One closed with its rejected invoice was never decided, whatever its type.
export const DECISION: Record<DiscrepancyStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'bad' },
  CONFIRMED: { label: 'Disputed', tone: 'neutral' },
  DISMISSED: { label: 'Charge approved', tone: 'ok' },
  CLOSED: { label: 'Closed with the invoice', tone: 'neutral' },
};
// A possible duplicate's decisions in its own words.
const DUPLICATE_DECISION: Partial<Record<DiscrepancyStatus, { label: string; tone: Tone }>> = {
  CONFIRMED: { label: 'Duplicate confirmed', tone: 'warn' },
  DISMISSED: { label: 'Not a duplicate', tone: 'ok' },
};
// The api's reason on the row that closed a held invoice's possible duplicate when its corrected reading matched no other
// invoice (apps/api/src/review.ts); any other closed finding closed with its rejected invoice.
const READING_CORRECTED = 'the corrected reading matches no other invoice';
export const decisionLabel = (status: DiscrepancyStatus, type?: DiscrepancyType, closedWhy?: string | null): { label: string; tone: Tone } =>
  status === 'CLOSED' && closedWhy === READING_CORRECTED
    ? { label: 'Closed: reading corrected', tone: 'ok' }
    : (type === 'DUPLICATE_INVOICE' && DUPLICATE_DECISION[status]) || DECISION[status];
// The buttons that decide one finding: dismiss lets it go, confirm upholds it.
export const decideWords = (type: DiscrepancyType) =>
  type === 'DUPLICATE_INVOICE' ? { dismiss: 'Not a duplicate', confirm: 'Confirm duplicate' } : { dismiss: 'Approve charge', confirm: 'Dispute' };

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
// The api's refusals as sentences: its messages start lower case and stop without a period. The two a page out of date
// meets on correcting a held invoice say in plain words what happened meanwhile and what to do.
const PLAIN = new Map([
  [
    'its possible duplicate is already decided, so its reading stays as it is',
    'Its possible duplicate was decided after this page loaded, so its carrier and invoice number can no longer be corrected. Reload the page to see the decision.',
  ],
  [
    'a held invoice is not matched to a shipment again, so its PRO number stays as read',
    'It was held for a possible duplicate after this page loaded, so it is not matched to a shipment again and its PRO number cannot be corrected. Reload the page to correct its carrier or invoice number instead.',
  ],
]);
export const refusal = (text: string) => PLAIN.get(text) ?? `${capital(text)}${/[.!?]$/.test(text) ? '' : '.'}`;

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

// The line under a list row's status pill: what holds a checked invoice, the review or failure reason, or the step in
// progress. matched is whether the invoice has its shipment.
export function statusReason(row: {
  status: InvoiceStatus;
  openDiscrepancyCount: number;
  reviewReason: string | null;
  failureReason: string | null;
  findings: number;
  hold: InvoiceHold | null;
  matched: boolean;
}) {
  if (row.status === 'RECONCILED') {
    const held = row.hold && HELD[row.hold];
    if (held) return held;
    if (row.openDiscrepancyCount > 0) return plural(row.openDiscrepancyCount, 'open finding');
    if (!row.matched) return 'Not checked against the rate card';
    return row.findings > 0 ? 'Findings decided' : 'Matched the rate card';
  }
  if (row.status === 'NEEDS_REVIEW') return reviewReason(row.reviewReason, true);
  if (row.status === 'FAILED') return row.failureReason ? capital(row.failureReason) : 'Used up its retries';
  if (row.status === 'APPROVED' && !row.matched) return 'Not checked against the rate card';
  return STATUS[row.status].reason ?? null;
}

// The panel of a checked invoice with no shipment: approved as billed from review, it was held for a possible duplicate,
// so it says why it was not approved, the invoice it matches while that is open (the evidence names the earliest now),
// and what follows from the duplicate's decision or its closing on a corrected reading.
export function unmatchedNote(findings: readonly { type: DiscrepancyType; status: DiscrepancyStatus; evidence: string }[]) {
  const duplicate = findings.find((finding) => finding.type === 'DUPLICATE_INVOICE');
  if (duplicate?.status === 'OPEN') {
    return {
      title: 'Not approved: possible duplicate',
      text: 'Another invoice from this carrier has the same number, so this one was not approved. Decide the possible duplicate below: Not a duplicate, then approve it as billed; Confirm duplicate, then reject it. If its carrier or invoice number was misread, correct it and check again.',
      match: duplicate.evidence,
    };
  }
  const title = 'Not checked against the rate card';
  if (duplicate?.status === 'CONFIRMED') return { title, text: 'It came from review with no matched shipment and is a confirmed duplicate. Reject it.' };
  if (duplicate?.status === 'CLOSED') {
    return { title, text: 'It came from review with no matched shipment, and its corrected reading matches no other invoice. Approve it as billed, or reject it.' };
  }
  return { title, text: 'It came from review with no matched shipment and is not a duplicate. Approve it as billed, or reject it.' };
}

// The status counts as tabs and sums: all invoices, those waiting for a reviewer, those the pipeline still moves.
export function statusTotals(counts: { status: InvoiceStatus; count: number }[]) {
  const count = (status: InvoiceStatus) => counts.find((each) => each.status === status)?.count ?? 0;
  const sum = (statuses: Iterable<InvoiceStatus>) => [...statuses].reduce((total, status) => total + count(status), 0);
  return { count, all: sum(Object.keys(STATUS) as InvoiceStatus[]), waiting: sum(['RECONCILED', 'NEEDS_REVIEW']), processing: sum(IN_FLIGHT) };
}
// A tab's count: all invoices, or a status's. held is the checked invoices a reviewer holds (invoiceSummary's
// invoicesHeld), the billing issues; the other checked invoices are ready to approve.
export function filterCount(filter: Filter, totals: ReturnType<typeof statusTotals>, held: number) {
  if (!filter.status) return totals.all;
  const count = totals.count(filter.status);
  if (filter.open === undefined) return count;
  return filter.open ? held : Math.max(0, count - held);
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
  DISCREPANCY_CLOSED: 'Finding closed',
  REPLAYED: 'Replayed',
};

export const FIELD: Record<string, string> = { status: 'Status', carrier: 'Carrier', proNumber: 'PRO number', invoiceNumber: 'Invoice number' };

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
const statusWord = (status: string | null) => (status ? (STATUS[status.toUpperCase() as InvoiceStatus]?.label ?? status) : 'none');
// An audit detail in words: a review reason code, or free text such as a failure or a note.
const reasonText = (detail: string) => (/^[a-z_]+(:|$)/.test(detail) ? reviewReason(detail) : capital(detail));
// A field change in words: statuses by their labels, and on extraction the carrier as read and how it matched.
function changeText(entry: Entry, { field, from, to }: Entry['changes'][number]) {
  if (field === 'status') return `${entry.action === 'STATUS_CHANGED' ? '' : 'Status: '}${statusWord(from)} to ${statusWord(to)}`;
  if (field === 'carrier' && entry.action === 'STATUS_CHANGED') {
    return `Carrier read as “${from}”, ${to ? `matched ${to} ${CARRIER_MATCH[entry.detail ?? 'exact'] ?? ''}` : CARRIER_MATCH.no_match}`;
  }
  return `${FIELD[field] ?? field}: ${from ?? 'none'} to ${to ?? 'none'}`;
}

// A decision row's words by the kind of finding it decided: a charge, a possible duplicate, or one it cannot tell.
type Kind = 'charge' | 'duplicate' | 'finding';
const DECIDED: Record<Kind, Record<'DISCREPANCY_CONFIRMED' | 'DISCREPANCY_DISMISSED', string>> = {
  charge: { DISCREPANCY_CONFIRMED: ACTION.DISCREPANCY_CONFIRMED, DISCREPANCY_DISMISSED: ACTION.DISCREPANCY_DISMISSED },
  duplicate: { DISCREPANCY_CONFIRMED: 'Duplicate confirmed', DISCREPANCY_DISMISSED: 'Marked not a duplicate' },
  finding: { DISCREPANCY_CONFIRMED: 'Finding confirmed', DISCREPANCY_DISMISSED: 'Finding dismissed' },
};
type Decided = { id: string; type: DiscrepancyType };
// A row names the finding it decided or closed (discrepancyId). One that names none, as the sample's rows exported
// before the api named them, is a charge's on an invoice without a possible duplicate; otherwise it names no kind.
function decidedKind(entry: Entry, findings: readonly Decided[]): Kind {
  const finding = findings.find((each) => each.id === entry.discrepancyId);
  if (finding) return finding.type === 'DUPLICATE_INVOICE' ? 'duplicate' : 'charge';
  return findings.some((each) => each.type === 'DUPLICATE_INVOICE') ? 'finding' : 'charge';
}
const decidedWord = (status: string, kind: Kind) =>
  kind === 'finding' ? capital(status) : decisionLabel(status.toUpperCase() as DiscrepancyStatus, kind === 'duplicate' ? 'DUPLICATE_INVOICE' : undefined).label;

export type TrailRow = { id: string; at: string; verb: string; rest: string; notes: string[] };
// The audit trail in plain words: each pipeline move says what happened, reviewer rows say who did what. findings are
// the ones the reconcile run wrote; example data's Received entry says the seed, not a record, set its status.
export function trailRows(
  invoice: Pick<Detail, 'auditTrail' | 'extraction' | 'shipment' | 'carrier' | 'rateCardVersion' | 'status'>,
  findings: readonly Decided[],
  example = false,
): TrailRow[] {
  const seeded = invoice.status === 'APPROVED' ? 'Approved in the example data; no reviewer decision is recorded.' : 'Example data: the seed set this status; no pipeline or reviewer record exists.';
  let readingFrom: string | undefined;
  return invoice.auditTrail.map((entry) => {
    const row = (verb: string, rest = '', notes: string[] = []) => ({ id: entry.id, at: entry.at, verb, rest, notes });
    const by = entry.actor ? `by ${entry.actor}` : 'by the pipeline';
    const status = entry.changes.find((change) => change.field === 'status');
    if (entry.action === 'RECEIVED') return row('Received', 'by the pipeline', [...(entry.detail ? [entry.detail] : []), ...(example ? [seeded] : [])]);
    if (entry.action === 'DISCREPANCY_CONFIRMED' || entry.action === 'DISCREPANCY_DISMISSED' || entry.action === 'DISCREPANCY_CLOSED') {
      const kind = decidedKind(entry, findings);
      const verb = entry.action === 'DISCREPANCY_CLOSED' ? ACTION.DISCREPANCY_CLOSED : DECIDED[kind][entry.action];
      // The move from open is the verb itself; a decision that replaced another says which.
      const changed = status && status.from && status.from !== 'open' ? [`Changed from ${decidedWord(status.from, kind)}`] : [];
      return row(verb, by, entry.detail ? [...changed, reasonText(entry.detail)] : changed);
    }
    // An approval from review that found a possible duplicate moved the invoice to reconciled instead.
    if (entry.action === 'STATUS_CHANGED' && status?.from === 'needs_review' && status.to === 'reconciled') {
      return row('Held for a possible duplicate', `when ${entry.actor ?? 'a reviewer'} approved it as billed`, entry.detail ? [reasonText(entry.detail)] : []);
    }
    // With no shipment nothing was checked against the rate card, so the approval was as billed.
    if (entry.action === 'APPROVED' && !invoice.shipment) {
      return row('Approved as billed', by, ['Not checked against the rate card', ...(entry.detail ? [reasonText(entry.detail)] : [])]);
    }
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
    if (to === 'reconciling') return row('Checking started');
    if (from === 'reconciling' && to === 'reconciled') {
      const shipment = invoice.shipment ? `shipment ${invoice.shipment.reference}` : 'its shipment';
      const carrier = invoice.carrier ? ` and ${invoice.carrier}` : '';
      const card = invoice.rateCardVersion ? `rate card version ${invoice.rateCardVersion.version}` : 'the rate card';
      const next = findings.length > 0 ? `${plural(findings.length, 'finding')}, so it waits for a reviewer` : 'No findings, so it waits only for approval';
      return row('Matched', `to ${shipment}${carrier}, checked against ${card} by rules in code`, [next]);
    }
    if (to === 'needs_review') return row('Sent to review', by, [reviewReason(entry.detail)]);
    if (to === 'failed') return row('Failed', by, [entry.detail ? reasonText(entry.detail) : 'The step used up its retries.']);
    return row('Status changed', by, [changeText(entry, status)]);
  });
}

// The upload page's progress steps; a step index says which one is under way.
export const STEPS = ['Uploaded', 'Reading', 'Checking', 'Checked'] as const;
const SETTLED = new Set(['reconciled', 'needs_review', 'failed']);
type Recent = Omit<RecentUploadsQuery['invoices']['edges'][number]['node'], 'id' | 'filename' | 'number'>;
export type UploadState = { step?: number; done?: string; result: string; tone: 'ok' | 'warn' | 'bad' | 'accent' | 'faint'; rebill?: Words };
// A checked upload's result: what holds it, or how far it bills over the rate card.
function reconciledState(upload: Recent, findings: Recent['discrepancies']['edges'][number]['node'][]): Pick<UploadState, 'result' | 'tone'> {
  const { standingCents } = invoiceAmounts(upload.totalCents ?? 0, findings);
  const open = findings.filter((finding) => finding.status === 'OPEN').length;
  const label = statusLabel('RECONCILED', open, upload.hold);
  // A possible duplicate bills nothing over the rate card, so its hold says why it waits.
  const held = upload.hold && HELD[upload.hold];
  if (held) return { result: `${label}, ${held.toLowerCase()}`, tone: upload.hold === 'CONFIRMED_DUPLICATE' ? 'warn' : 'accent' };
  if (!upload.shipment) return { result: 'Ready to approve as billed, not checked against the rate card', tone: 'ok' };
  return standingCents > 0n
    ? { result: `${label}, +${formatMoney(standingCents, upload.currency)} over the rate card`, tone: 'accent' }
    : { result: 'Ready to approve, matched the rate card', tone: 'ok' };
}

// The toast once an upload settles while the page is open: what was read, and what now waits for the reviewer. A failure
// is an error toast, which stays until closed.
type Settled = Pick<Recent, 'status' | 'hold' | 'shipment' | 'reviewReason' | 'failureReason' | 'discrepancies'> & { number: string | null; filename: string };
export function finishedNote(upload: Settled): { text: string; tone: 'ok' | 'bad' } {
  const name = upload.number ? `Invoice ${upload.number}` : upload.filename;
  if (upload.status === 'FAILED') return { text: `${name} failed: ${upload.failureReason ? capital(upload.failureReason) : 'Used up its retries'}`, tone: 'bad' };
  if (upload.status === 'NEEDS_REVIEW') return { text: `${name} read: its reading needs a check`, tone: 'ok' };
  const open = upload.discrepancies.edges.filter(({ node }) => node.status === 'OPEN').length;
  if (open > 0) return { text: `${name} read: ${plural(open, 'finding')} to review`, tone: 'ok' };
  return { text: `${name} read: ${upload.shipment ? 'ready to approve' : 'ready to approve as billed'}`, tone: 'ok' };
}

// A recent upload: its step while in flight, else how long it took (upload to its first settled status) and the result.
export function uploadState(upload: Recent): UploadState {
  const created = Date.parse(upload.createdAt);
  if (IN_FLIGHT.has(upload.status)) {
    const step = upload.status === 'RECEIVED' || upload.status === 'EXTRACTING' ? 1 : 2;
    return { step, result: step === 1 ? 'Reading…' : 'Checking…', tone: 'faint' };
  }
  const settled = upload.auditTrail.find((entry) => entry.changes.some((change) => change.field === 'status' && SETTLED.has(change.to ?? '')));
  const done = settled ? `Done in ${duration(Date.parse(settled.at) - created)}` : 'Done';
  if (upload.status === 'RECONCILED') {
    const findings = upload.discrepancies.edges.map(({ node }) => node);
    // A re-bill says so beside its result, whatever else holds it.
    const earlier = findings.flatMap((finding) => (finding.earlierInvoice ? [finding.earlierInvoice] : []));
    const rebill = upload.shipment ? rebillRow(upload.shipment.reference, upload.lineItems.length, earlier) : undefined;
    const state = reconciledState(upload, findings);
    return { done, ...state, ...(rebill && { rebill }) };
  }
  if (upload.status === 'NEEDS_REVIEW') return { done, result: `${STATUS.NEEDS_REVIEW.label}: ${reviewReason(upload.reviewReason, true)}`, tone: 'warn' };
  if (upload.status === 'FAILED') return { done, result: `Failed: ${upload.failureReason ? capital(upload.failureReason) : 'Used up its retries'}`, tone: 'bad' };
  return { done, result: statusLabel(upload.status, 0, null, upload.shipment !== null), tone: upload.status === 'APPROVED' ? 'ok' : 'faint' };
}
