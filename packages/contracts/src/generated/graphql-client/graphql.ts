/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** Kind of entry in an invoice's audit trail. */
export type AuditAction =
  /** A reviewer approved the invoice for payment. */
  | 'APPROVED'
  /** A reviewer corrected the carrier or PRO number and matching ran again. */
  | 'CORRECTED'
  /**
   * A discrepancy closed undecided because a reviewer rejected its invoice, or corrected a held invoice's reading so that
   * no other invoice matches it.
   */
  | 'DISCREPANCY_CLOSED'
  /** A reviewer confirmed a discrepancy: the overcharge is disputed. */
  | 'DISCREPANCY_CONFIRMED'
  /** A reviewer dismissed a discrepancy: the billed amount stands. */
  | 'DISCREPANCY_DISMISSED'
  /** The file was uploaded. */
  | 'RECEIVED'
  /** A reviewer rejected the invoice. */
  | 'REJECTED'
  /** A dead letter's job was run again. */
  | 'REPLAYED'
  /** The pipeline moved the invoice to another status. */
  | 'STATUS_CHANGED';

/** How a carrier name read from a document matched a known carrier. */
export type CarrierMatch =
  /** The reading holds the known name as whole words, as beside a title line. */
  | 'CONTAINED'
  /** Printed exactly as the known name. */
  | 'EXACT'
  /** Equal after normalizing case, spacing and Unicode forms. */
  | 'NORMALIZED';

/** Review state of a dead letter. */
export type DeadLetterStatus =
  /** Waiting for a replay. */
  | 'OPEN'
  /** Its job was run again. */
  | 'REPLAYED';

/** Reviewer decision on a discrepancy. */
export type DiscrepancyDecision =
  /** The overcharge is real. */
  | 'CONFIRM'
  /** False flag; the billed amount stands. */
  | 'DISMISS';

/** Review state of a discrepancy. */
export type DiscrepancyStatus =
  /**
   * Closed undecided when a reviewer rejected the invoice, or when a held invoice's corrected reading matched no other
   * invoice.
   */
  | 'CLOSED'
  | 'CONFIRMED'
  | 'DISMISSED'
  | 'OPEN';

/** Kind of mismatch between billed and expected charges. */
export type DiscrepancyType =
  | 'ARITHMETIC_ERROR'
  | 'DUPLICATE_CHARGE'
  /**
   * Another invoice from the same carrier has the same number: a possible duplicate of the whole invoice, with no line and
   * no money. It is decided on its own; while it is open, the invoice takes no bulk decision and cannot be approved.
   * Confirmed, it keeps the invoice from approval by any decision, and a reviewer rejects the invoice instead.
   */
  | 'DUPLICATE_INVOICE'
  | 'RATE_MISMATCH'
  | 'UNCONTRACTED_CHARGE'
  | 'WEIGHT_MISMATCH';

/** A reviewer's decision on every open discrepancy of an invoice at once. */
export type InvoiceDecision =
  /** Dismiss every open discrepancy, so the billed amounts stand, then approve the invoice. */
  | 'APPROVE_AS_BILLED'
  /** Confirm every open discrepancy, then approve the invoice: what the rate card allows is paid. */
  | 'APPROVE_AT_RATE_CARD'
  /** Confirm every open discrepancy: the overcharges are disputed, and the invoice stays reconciled. */
  | 'DISPUTE';

/** Why a checked invoice waits on a reviewer before approval, most pressing first. */
export type InvoiceHold =
  /** A possible duplicate was confirmed: the invoice is never approved and waits to be rejected. */
  | 'CONFIRMED_DUPLICATE'
  /** A discrepancy waits for a decision. */
  | 'OPEN_FINDINGS'
  /** A possible duplicate is open; it is decided on its own, before the charges. */
  | 'POSSIBLE_DUPLICATE';

/** Processing status of an invoice. */
export type InvoiceStatus =
  /** Approved for payment. Final. */
  | 'APPROVED'
  /** Header and lines extracted; waiting for reconciliation. */
  | 'EXTRACTED'
  /** Extraction is running. */
  | 'EXTRACTING'
  /** A step used up its retries; replaying its dead letter restarts that step. */
  | 'FAILED'
  /** The extraction could not be trusted, such as a carrier or PRO number that matches no shipment; a person must check the document, then correct it, approve it or reject it. */
  | 'NEEDS_REVIEW'
  /** Stored; waiting for extraction. */
  | 'RECEIVED'
  /** Checked against the shipment and rate card; each finding waits as an open discrepancy. Approval follows once every discrepancy has a decision; a reviewer may reject the invoice instead. An invoice approved as billed from NEEDS_REVIEW that may duplicate another one waits here too, with no shipment, never checked against the rate card. */
  | 'RECONCILED'
  /** Matching against the shipment and rate card is running. */
  | 'RECONCILING'
  /** A reviewer refused the invoice for payment. Final. */
  | 'REJECTED';

/** A discrepancy as the reviewer saw it. */
export type SeenDiscrepancy = {
  id: string | number;
  /** Its version when the reviewer's page loaded. */
  version: string;
};

export type ApproveInvoiceMutationVariables = Exact<{
  id: string | number;
}>;


export type ApproveInvoiceMutation = { approveInvoice: { id: string, status: InvoiceStatus } };

export type CorrectInvoiceMutationVariables = Exact<{
  id: string | number;
  carrierId?: string | number | null | undefined;
  proNumber?: string | null | undefined;
}>;


export type CorrectInvoiceMutation = { correctInvoice: { id: string, status: InvoiceStatus } };

export type DeadLettersQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
  status?: DeadLetterStatus | null | undefined;
}>;


export type DeadLettersQuery = { deadLetters: { edges: Array<{ cursor: string, node: { id: string, queue: string, jobId: string, error: string, attempts: number, createdAt: string, replayedAt: string | null, invoice: { id: string, number: string | null, filename: string, carrier: string | null, status: InvoiceStatus } | null } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type DecideInvoiceMutationVariables = Exact<{
  id: string | number;
  decision: InvoiceDecision;
  seen: Array<SeenDiscrepancy> | SeenDiscrepancy;
  requestId: string | number;
}>;


export type DecideInvoiceMutation = { decideInvoice: { id: string, status: InvoiceStatus } };

export type DiscrepanciesQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
  status?: DiscrepancyStatus | null | undefined;
}>;


export type DiscrepanciesQuery = { discrepancies: { edges: Array<{ cursor: string, node: { id: string, type: DiscrepancyType, status: DiscrepancyStatus, expectedCents: number, billedCents: number, evidence: string, note: string | null, resolvedAt: string | null, lineItem: { id: string, lineNumber: number, description: string, chargeCode: string | null } | null, invoice: { id: string, number: string | null, filename: string, carrier: string | null, currency: string | null, status: InvoiceStatus } } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type InvoiceBriefQueryVariables = Exact<{
  id: string | number;
}>;


export type InvoiceBriefQuery = { invoice: { id: string, number: string | null, filename: string, createdAt: string } | null };

export type InvoiceSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type InvoiceSummaryQuery = { invoiceSummary: { receivedLast7Days: number, openFindings: number, invoicesWithOpenFindings: number, invoicesHeld: number, oldestOpenFindingAt: string | null, openOverchargeCents: number, matchedRateCard: number, openDeadLetters: number, statusCounts: Array<{ status: InvoiceStatus, count: number }> } };

export type InvoiceQueryVariables = Exact<{
  id: string | number;
}>;


export type InvoiceQuery = { invoice: { id: string, status: InvoiceStatus, failureReason: string | null, reviewReason: string | null, filename: string, contentHash: string, carrier: string | null, number: string | null, proNumber: string | null, issuedOn: string | null, currency: string | null, totalCents: number | null, createdAt: string, openDiscrepancyCount: number, lineItems: Array<{ id: string, lineNumber: number, description: string, chargeCode: string | null, amountCents: number }>, extraction: { id: string, model: string, step: string | null, carrierRead: string | null, carrierMatch: CarrierMatch | null, problems: Array<string>, extractedAt: string, lines: Array<{ lineNumber: number, description: string, chargeCode: string | null, amountCents: number }> } | null, shipment: { id: string, reference: string, carrier: string, origin: string, destination: string, shippedOn: string } | null, rateCardVersion: { id: string, version: number, effectiveFrom: string | null, effectiveTo: string | null } | null, discrepancies: { edges: Array<{ node: { id: string, type: DiscrepancyType, status: DiscrepancyStatus, expectedCents: number, billedCents: number, evidence: string, note: string | null, resolvedAt: string | null, version: string, lineItem: { id: string, lineNumber: number } | null } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } }, auditTrail: Array<{ id: string, at: string, actor: string | null, action: AuditAction, detail: string | null, discrepancyId: string | null, changes: Array<{ field: string, from: string | null, to: string | null }> }>, deadLetter: { id: string, queue: string, error: string, createdAt: string } | null } | null, carriers: Array<{ id: string, name: string }> };

export type InvoicesQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
  last?: number | null | undefined;
  before?: string | null | undefined;
  status?: InvoiceStatus | null | undefined;
  hasOpenFindings?: boolean | null | undefined;
  search?: string | null | undefined;
}>;


export type InvoicesQuery = { invoices: { totalCount: number, offset: number, edges: Array<{ cursor: string, node: { id: string, status: InvoiceStatus, filename: string, carrier: string | null, number: string | null, issuedOn: string | null, currency: string | null, totalCents: number | null, createdAt: string, openDiscrepancyCount: number, hold: InvoiceHold | null, reviewReason: string | null, failureReason: string | null, shipment: { id: string } | null, rateCardVersion: { id: string } | null, discrepancies: { edges: Array<{ node: { id: string, status: DiscrepancyStatus, expectedCents: number, billedCents: number } }> } } }>, pageInfo: { hasNextPage: boolean, hasPreviousPage: boolean, startCursor: string | null, endCursor: string | null } } };

export type RecentUploadsQueryVariables = Exact<{ [key: string]: never; }>;


export type RecentUploadsQuery = { invoices: { edges: Array<{ node: { id: string, status: InvoiceStatus, filename: string, currency: string | null, totalCents: number | null, createdAt: string, reviewReason: string | null, failureReason: string | null, hold: InvoiceHold | null, shipment: { id: string } | null, discrepancies: { edges: Array<{ node: { id: string, status: DiscrepancyStatus, expectedCents: number, billedCents: number } }> }, auditTrail: Array<{ id: string, at: string, action: AuditAction, changes: Array<{ field: string, to: string | null }> }> } }> } };

export type RejectInvoiceMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type RejectInvoiceMutation = { rejectInvoice: { id: string, status: InvoiceStatus } };

export type ReplayDeadLetterMutationVariables = Exact<{
  id: string | number;
}>;


export type ReplayDeadLetterMutation = { replayDeadLetter: { id: string, replayedAt: string | null } };

export type ResolveDiscrepancyMutationVariables = Exact<{
  id: string | number;
  decision: DiscrepancyDecision;
  note?: string | null | undefined;
}>;


export type ResolveDiscrepancyMutation = { resolveDiscrepancy: { id: string, status: DiscrepancyStatus, note: string | null, resolvedAt: string | null } };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const ApproveInvoiceDocument = new TypedDocumentString(`
    mutation ApproveInvoice($id: ID!) {
  approveInvoice(id: $id) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<ApproveInvoiceMutation, ApproveInvoiceMutationVariables>;
export const CorrectInvoiceDocument = new TypedDocumentString(`
    mutation CorrectInvoice($id: ID!, $carrierId: ID, $proNumber: String) {
  correctInvoice(id: $id, carrierId: $carrierId, proNumber: $proNumber) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<CorrectInvoiceMutation, CorrectInvoiceMutationVariables>;
export const DeadLettersDocument = new TypedDocumentString(`
    query DeadLetters($first: Int, $after: String, $status: DeadLetterStatus) {
  deadLetters(first: $first, after: $after, status: $status) {
    edges {
      cursor
      node {
        id
        queue
        jobId
        error
        attempts
        createdAt
        replayedAt
        invoice {
          id
          number
          filename
          carrier
          status
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
    `) as unknown as TypedDocumentString<DeadLettersQuery, DeadLettersQueryVariables>;
export const DecideInvoiceDocument = new TypedDocumentString(`
    mutation DecideInvoice($id: ID!, $decision: InvoiceDecision!, $seen: [SeenDiscrepancy!]!, $requestId: ID!) {
  decideInvoice(id: $id, decision: $decision, seen: $seen, requestId: $requestId) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<DecideInvoiceMutation, DecideInvoiceMutationVariables>;
export const DiscrepanciesDocument = new TypedDocumentString(`
    query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {
  discrepancies(first: $first, after: $after, status: $status) {
    edges {
      cursor
      node {
        id
        type
        status
        expectedCents
        billedCents
        evidence
        note
        resolvedAt
        lineItem {
          id
          lineNumber
          description
          chargeCode
        }
        invoice {
          id
          number
          filename
          carrier
          currency
          status
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
    `) as unknown as TypedDocumentString<DiscrepanciesQuery, DiscrepanciesQueryVariables>;
export const InvoiceBriefDocument = new TypedDocumentString(`
    query InvoiceBrief($id: ID!) {
  invoice(id: $id) {
    id
    number
    filename
    createdAt
  }
}
    `) as unknown as TypedDocumentString<InvoiceBriefQuery, InvoiceBriefQueryVariables>;
export const InvoiceSummaryDocument = new TypedDocumentString(`
    query InvoiceSummary {
  invoiceSummary {
    statusCounts {
      status
      count
    }
    receivedLast7Days
    openFindings
    invoicesWithOpenFindings
    invoicesHeld
    oldestOpenFindingAt
    openOverchargeCents
    matchedRateCard
    openDeadLetters
  }
}
    `) as unknown as TypedDocumentString<InvoiceSummaryQuery, InvoiceSummaryQueryVariables>;
export const InvoiceDocument = new TypedDocumentString(`
    query Invoice($id: ID!) {
  invoice(id: $id) {
    id
    status
    failureReason
    reviewReason
    filename
    contentHash
    carrier
    number
    proNumber
    issuedOn
    currency
    totalCents
    createdAt
    openDiscrepancyCount
    lineItems {
      id
      lineNumber
      description
      chargeCode
      amountCents
    }
    extraction {
      id
      model
      step
      carrierRead
      carrierMatch
      problems
      extractedAt
      lines {
        lineNumber
        description
        chargeCode
        amountCents
      }
    }
    shipment {
      id
      reference
      carrier
      origin
      destination
      shippedOn
    }
    rateCardVersion {
      id
      version
      effectiveFrom
      effectiveTo
    }
    discrepancies(first: 100) {
      edges {
        node {
          id
          type
          status
          expectedCents
          billedCents
          evidence
          note
          resolvedAt
          version
          lineItem {
            id
            lineNumber
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    auditTrail {
      id
      at
      actor
      action
      detail
      changes {
        field
        from
        to
      }
      discrepancyId
    }
    deadLetter {
      id
      queue
      error
      createdAt
    }
  }
  carriers {
    id
    name
  }
}
    `) as unknown as TypedDocumentString<InvoiceQuery, InvoiceQueryVariables>;
export const InvoicesDocument = new TypedDocumentString(`
    query Invoices($first: Int, $after: String, $last: Int, $before: String, $status: InvoiceStatus, $hasOpenFindings: Boolean, $search: String) {
  invoices(
    first: $first
    after: $after
    last: $last
    before: $before
    status: $status
    hasOpenFindings: $hasOpenFindings
    search: $search
  ) {
    totalCount
    offset
    edges {
      cursor
      node {
        id
        status
        filename
        carrier
        number
        issuedOn
        currency
        totalCents
        createdAt
        openDiscrepancyCount
        hold
        reviewReason
        failureReason
        shipment {
          id
        }
        rateCardVersion {
          id
        }
        discrepancies(first: 100) {
          edges {
            node {
              id
              status
              expectedCents
              billedCents
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
    `) as unknown as TypedDocumentString<InvoicesQuery, InvoicesQueryVariables>;
export const RecentUploadsDocument = new TypedDocumentString(`
    query RecentUploads {
  invoices(first: 5) {
    edges {
      node {
        id
        status
        filename
        currency
        totalCents
        createdAt
        reviewReason
        failureReason
        hold
        shipment {
          id
        }
        discrepancies(first: 100) {
          edges {
            node {
              id
              status
              expectedCents
              billedCents
            }
          }
        }
        auditTrail {
          id
          at
          action
          changes {
            field
            to
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<RecentUploadsQuery, RecentUploadsQueryVariables>;
export const RejectInvoiceDocument = new TypedDocumentString(`
    mutation RejectInvoice($id: ID!, $reason: String!) {
  rejectInvoice(id: $id, reason: $reason) {
    id
    status
  }
}
    `) as unknown as TypedDocumentString<RejectInvoiceMutation, RejectInvoiceMutationVariables>;
export const ReplayDeadLetterDocument = new TypedDocumentString(`
    mutation ReplayDeadLetter($id: ID!) {
  replayDeadLetter(id: $id) {
    id
    replayedAt
  }
}
    `) as unknown as TypedDocumentString<ReplayDeadLetterMutation, ReplayDeadLetterMutationVariables>;
export const ResolveDiscrepancyDocument = new TypedDocumentString(`
    mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {
  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {
    id
    status
    note
    resolvedAt
  }
}
    `) as unknown as TypedDocumentString<ResolveDiscrepancyMutation, ResolveDiscrepancyMutationVariables>;