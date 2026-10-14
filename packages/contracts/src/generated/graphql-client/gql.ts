/* eslint-disable */
import * as types from './graphql.js';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}": typeof types.ApproveInvoiceDocument,
    "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        invoice {\n          id\n          number\n          carrier\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": typeof types.DiscrepanciesDocument,
    "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    filename\n    carrier\n    number\n    issuedOn\n    currency\n    totalCents\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    shipment {\n      id\n      reference\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          lineItem {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n}": typeof types.InvoiceDocument,
    "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        totalCents\n        createdAt\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": typeof types.InvoicesDocument,
    "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}": typeof types.ResolveDiscrepancyDocument,
};
const documents: Documents = {
    "mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}": types.ApproveInvoiceDocument,
    "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        invoice {\n          id\n          number\n          carrier\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": types.DiscrepanciesDocument,
    "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    filename\n    carrier\n    number\n    issuedOn\n    currency\n    totalCents\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    shipment {\n      id\n      reference\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          lineItem {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n}": types.InvoiceDocument,
    "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        totalCents\n        createdAt\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": types.InvoicesDocument,
    "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}": types.ResolveDiscrepancyDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}"): (typeof documents)["mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        invoice {\n          id\n          number\n          carrier\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"): (typeof documents)["query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        invoice {\n          id\n          number\n          carrier\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    filename\n    carrier\n    number\n    issuedOn\n    currency\n    totalCents\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    shipment {\n      id\n      reference\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          lineItem {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n}"): (typeof documents)["query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    filename\n    carrier\n    number\n    issuedOn\n    currency\n    totalCents\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    shipment {\n      id\n      reference\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          lineItem {\n            id\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        totalCents\n        createdAt\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"): (typeof documents)["query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        totalCents\n        createdAt\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}"): (typeof documents)["mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;