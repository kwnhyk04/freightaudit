import type {
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
import deadLetters from '../public/demo/dead-letters.json';
import discrepancies from '../public/demo/discrepancies.json';
import details from '../public/demo/invoice-details.json';
import { type Filter, invoiceAmounts, STATUS } from './labels.ts';

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
    openDeadLetters: sample.deadLetters.deadLetters.edges.filter(({ node }) => node.replayedAt === null).length,
  };
}

export const demoInvoice = (id: string): InvoiceQuery | undefined => sample.details[id];
export const demoDiscrepancies = (status?: DiscrepancyStatus): DiscrepanciesQuery => ({
  discrepancies: { ...sample.discrepancies.discrepancies, edges: sample.discrepancies.discrepancies.edges.filter(({ node }) => !status || node.status === status) },
});
export const demoDeadLetters = (status?: DeadLetterStatus): DeadLettersQuery => ({
  deadLetters: {
    ...sample.deadLetters.deadLetters,
    edges: sample.deadLetters.deadLetters.edges.filter(({ node }) => !status || (status === 'OPEN') === (node.replayedAt === null)),
  },
});
