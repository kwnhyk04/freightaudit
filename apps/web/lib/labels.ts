import type { AuditAction, DiscrepancyStatus, DiscrepancyType, InvoiceStatus } from '@freightaudit/contracts/graphql';

// The words the UI uses for the API's codes. Color always comes with a word, never alone.
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'busy';

export const STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  RECEIVED: { label: 'Received', tone: 'busy' },
  EXTRACTING: { label: 'Extracting', tone: 'busy' },
  EXTRACTED: { label: 'Extracted', tone: 'busy' },
  RECONCILING: { label: 'Reconciling', tone: 'busy' },
  RECONCILED: { label: 'Reconciled', tone: 'neutral' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'bad' },
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

export const DECISION: Record<DiscrepancyStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'bad' },
  CONFIRMED: { label: 'Disputed', tone: 'neutral' },
  DISMISSED: { label: 'Charge approved', tone: 'ok' },
};

// Why an invoice needs review, in words a reviewer can act on.
export function reviewReason(code: string | null | undefined) {
  if (!code) return 'The extraction could not be trusted.';
  if (code === 'no_shipment_match') return 'No shipment matches this carrier and PRO number.';
  if (code === 'missing_currency') return 'The invoice shows no currency.';
  if (code.startsWith('unsupported_currency')) return `Billed in ${code.split(':')[1]?.trim() ?? 'another currency'}; rate cards are in USD.`;
  if (code.startsWith('fallback_page_cap')) return 'The scan has more pages than the fallback model reads.';
  return "The model's reading failed validation.";
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
