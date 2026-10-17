import type { DeadLettersQuery, DeadLetterStatus, DiscrepanciesQuery, DiscrepancyStatus, InvoiceQuery, InvoicesQuery, InvoiceStatus } from '@freightaudit/contracts/graphql';
import deadLetters from '../public/demo/dead-letters.json';
import discrepancies from '../public/demo/discrepancies.json';
import details from '../public/demo/invoice-details.json';
import invoices from '../public/demo/invoices.json';

// The public sample: synthetic golden invoices that scripts/export-demo.ts saved in the shapes the live queries return.
// Read from these files only, never from the API, and filtered in memory (there are ten).
const sample = {
  invoices: invoices as unknown as InvoicesQuery,
  details: details as unknown as Record<string, InvoiceQuery>,
  discrepancies: discrepancies as unknown as DiscrepanciesQuery,
  deadLetters: deadLetters as unknown as DeadLettersQuery,
};

export const demoInvoices = (status?: InvoiceStatus): InvoicesQuery => ({
  invoices: { ...sample.invoices.invoices, edges: sample.invoices.invoices.edges.filter(({ node }) => !status || node.status === status) },
});
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
