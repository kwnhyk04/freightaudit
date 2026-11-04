import type {
  DashboardQuery,
  DeadLettersQuery,
  DeadLetterStatus,
  DiscrepanciesQuery,
  DiscrepancyStatus,
  InvoiceQuery,
  InvoicesQuery,
  InvoiceStatus,
  InvoiceSummaryQuery,
} from '@freightaudit/contracts/graphql';
import { holdOf } from '@freightaudit/contracts/hold';
import { type DashboardInvoice, dashboardOf, type FindingAmounts, type InvoiceState } from '@freightaudit/domain';
import deadLetters from '../public/demo/dead-letters.json';
import discrepancies from '../public/demo/discrepancies.json';
import history from './demo-history.json';
import details from '../public/demo/invoice-details.json';
import { type Filter, findingAmounts, invoiceAmounts, SETTLED, STATUS } from './labels.ts';
import { type Range, rangeWindow } from './overview.ts';

// The public sample: synthetic golden invoices that scripts/export-demo.ts saved in the shapes the live queries return.
// Read from these files only, never from the API, and filtered and counted in memory (there are eleven).
const sample = {
  details: details as unknown as Record<string, InvoiceQuery>,
  discrepancies: discrepancies as unknown as DiscrepanciesQuery,
  deadLetters: deadLetters as unknown as DeadLettersQuery,
};
type Detail = NonNullable<InvoiceQuery['invoice']>;
// Newest first, as the api orders them.
const invoices = Object.values(sample.details)
  .flatMap(({ invoice }) => (invoice ? [invoice] : []))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
const hold = (invoice: Detail) => holdOf(invoice.status, invoice.discrepancies.edges.map(({ node }) => node));
const openDeadLetters = sample.deadLetters.deadLetters.edges.filter(({ node }) => node.replayedAt === null).length;

// A list row from the snapshot's detail, which holds every field the list asks for.
const row = (invoice: Detail): InvoicesQuery['invoices']['edges'][number]['node'] => ({
  id: invoice.id,
  status: invoice.status,
  filename: invoice.filename,
  carrier: invoice.carrier,
  number: invoice.number,
  issuedOn: invoice.issuedOn,
  currency: invoice.currency,
  totalCents: invoice.totalCents,
  createdAt: invoice.createdAt,
  openDiscrepancyCount: invoice.openDiscrepancyCount,
  hold: hold(invoice),
  reviewReason: invoice.reviewReason,
  failureReason: invoice.failureReason,
  shipment: invoice.shipment && { id: invoice.shipment.id },
  rateCardVersion: invoice.rateCardVersion && { id: invoice.rateCardVersion.id },
  discrepancies: {
    edges: invoice.discrepancies.edges.map(({ node }) => ({ node: { id: node.id, status: node.status, expectedCents: node.expectedCents, billedCents: node.billedCents } })),
  },
});

// The api's filters: a status, whether a reviewer holds the invoice, and invoice number, PRO number or carrier name
// containing the words, ignoring case.
// One page of the sample, as the api pages a list by offset; without a window, all of it.
type Window = { offset: number; size: number };
const ALL: Window = { offset: 0, size: Infinity };
function paged<Edge>(edges: Edge[], { offset, size }: Window) {
  return { edges: edges.slice(offset, offset + size), totalCount: edges.length, offset, hasNextPage: offset + size < edges.length, hasPreviousPage: offset > 0 };
}

export function demoInvoices({ status, open }: Pick<Filter, 'status' | 'open'> = {}, search?: string, window = ALL): InvoicesQuery {
  const words = search?.trim().slice(0, 100).toLowerCase();
  const rows = invoices.filter(
    (invoice) =>
      (!status || invoice.status === status) &&
      (open === undefined || (hold(invoice) !== null) === open) &&
      (!words || [invoice.number, invoice.proNumber, invoice.carrier].some((value) => value?.toLowerCase().includes(words))),
  );
  const { edges, totalCount, offset, hasNextPage, hasPreviousPage } = paged(rows, window);
  return {
    invoices: {
      totalCount,
      offset,
      edges: edges.map((invoice) => ({ cursor: invoice.id, node: row(invoice) })),
      pageInfo: { hasNextPage, hasPreviousPage, startCursor: null, endCursor: null },
    },
  };
}

// The summary the api would give for the sample. Findings are written as an invoice reconciles, so each open one dates
// from its invoice's move to reconciled.
export function demoSummary(): InvoiceSummaryQuery['invoiceSummary'] {
  const open = invoices.filter((invoice) => invoice.openDiscrepancyCount > 0);
  const findings = open.flatMap((invoice) => invoice.discrepancies.edges.map(({ node }) => node).filter((node) => node.status === 'OPEN'));
  const found = (invoice: Detail) => invoice.auditTrail.find((entry) => entry.changes.some((change) => change.field === 'status' && change.to === 'reconciled'))?.at;
  const week = Date.now() - 7 * 86_400_000;
  return {
    statusCounts: (Object.keys(STATUS) as InvoiceStatus[]).map((status) => ({ status, count: invoices.filter((invoice) => invoice.status === status).length })),
    receivedLast7Days: invoices.filter((invoice) => Date.parse(invoice.createdAt) >= week).length,
    openFindings: findings.length,
    invoicesWithOpenFindings: open.length,
    invoicesHeld: invoices.filter((invoice) => hold(invoice) !== null).length,
    oldestOpenFindingAt: open.map(found).filter((at) => at !== undefined).sort()[0] ?? null,
    openOverchargeCents: Number(invoiceAmounts(0, findings).openCents),
    matchedRateCard: invoices.filter((invoice) => invoice.status === 'RECONCILED' && invoice.discrepancies.edges.length === 0).length,
    openDeadLetters,
  };
}

// An invoice as the overview counts it. It settled at the pipeline's first stop, read from its trail as the api reads
// it: a reviewer's moves name the reviewer.
function fact(invoice: Detail): DashboardInvoice {
  const settled = invoice.auditTrail.find(
    (entry) => !entry.actor && entry.action === 'STATUS_CHANGED' && entry.changes.some((change) => change.field === 'status' && SETTLED.has(change.to ?? '')),
  );
  return {
    receivedAt: new Date(invoice.createdAt),
    status: invoice.status.toLowerCase() as InvoiceState,
    carrier: invoice.carrier,
    shipment: invoice.shipment !== null,
    corrected: invoice.auditTrail.some((entry) => entry.action === 'CORRECTED'),
    settledAt: settled ? new Date(settled.at) : null,
    findings: invoice.discrepancies.edges.map(({ node }) => findingAmounts(node)),
  };
}
// The generated history (scripts/demo-history.ts) as the overview counts it: figures only, with no page to open.
const generated: DashboardInvoice[] = history.map((row) => ({
  receivedAt: new Date(row.receivedAt),
  status: row.status as InvoiceState,
  carrier: row.carrier,
  shipment: row.shipment,
  corrected: row.corrected,
  settledAt: new Date(row.settledAt),
  findings: row.findings.map((each) => ({ status: each.status as FindingAmounts['status'], billedCents: BigInt(each.billedCents), expectedCents: BigInt(each.expectedCents) })),
}));
// The overview ends on the day the newest invoice arrived, which all eleven share.
const newest = new Date(invoices[0]!.createdAt);
// The sample's span: the first generated invoice's day to the newest day.
const day = (at: Date, year: boolean) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(at);
export const DEMO_OVERVIEW_NOTE = `Sample data from ${day(generated[0]!.receivedAt, false)} to ${day(newest, true)}: ${invoices.length} invoices you can open, plus ${generated.length.toLocaleString('en-US')} generated ones that only feed these charts.`;

// The sample's overview, counted by packages/domain as the api counts its database. The sample made no model calls,
// so its cost and tokens stay empty and the page leaves them out.
export function demoDashboard(range: Range): DashboardQuery['dashboard'] {
  const { from, to } = rangeWindow(range, newest);
  const { window, previous, weeks, days, carriers } = dashboardOf([...invoices.map(fact), ...generated], from, to);
  const cents = <Row extends { overbilledCents: bigint }>(row: Row) => ({ ...row, overbilledCents: Number(row.overbilledCents) });
  return {
    window: { ...cents(window), modelCostPerInvoiceMicroUsd: null },
    previous: { received: previous.received, overbilledCents: Number(previous.overbilledCents) },
    weeks: weeks.map(cents),
    days: days.map(cents),
    carriers: carriers.map(cents),
    pipeline: {
      waitingToBeRead: invoices.filter((invoice) => invoice.status === 'RECEIVED' || invoice.status === 'EXTRACTING').length,
      openDeadLetters,
      claudeTokensToday: 0,
      freeModelTokensToday: 0,
    },
  };
}

export const demoInvoice = (id: string): InvoiceQuery | undefined => sample.details[id];
// A sample invoice by its golden file name, which stays the same when the sample is exported again; its id does not.
export const demoInvoiceFile = (filename: string) => invoices.find((invoice) => invoice.filename === filename);
export function demoDiscrepancies(status?: DiscrepancyStatus, window = ALL): DiscrepanciesQuery {
  const { edges, totalCount, offset, hasNextPage } = paged(
    sample.discrepancies.discrepancies.edges.filter(({ node }) => !status || node.status === status),
    window,
  );
  return { discrepancies: { edges, totalCount, offset, pageInfo: { hasNextPage, endCursor: null } } };
}
export function demoDeadLetters(status?: DeadLetterStatus, window = ALL): DeadLettersQuery {
  const { edges, totalCount, offset, hasNextPage } = paged(
    sample.deadLetters.deadLetters.edges.filter(({ node }) => !status || (status === 'OPEN') === (node.replayedAt === null)),
    window,
  );
  return { deadLetters: { edges, totalCount, offset, pageInfo: { hasNextPage, endCursor: null } } };
}
