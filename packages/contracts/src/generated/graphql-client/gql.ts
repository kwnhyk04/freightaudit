/* eslint-disable */
import * as types from './graphql.js';



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
    "mutation CorrectInvoice($id: ID!, $carrierId: ID, $proNumber: String) {\n  correctInvoice(id: $id, carrierId: $carrierId, proNumber: $proNumber) {\n    id\n    status\n  }\n}": typeof types.CorrectInvoiceDocument,
    "query DeadLetters($first: Int, $after: String, $status: DeadLetterStatus) {\n  deadLetters(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        queue\n        jobId\n        error\n        attempts\n        createdAt\n        replayedAt\n        invoice {\n          id\n          number\n          filename\n          carrier\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": typeof types.DeadLettersDocument,
    "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        evidence\n        note\n        resolvedAt\n        lineItem {\n          id\n          lineNumber\n          description\n          chargeCode\n        }\n        invoice {\n          id\n          number\n          filename\n          carrier\n          currency\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": typeof types.DiscrepanciesDocument,
    "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    failureReason\n    reviewReason\n    filename\n    contentHash\n    carrier\n    number\n    proNumber\n    issuedOn\n    currency\n    totalCents\n    createdAt\n    openDiscrepancyCount\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    extraction {\n      id\n      model\n      step\n      carrierRead\n      carrierMatch\n      problems\n      extractedAt\n      lines {\n        lineNumber\n        description\n        chargeCode\n        amountCents\n      }\n    }\n    shipment {\n      id\n      reference\n      carrier\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n      effectiveTo\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          resolvedAt\n          lineItem {\n            id\n            lineNumber\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n    auditTrail {\n      id\n      at\n      actor\n      action\n      detail\n      changes {\n        field\n        from\n        to\n      }\n    }\n    deadLetter {\n      id\n      queue\n      error\n      createdAt\n    }\n  }\n  carriers {\n    id\n    name\n  }\n}": typeof types.InvoiceDocument,
    "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        currency\n        totalCents\n        createdAt\n        openDiscrepancyCount\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": typeof types.InvoicesDocument,
    "mutation RejectInvoice($id: ID!, $reason: String!) {\n  rejectInvoice(id: $id, reason: $reason) {\n    id\n    status\n  }\n}": typeof types.RejectInvoiceDocument,
    "mutation ReplayDeadLetter($id: ID!) {\n  replayDeadLetter(id: $id) {\n    id\n    replayedAt\n  }\n}": typeof types.ReplayDeadLetterDocument,
    "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}": typeof types.ResolveDiscrepancyDocument,
};
const documents: Documents = {
    "mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}": types.ApproveInvoiceDocument,
    "mutation CorrectInvoice($id: ID!, $carrierId: ID, $proNumber: String) {\n  correctInvoice(id: $id, carrierId: $carrierId, proNumber: $proNumber) {\n    id\n    status\n  }\n}": types.CorrectInvoiceDocument,
    "query DeadLetters($first: Int, $after: String, $status: DeadLetterStatus) {\n  deadLetters(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        queue\n        jobId\n        error\n        attempts\n        createdAt\n        replayedAt\n        invoice {\n          id\n          number\n          filename\n          carrier\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": types.DeadLettersDocument,
    "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        evidence\n        note\n        resolvedAt\n        lineItem {\n          id\n          lineNumber\n          description\n          chargeCode\n        }\n        invoice {\n          id\n          number\n          filename\n          carrier\n          currency\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": types.DiscrepanciesDocument,
    "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    failureReason\n    reviewReason\n    filename\n    contentHash\n    carrier\n    number\n    proNumber\n    issuedOn\n    currency\n    totalCents\n    createdAt\n    openDiscrepancyCount\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    extraction {\n      id\n      model\n      step\n      carrierRead\n      carrierMatch\n      problems\n      extractedAt\n      lines {\n        lineNumber\n        description\n        chargeCode\n        amountCents\n      }\n    }\n    shipment {\n      id\n      reference\n      carrier\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n      effectiveTo\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          resolvedAt\n          lineItem {\n            id\n            lineNumber\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n    auditTrail {\n      id\n      at\n      actor\n      action\n      detail\n      changes {\n        field\n        from\n        to\n      }\n    }\n    deadLetter {\n      id\n      queue\n      error\n      createdAt\n    }\n  }\n  carriers {\n    id\n    name\n  }\n}": types.InvoiceDocument,
    "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        currency\n        totalCents\n        createdAt\n        openDiscrepancyCount\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}": types.InvoicesDocument,
    "mutation RejectInvoice($id: ID!, $reason: String!) {\n  rejectInvoice(id: $id, reason: $reason) {\n    id\n    status\n  }\n}": types.RejectInvoiceDocument,
    "mutation ReplayDeadLetter($id: ID!) {\n  replayDeadLetter(id: $id) {\n    id\n    replayedAt\n  }\n}": types.ReplayDeadLetterDocument,
    "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}": types.ResolveDiscrepancyDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ApproveInvoice($id: ID!) {\n  approveInvoice(id: $id) {\n    id\n    status\n  }\n}"): typeof import('./graphql.js').ApproveInvoiceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CorrectInvoice($id: ID!, $carrierId: ID, $proNumber: String) {\n  correctInvoice(id: $id, carrierId: $carrierId, proNumber: $proNumber) {\n    id\n    status\n  }\n}"): typeof import('./graphql.js').CorrectInvoiceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query DeadLetters($first: Int, $after: String, $status: DeadLetterStatus) {\n  deadLetters(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        queue\n        jobId\n        error\n        attempts\n        createdAt\n        replayedAt\n        invoice {\n          id\n          number\n          filename\n          carrier\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"): typeof import('./graphql.js').DeadLettersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Discrepancies($first: Int, $after: String, $status: DiscrepancyStatus) {\n  discrepancies(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        type\n        status\n        expectedCents\n        billedCents\n        evidence\n        note\n        resolvedAt\n        lineItem {\n          id\n          lineNumber\n          description\n          chargeCode\n        }\n        invoice {\n          id\n          number\n          filename\n          carrier\n          currency\n          status\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"): typeof import('./graphql.js').DiscrepanciesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Invoice($id: ID!) {\n  invoice(id: $id) {\n    id\n    status\n    failureReason\n    reviewReason\n    filename\n    contentHash\n    carrier\n    number\n    proNumber\n    issuedOn\n    currency\n    totalCents\n    createdAt\n    openDiscrepancyCount\n    lineItems {\n      id\n      lineNumber\n      description\n      chargeCode\n      amountCents\n    }\n    extraction {\n      id\n      model\n      step\n      carrierRead\n      carrierMatch\n      problems\n      extractedAt\n      lines {\n        lineNumber\n        description\n        chargeCode\n        amountCents\n      }\n    }\n    shipment {\n      id\n      reference\n      carrier\n      origin\n      destination\n      shippedOn\n    }\n    rateCardVersion {\n      id\n      version\n      effectiveFrom\n      effectiveTo\n    }\n    discrepancies(first: 100) {\n      edges {\n        node {\n          id\n          type\n          status\n          expectedCents\n          billedCents\n          evidence\n          note\n          resolvedAt\n          lineItem {\n            id\n            lineNumber\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n    auditTrail {\n      id\n      at\n      actor\n      action\n      detail\n      changes {\n        field\n        from\n        to\n      }\n    }\n    deadLetter {\n      id\n      queue\n      error\n      createdAt\n    }\n  }\n  carriers {\n    id\n    name\n  }\n}"): typeof import('./graphql.js').InvoiceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Invoices($first: Int, $after: String, $status: InvoiceStatus) {\n  invoices(first: $first, after: $after, status: $status) {\n    edges {\n      cursor\n      node {\n        id\n        status\n        filename\n        carrier\n        number\n        issuedOn\n        currency\n        totalCents\n        createdAt\n        openDiscrepancyCount\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}"): typeof import('./graphql.js').InvoicesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RejectInvoice($id: ID!, $reason: String!) {\n  rejectInvoice(id: $id, reason: $reason) {\n    id\n    status\n  }\n}"): typeof import('./graphql.js').RejectInvoiceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ReplayDeadLetter($id: ID!) {\n  replayDeadLetter(id: $id) {\n    id\n    replayedAt\n  }\n}"): typeof import('./graphql.js').ReplayDeadLetterDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ResolveDiscrepancy($id: ID!, $decision: DiscrepancyDecision!, $note: String) {\n  resolveDiscrepancy(id: $id, decision: $decision, note: $note) {\n    id\n    status\n    note\n    resolvedAt\n  }\n}"): typeof import('./graphql.js').ResolveDiscrepancyDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
