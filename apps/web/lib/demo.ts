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
import { type DashboardInvoice, dashboardOf, type InvoiceState } from '@freightaudit/domain';
import deadLetters from '../public/demo/dead-letters.json';
import discrepancies from '../public/demo/discrepancies.json';
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
export function demoInvoices({ status, open }: Pick<Filter, 'status' | 'open'> = {}, search?: string): InvoicesQuery {
  const words = search?.trim().slice(0, 100).toLowerCase();
  const rows = invoices.filter(
    (invoice) =>
      (!status || invoice.status === status) &&
      (open === undefined || (hold(invoice) !== null) === open) &&
      (!words || [invoice.number, invoice.proNumber, invoice.carrier].some((value) => value?.toLowerCase().includes(words))),
  );
  // ponytail: the sample fits one page of 25; page it by offset if an export ever holds more.
  return {
    invoices: {
      totalCount: rows.length,
      offset: 0,
      edges: rows.map((invoice) => ({ cursor: invoice.id, node: row(invoice) })),
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
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
// The overview ends on the day the newest invoice arrived, which all eleven share.
const newest = new Date(invoices[0]!.createdAt);
export const DEMO_OVERVIEW_NOTE = `The sample covers one week: its ${invoices.length} invoices arrived on ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(newest)}.`;

// The sample's overview, counted by packages/domain as the api counts its database. The sample made no model calls,
// so its cost and tokens stay empty and the page leaves them out.
export function demoDashboard(range: Range): DashboardQuery['dashboard'] {
  const { from, to } = rangeWindow(range, newest);
  const { window, previous, weeks, carriers } = dashboardOf(invoices.map(fact), from, to);
  const cents = <Row extends { overbilledCents: bigint }>(row: Row) => ({ ...row, overbilledCents: Number(row.overbilledCents) });
  return {
    window: { ...cents(window), modelCostPerInvoiceMicroUsd: null },
    previous: { received: previous.received, overbilledCents: Number(previous.overbilledCents) },
    weeks: weeks.map(cents),
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
export const demoDiscrepancies = (status?: DiscrepancyStatus): DiscrepanciesQuery => ({
  discrepancies: { ...sample.discrepancies.discrepancies, edges: sample.discrepancies.discrepancies.edges.filter(({ node }) => !status || node.status === status) },
});
export const demoDeadLetters = (status?: DeadLetterStatus): DeadLettersQuery => ({
  deadLetters: {
    ...sample.deadLetters.deadLetters,
    edges: sample.deadLetters.deadLetters.edges.filter(({ node }) => !status || (status === 'OPEN') === (node.replayedAt === null)),
  },
});
