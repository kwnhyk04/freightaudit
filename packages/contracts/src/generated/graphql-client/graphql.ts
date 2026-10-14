/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** Reviewer decision on a discrepancy. */
export type DiscrepancyDecision =
  /** The overcharge is real. */
  | 'CONFIRM'
  /** False flag; the billed amount stands. */
  | 'DISMISS';

/** Review state of a discrepancy. */
export type DiscrepancyStatus =
  | 'CONFIRMED'
  | 'DISMISSED'
  | 'OPEN';

/** Kind of mismatch between billed and expected charges. */
export type DiscrepancyType =
  | 'ARITHMETIC_ERROR'
  | 'DUPLICATE_CHARGE'
  | 'RATE_MISMATCH'
  | 'UNCONTRACTED_CHARGE'
  | 'WEIGHT_MISMATCH';

/** Processing status of an invoice. */
export type InvoiceStatus =
  | 'APPROVED'
  | 'EXTRACTING'
  | 'FAILED'
  | 'NEEDS_REVIEW'
  | 'RECEIVED'
  | 'RECONCILING';

export type ApproveInvoiceMutationVariables = Exact<{
  id: string | number;
}>;


export type ApproveInvoiceMutation = { approveInvoice: { id: string, status: InvoiceStatus } };

export type DiscrepanciesQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
  status?: DiscrepancyStatus | null | undefined;
}>;


export type DiscrepanciesQuery = { discrepancies: { edges: Array<{ cursor: string, node: { id: string, type: DiscrepancyType, status: DiscrepancyStatus, expectedCents: number, billedCents: number, invoice: { id: string, number: string | null, carrier: string | null } } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type InvoiceQueryVariables = Exact<{
  id: string | number;
}>;


export type InvoiceQuery = { invoice: { id: string, status: InvoiceStatus, filename: string, carrier: string | null, number: string | null, issuedOn: string | null, currency: string | null, totalCents: number | null, lineItems: Array<{ id: string, lineNumber: number, description: string, chargeCode: string | null, amountCents: number }>, shipment: { id: string, reference: string, origin: string, destination: string, shippedOn: string } | null, rateCardVersion: { id: string, version: number, effectiveFrom: string } | null, discrepancies: { edges: Array<{ node: { id: string, type: DiscrepancyType, status: DiscrepancyStatus, expectedCents: number, billedCents: number, evidence: string, note: string | null, lineItem: { id: string } | null } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } } | null };

export type InvoicesQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
  status?: InvoiceStatus | null | undefined;
}>;


export type InvoicesQuery = { invoices: { edges: Array<{ cursor: string, node: { id: string, status: InvoiceStatus, filename: string, carrier: string | null, number: string | null, issuedOn: string | null, totalCents: number | null, createdAt: string } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type ResolveDiscrepancyMutationVariables = Exact<{
  id: string | number;
  decision: DiscrepancyDecision;
  note?: string | null | undefined;
}>;


export type ResolveDiscrepancyMutation = { resolveDiscrepancy: { id: string, status: DiscrepancyStatus, note: string | null, resolvedAt: string | null } };


export const ApproveInvoiceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ApproveInvoice"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"approveInvoice"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ApproveInvoiceMutation, ApproveInvoiceMutationVariables>;
export const DiscrepanciesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Discrepancies"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"DiscrepancyStatus"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"discrepancies"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCents"}},{"kind":"Field","name":{"kind":"Name","value":"billedCents"}},{"kind":"Field","name":{"kind":"Name","value":"invoice"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"carrier"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]} as unknown as DocumentNode<DiscrepanciesQuery, DiscrepanciesQueryVariables>;
export const InvoiceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Invoice"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invoice"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"carrier"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"issuedOn"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"totalCents"}},{"kind":"Field","name":{"kind":"Name","value":"lineItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lineNumber"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"chargeCode"}},{"kind":"Field","name":{"kind":"Name","value":"amountCents"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shipment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"reference"}},{"kind":"Field","name":{"kind":"Name","value":"origin"}},{"kind":"Field","name":{"kind":"Name","value":"destination"}},{"kind":"Field","name":{"kind":"Name","value":"shippedOn"}}]}},{"kind":"Field","name":{"kind":"Name","value":"rateCardVersion"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveFrom"}}]}},{"kind":"Field","name":{"kind":"Name","value":"discrepancies"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCents"}},{"kind":"Field","name":{"kind":"Name","value":"billedCents"}},{"kind":"Field","name":{"kind":"Name","value":"evidence"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"lineItem"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]}}]} as unknown as DocumentNode<InvoiceQuery, InvoiceQueryVariables>;
export const InvoicesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Invoices"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"InvoiceStatus"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invoices"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"carrier"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"issuedOn"}},{"kind":"Field","name":{"kind":"Name","value":"totalCents"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]} as unknown as DocumentNode<InvoicesQuery, InvoicesQueryVariables>;
export const ResolveDiscrepancyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolveDiscrepancy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"decision"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DiscrepancyDecision"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"note"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolveDiscrepancy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"decision"},"value":{"kind":"Variable","name":{"kind":"Name","value":"decision"}}},{"kind":"Argument","name":{"kind":"Name","value":"note"},"value":{"kind":"Variable","name":{"kind":"Name","value":"note"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<ResolveDiscrepancyMutation, ResolveDiscrepancyMutationVariables>;