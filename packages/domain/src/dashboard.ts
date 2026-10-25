// The overview's figures over the invoices received in a window of UTC days: how many matched the rate card, what they
// bill above it, how long the pipeline took, and the same per week and per carrier. The api reads the facts per invoice
// and the web's sample builds them from its files; both count them here.
import { type FindingAmounts, reviewAmounts } from './findings.ts';

export type InvoiceState = 'received' | 'extracting' | 'extracted' | 'reconciling' | 'reconciled' | 'needs_review' | 'approved' | 'rejected' | 'failed';
// One invoice as the figures see it. settledAt is the pipeline's first move to reconciled, needs_review or failed: null
// while it still moves, and on invoices from before the audit trail.
export type DashboardInvoice = {
  receivedAt: Date;
  status: InvoiceState;
  carrier: string | null;
  shipment: boolean;
  corrected: boolean;
  settledAt: Date | null;
  findings: readonly FindingAmounts[];
};

const DAY = 86_400_000;
const WEEKS = 8;
const CARRIERS = 5;
const time = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Midnight UTC of the Monday that starts a day's week.
const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
const within = (start: number, end: number) => (invoice: DashboardInvoice) => invoice.receivedAt.getTime() >= start && invoice.receivedAt.getTime() < end;

// Where a settled invoice ended: matched the rate card with nothing for a reviewer, needed one, or failed. Null while
// the pipeline still moves it.
export function outcomeOf({ status, shipment, corrected, findings }: DashboardInvoice) {
  if (status === 'failed') return 'failed';
  if (status === 'needs_review' || status === 'rejected') return 'reviewer';
  if (status !== 'reconciled' && status !== 'approved') return null;
  return shipment && findings.length === 0 && !corrected ? 'matched' : 'reviewer';
}

// What an invoice bills above the rate card: its standing findings, as the invoice list's Difference counts them.
const overbilled = (invoice: DashboardInvoice) => reviewAmounts(0n, invoice.findings).standingCents;
const total = (invoices: readonly DashboardInvoice[]) => invoices.reduce((sum, invoice) => sum + overbilled(invoice), 0n);

// The nearest-rank percentile of ascending values, as Postgres's percentile_disc gives it; null with none.
const rank = (sorted: readonly number[], p: number) => (sorted.length > 0 ? sorted[Math.ceil(p * sorted.length) - 1]! : null);

function windowOf(invoices: readonly DashboardInvoice[], start: number, last: number) {
  const kept = invoices.filter(within(start, last + DAY));
  const durations = kept.flatMap((invoice) => (invoice.settledAt ? [invoice.settledAt.getTime() - invoice.receivedAt.getTime()] : [])).sort((a, b) => a - b);
  return {
    from: dayOf(start),
    to: dayOf(last),
    received: kept.length,
    matchedRateCard: kept.filter((invoice) => outcomeOf(invoice) === 'matched').length,
    overbilledCents: total(kept),
    overbilledInvoices: kept.filter((invoice) => overbilled(invoice) > 0n).length,
    timed: durations.length,
    processingP50Ms: rank(durations, 0.5),
    processingP95Ms: rank(durations, 0.95),
  };
}

function weeksOf(invoices: readonly DashboardInvoice[], last: number) {
  return Array.from({ length: WEEKS }, (_, i) => {
    const start = mondayOf(last) - (WEEKS - 1 - i) * 7 * DAY;
    const kept = invoices.filter(within(start, start + 7 * DAY));
    const count = (outcome: ReturnType<typeof outcomeOf>) => kept.filter((invoice) => outcomeOf(invoice) === outcome).length;
    return { start: dayOf(start), matchedRateCard: count('matched'), neededReviewer: count('reviewer'), failed: count('failed'), overbilledCents: total(kept) };
  });
}

// The carriers that bill most above the rate card, ties by name.
function carriersOf(invoices: readonly DashboardInvoice[]) {
  const by = new Map<string, { carrier: string; overbilledCents: bigint; invoices: number }>();
  for (const invoice of invoices) {
    if (invoice.carrier === null) continue;
    const row = by.get(invoice.carrier) ?? { carrier: invoice.carrier, overbilledCents: 0n, invoices: 0 };
    const cents = overbilled(invoice);
    row.overbilledCents += cents;
    if (cents > 0n) row.invoices += 1;
    by.set(invoice.carrier, row);
  }
  return [...by.values()]
    .filter((row) => row.overbilledCents > 0n)
    .sort((a, b) => (a.overbilledCents === b.overbilledCents ? (a.carrier < b.carrier ? -1 : 1) : a.overbilledCents > b.overbilledCents ? -1 : 1))
    .slice(0, CARRIERS);
}

// The window from one UTC day to another, both whole; the same number of days just before it; the eight weeks, Monday to
// Sunday, ending with the week of to; and the carriers of the window.
export function dashboardOf(invoices: readonly DashboardInvoice[], from: string, to: string) {
  const start = time(from);
  const last = time(to);
  const days = (last - start) / DAY + 1;
  return {
    window: windowOf(invoices, start, last),
    previous: windowOf(invoices, start - days * DAY, start - DAY),
    weeks: weeksOf(invoices, last),
    carriers: carriersOf(invoices.filter(within(start, last + DAY))),
  };
}
export type Dashboard = ReturnType<typeof dashboardOf>;

// The received times dashboardOf reads: from the earlier of the previous window's first day and the first week's Monday,
// to the end of to.
export function dashboardSpan(from: string, to: string) {
  const start = time(from);
  const end = time(to) + DAY;
  return { start: new Date(Math.min(start - (end - start), mondayOf(time(to)) - (WEEKS - 1) * 7 * DAY)), end: new Date(end) };
}
