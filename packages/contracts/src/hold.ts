import type { DiscrepancyStatus, DiscrepancyType, InvoiceHold, InvoiceStatus } from './generated/graphql-client/graphql.ts';

// What holds a checked invoice back from approval, most pressing first, by the api's rule for Invoice.hold: for the web's
// pages that read every finding instead of that field, an invoice's own and the sample's. The api keeps the same rule in
// its held filter and hold loader; apps/api/src/hold.int.test.ts fails when the three disagree.
export function holdOf(status: InvoiceStatus, findings: readonly { type: DiscrepancyType; status: DiscrepancyStatus }[]): InvoiceHold | null {
  if (status !== 'RECONCILED') return null;
  const duplicate = (decision: DiscrepancyStatus) => findings.some((finding) => finding.type === 'DUPLICATE_INVOICE' && finding.status === decision);
  if (duplicate('CONFIRMED')) return 'CONFIRMED_DUPLICATE';
  if (duplicate('OPEN')) return 'POSSIBLE_DUPLICATE';
  return findings.some((finding) => finding.status === 'OPEN') ? 'OPEN_FINDINGS' : null;
}
