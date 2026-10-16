import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** Integer amount in cents, serialized as a JSON number within the safe integer range. */
  Cents: { input: bigint; output: bigint; }
  /** Calendar date in ISO 8601 format (YYYY-MM-DD). */
  Date: { input: string; output: string; }
  /** Timestamp in ISO 8601 format with a UTC offset. */
  DateTime: { input: string; output: string; }
};

/** Kind of entry in an invoice's audit trail. */
export type AuditAction =
  /** A reviewer approved the invoice for payment. */
  | 'APPROVED'
  /** A reviewer corrected the carrier or PRO number and matching ran again. */
  | 'CORRECTED'
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

/** One entry in an invoice's audit trail. */
export type AuditEntry = {
  __typename?: 'AuditEntry';
  action: AuditAction;
  /** Who acted: a reviewer's name, api-key:<id> for a direct API call, or null for the pipeline. */
  actor?: Maybe<Scalars['String']['output']>;
  at: Scalars['DateTime']['output'];
  /** Fields the entry changed, with their old and new values. */
  changes: Array<FieldChange>;
  /** Text that goes with the entry: a reason, a note, a failure message, a review reason or how the carrier matched. */
  detail?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
};

/** A carrier this tenant works with. */
export type Carrier = Node & {
  __typename?: 'Carrier';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

/** How a carrier name read from a document matched a known carrier. */
export type CarrierMatch =
  /** The reading holds the known name as whole words, as beside a title line. */
  | 'CONTAINED'
  /** Printed exactly as the known name. */
  | 'EXACT'
  /** Equal after normalizing case, spacing and Unicode forms. */
  | 'NORMALIZED';

/** A job that used up its retries or met data it cannot process. */
export type DeadLetter = Node & {
  __typename?: 'DeadLetter';
  attempts: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  /** Error of the job's last attempt. */
  error: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** Invoice the job worked on; null for TMS sync jobs. */
  invoice?: Maybe<Invoice>;
  jobId: Scalars['String']['output'];
  /** Queue the job ran on: extract, reconcile or tms-sync. */
  queue: Scalars['String']['output'];
  replayedAt?: Maybe<Scalars['DateTime']['output']>;
};

/** A page of dead letters. */
export type DeadLetterConnection = {
  __typename?: 'DeadLetterConnection';
  edges: Array<DeadLetterEdge>;
  pageInfo: PageInfo;
};

/** A dead letter in a connection. */
export type DeadLetterEdge = {
  __typename?: 'DeadLetterEdge';
  cursor: Scalars['String']['output'];
  node: DeadLetter;
};

/** Review state of a dead letter. */
export type DeadLetterStatus =
  /** Waiting for a replay. */
  | 'OPEN'
  /** Its job was run again. */
  | 'REPLAYED';

/** A billed charge that does not match the contract. */
export type Discrepancy = Node & {
  __typename?: 'Discrepancy';
  /** Amount the carrier billed. */
  billedCents: Scalars['Cents']['output'];
  /** How the expected amount was derived. */
  evidence: Scalars['String']['output'];
  /** Amount the contract allows. */
  expectedCents: Scalars['Cents']['output'];
  id: Scalars['ID']['output'];
  invoice: Invoice;
  /** Billed line the discrepancy is about, if any. */
  lineItem?: Maybe<LineItem>;
  /** Reviewer note from the last decision. */
  note?: Maybe<Scalars['String']['output']>;
  /** Rate card version used as evidence. */
  rateCardVersion?: Maybe<RateCardVersion>;
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Shipment used as evidence. */
  shipment?: Maybe<Shipment>;
  status: DiscrepancyStatus;
  type: DiscrepancyType;
};

/** A page of discrepancies. */
export type DiscrepancyConnection = {
  __typename?: 'DiscrepancyConnection';
  edges: Array<DiscrepancyEdge>;
  pageInfo: PageInfo;
};

/** Reviewer decision on a discrepancy. */
export type DiscrepancyDecision =
  /** The overcharge is real. */
  | 'CONFIRM'
  /** False flag; the billed amount stands. */
  | 'DISMISS';

/** A discrepancy in a connection. */
export type DiscrepancyEdge = {
  __typename?: 'DiscrepancyEdge';
  cursor: Scalars['String']['output'];
  node: Discrepancy;
};

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

/** A charge line as the model read it. */
export type ExtractedLine = {
  __typename?: 'ExtractedLine';
  amountCents: Scalars['Cents']['output'];
  /** Normalized charge code, for example LINEHAUL or FUEL. */
  chargeCode?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  /** Position on the invoice, starting at 1. */
  lineNumber: Scalars['Int']['output'];
};

/** What the model read from an invoice document. */
export type Extraction = {
  __typename?: 'Extraction';
  /** How the reading matched a known carrier; null when it matched none. */
  carrierMatch?: Maybe<CarrierMatch>;
  /** Carrier name as the model read it. */
  carrierRead?: Maybe<Scalars['String']['output']>;
  extractedAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /** Charge lines as read, in document order; empty when the output failed validation. */
  lines: Array<ExtractedLine>;
  /** Model whose answer was kept. */
  model: Scalars['String']['output'];
  /** Why the output failed validation, by field path; empty when it passed. */
  problems: Array<Scalars['String']['output']>;
  /** Step that produced the answer: first_pass, repair or fallback; needs_review when no answer passed validation. */
  step?: Maybe<Scalars['String']['output']>;
};

/** A field's value before and after an audit entry. */
export type FieldChange = {
  __typename?: 'FieldChange';
  field: Scalars['String']['output'];
  from?: Maybe<Scalars['String']['output']>;
  to?: Maybe<Scalars['String']['output']>;
};

/** A carrier invoice uploaded for audit. */
export type Invoice = Node & {
  __typename?: 'Invoice';
  /** Everything that happened to the invoice, oldest first: pipeline moves and reviewer actions. */
  auditTrail: Array<AuditEntry>;
  carrier?: Maybe<Scalars['String']['output']>;
  /** SHA-256 of the PDF bytes, hex encoded. */
  contentHash: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  /** ISO 4217 currency code. */
  currency?: Maybe<Scalars['String']['output']>;
  /** The open dead letter of a FAILED invoice, to replay; null otherwise. */
  deadLetter?: Maybe<DeadLetter>;
  /** Discrepancies found on this invoice, newest first. */
  discrepancies: DiscrepancyConnection;
  /** What the model read, before any correction; null until extraction ends. */
  extraction?: Maybe<Extraction>;
  /** Why the invoice failed, such as a shipment without miles; null unless status is FAILED. */
  failureReason?: Maybe<Scalars['String']['output']>;
  /** Original upload file name. */
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  issuedOn?: Maybe<Scalars['Date']['output']>;
  /** Charge lines in invoice order. */
  lineItems: Array<LineItem>;
  /** Invoice number printed by the carrier. */
  number?: Maybe<Scalars['String']['output']>;
  /** Number of this invoice's discrepancies still waiting for a decision. */
  openDiscrepancyCount: Scalars['Int']['output'];
  /** PRO number used to match the shipment: a reviewer's correction, else what the model read. */
  proNumber?: Maybe<Scalars['String']['output']>;
  /** Rate card version used for reconciliation. */
  rateCardVersion?: Maybe<RateCardVersion>;
  /** Why the invoice needs review, such as no_shipment_match or unsupported_currency: CAD; null unless status is NEEDS_REVIEW. */
  reviewReason?: Maybe<Scalars['String']['output']>;
  /** Shipment the invoice was matched to. */
  shipment?: Maybe<Shipment>;
  status: InvoiceStatus;
  totalCents?: Maybe<Scalars['Cents']['output']>;
};


/** A carrier invoice uploaded for audit. */
export type InvoiceDiscrepanciesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<DiscrepancyStatus>;
};

/** A page of invoices. */
export type InvoiceConnection = {
  __typename?: 'InvoiceConnection';
  edges: Array<InvoiceEdge>;
  pageInfo: PageInfo;
};

/** An invoice in a connection. */
export type InvoiceEdge = {
  __typename?: 'InvoiceEdge';
  cursor: Scalars['String']['output'];
  node: Invoice;
};

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
  /** Checked against the shipment and rate card; each finding waits as an open discrepancy. Approval follows once every discrepancy has a decision. */
  | 'RECONCILED'
  /** Matching against the shipment and rate card is running. */
  | 'RECONCILING'
  /** A reviewer refused the invoice for payment. Final. */
  | 'REJECTED';

/** A charge line extracted from an invoice. */
export type LineItem = {
  __typename?: 'LineItem';
  amountCents: Scalars['Cents']['output'];
  /** Normalized charge code, for example LINEHAUL or FUEL. */
  chargeCode?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** Position on the invoice, starting at 1. */
  lineNumber: Scalars['Int']['output'];
};

/** Reviewer actions. */
export type Mutation = {
  __typename?: 'Mutation';
  /** Approves an invoice for payment. */
  approveInvoice: Invoice;
  /**
   * Corrects the carrier or PRO number that kept a NEEDS_REVIEW invoice from matching a shipment, then runs
   * matching again. Called on an EXTRACTED invoice, it only queues matching again.
   */
  correctInvoice: Invoice;
  /** Rejects a NEEDS_REVIEW invoice for payment; the reason is kept in its audit trail. Final. */
  rejectInvoice: Invoice;
  /** Runs a dead letter's job again from the step that failed. */
  replayDeadLetter: DeadLetter;
  /** Records a reviewer decision on a discrepancy. */
  resolveDiscrepancy: Discrepancy;
};


/** Reviewer actions. */
export type MutationApproveInvoiceArgs = {
  id: Scalars['ID']['input'];
};


/** Reviewer actions. */
export type MutationCorrectInvoiceArgs = {
  carrierId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  proNumber?: InputMaybe<Scalars['String']['input']>;
};


/** Reviewer actions. */
export type MutationRejectInvoiceArgs = {
  id: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


/** Reviewer actions. */
export type MutationReplayDeadLetterArgs = {
  id: Scalars['ID']['input'];
};


/** Reviewer actions. */
export type MutationResolveDiscrepancyArgs = {
  decision: DiscrepancyDecision;
  id: Scalars['ID']['input'];
  note?: InputMaybe<Scalars['String']['input']>;
};

/** An object with a globally unique ID. */
export type Node = {
  /** Globally unique ID. */
  id: Scalars['ID']['output'];
};

/** Pagination state of a connection. */
export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

/** Queries for the invoice review UI. */
export type Query = {
  __typename?: 'Query';
  /** This tenant's carriers by name. A plain list: a tenant has few carriers, and a correction picks one of them. */
  carriers: Array<Carrier>;
  /** Dead letters, newest first. */
  deadLetters: DeadLetterConnection;
  /** Discrepancies across all invoices, newest first. */
  discrepancies: DiscrepancyConnection;
  /** Liveness probe; always returns ok. */
  health: Scalars['String']['output'];
  /** One invoice, or null when it does not exist. */
  invoice?: Maybe<Invoice>;
  /** Invoices, newest first. */
  invoices: InvoiceConnection;
};


/** Queries for the invoice review UI. */
export type QueryDeadLettersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<DeadLetterStatus>;
};


/** Queries for the invoice review UI. */
export type QueryDiscrepanciesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<DiscrepancyStatus>;
};


/** Queries for the invoice review UI. */
export type QueryInvoiceArgs = {
  id: Scalars['ID']['input'];
};


/** Queries for the invoice review UI. */
export type QueryInvoicesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<InvoiceStatus>;
};

/** One version of a contracted carrier rate card. */
export type RateCardVersion = {
  __typename?: 'RateCardVersion';
  carrier: Scalars['String']['output'];
  /** Null for a version open at the start, as a backfilled first version is. */
  effectiveFrom?: Maybe<Scalars['Date']['output']>;
  /** Null while this version is current. */
  effectiveTo?: Maybe<Scalars['Date']['output']>;
  id: Scalars['ID']['output'];
  /** Increases with each new version for the carrier. */
  version: Scalars['Int']['output'];
};

/** A shipment record synced from the TMS. */
export type Shipment = {
  __typename?: 'Shipment';
  carrier: Scalars['String']['output'];
  destination: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  origin: Scalars['String']['output'];
  /** Shipment reference in the TMS. */
  reference: Scalars['String']['output'];
  shippedOn: Scalars['Date']['output'];
  weightLb?: Maybe<Scalars['Float']['output']>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;




/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = {
  Node:
    | ( Carrier )
    | ( Partial<DeadLetter> )
    | ( Partial<Discrepancy> )
    | ( Partial<Invoice> )
  ;
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AuditAction: AuditAction;
  AuditEntry: ResolverTypeWrapper<AuditEntry>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Carrier: ResolverTypeWrapper<Carrier>;
  CarrierMatch: CarrierMatch;
  Cents: ResolverTypeWrapper<Scalars['Cents']['output']>;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DeadLetter: ResolverTypeWrapper<Partial<DeadLetter>>;
  DeadLetterConnection: ResolverTypeWrapper<Omit<DeadLetterConnection, 'edges'> & { edges: Array<ResolversTypes['DeadLetterEdge']> }>;
  DeadLetterEdge: ResolverTypeWrapper<Omit<DeadLetterEdge, 'node'> & { node: ResolversTypes['DeadLetter'] }>;
  DeadLetterStatus: DeadLetterStatus;
  Discrepancy: ResolverTypeWrapper<Partial<Discrepancy>>;
  DiscrepancyConnection: ResolverTypeWrapper<Omit<DiscrepancyConnection, 'edges'> & { edges: Array<ResolversTypes['DiscrepancyEdge']> }>;
  DiscrepancyDecision: DiscrepancyDecision;
  DiscrepancyEdge: ResolverTypeWrapper<Omit<DiscrepancyEdge, 'node'> & { node: ResolversTypes['Discrepancy'] }>;
  DiscrepancyStatus: DiscrepancyStatus;
  DiscrepancyType: DiscrepancyType;
  ExtractedLine: ResolverTypeWrapper<ExtractedLine>;
  Extraction: ResolverTypeWrapper<Extraction>;
  FieldChange: ResolverTypeWrapper<FieldChange>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Invoice: ResolverTypeWrapper<Partial<Invoice>>;
  InvoiceConnection: ResolverTypeWrapper<Omit<InvoiceConnection, 'edges'> & { edges: Array<ResolversTypes['InvoiceEdge']> }>;
  InvoiceEdge: ResolverTypeWrapper<Omit<InvoiceEdge, 'node'> & { node: ResolversTypes['Invoice'] }>;
  InvoiceStatus: InvoiceStatus;
  LineItem: ResolverTypeWrapper<LineItem>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Node: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['Node']>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RateCardVersion: ResolverTypeWrapper<RateCardVersion>;
  Shipment: ResolverTypeWrapper<Shipment>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AuditEntry: AuditEntry;
  Boolean: Scalars['Boolean']['output'];
  Carrier: Carrier;
  Cents: Scalars['Cents']['output'];
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  DeadLetter: Partial<DeadLetter>;
  DeadLetterConnection: Omit<DeadLetterConnection, 'edges'> & { edges: Array<ResolversParentTypes['DeadLetterEdge']> };
  DeadLetterEdge: Omit<DeadLetterEdge, 'node'> & { node: ResolversParentTypes['DeadLetter'] };
  Discrepancy: Partial<Discrepancy>;
  DiscrepancyConnection: Omit<DiscrepancyConnection, 'edges'> & { edges: Array<ResolversParentTypes['DiscrepancyEdge']> };
  DiscrepancyEdge: Omit<DiscrepancyEdge, 'node'> & { node: ResolversParentTypes['Discrepancy'] };
  ExtractedLine: ExtractedLine;
  Extraction: Extraction;
  FieldChange: FieldChange;
  Float: Scalars['Float']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Invoice: Partial<Invoice>;
  InvoiceConnection: Omit<InvoiceConnection, 'edges'> & { edges: Array<ResolversParentTypes['InvoiceEdge']> };
  InvoiceEdge: Omit<InvoiceEdge, 'node'> & { node: ResolversParentTypes['Invoice'] };
  LineItem: LineItem;
  Mutation: Record<PropertyKey, never>;
  Node: ResolversInterfaceTypes<ResolversParentTypes>['Node'];
  PageInfo: PageInfo;
  Query: Record<PropertyKey, never>;
  RateCardVersion: RateCardVersion;
  Shipment: Shipment;
  String: Scalars['String']['output'];
};

export type AuditEntryResolvers<ContextType = any, ParentType extends ResolversParentTypes['AuditEntry'] = ResolversParentTypes['AuditEntry']> = {
  action?: Resolver<ResolversTypes['AuditAction'], ParentType, ContextType>;
  actor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  at?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  changes?: Resolver<Array<ResolversTypes['FieldChange']>, ParentType, ContextType>;
  detail?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type CarrierResolvers<ContextType = any, ParentType extends ResolversParentTypes['Carrier'] = ResolversParentTypes['Carrier']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export interface CentsScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Cents'], any> {
  name: 'Cents';
}

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DeadLetterResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeadLetter'] = ResolversParentTypes['DeadLetter']> = {
  attempts?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  error?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  invoice?: Resolver<Maybe<ResolversTypes['Invoice']>, ParentType, ContextType>;
  jobId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  queue?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  replayedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DeadLetterConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeadLetterConnection'] = ResolversParentTypes['DeadLetterConnection']> = {
  edges?: Resolver<Array<ResolversTypes['DeadLetterEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type DeadLetterEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeadLetterEdge'] = ResolversParentTypes['DeadLetterEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['DeadLetter'], ParentType, ContextType>;
};

export type DiscrepancyResolvers<ContextType = any, ParentType extends ResolversParentTypes['Discrepancy'] = ResolversParentTypes['Discrepancy']> = {
  billedCents?: Resolver<ResolversTypes['Cents'], ParentType, ContextType>;
  evidence?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expectedCents?: Resolver<ResolversTypes['Cents'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  invoice?: Resolver<ResolversTypes['Invoice'], ParentType, ContextType>;
  lineItem?: Resolver<Maybe<ResolversTypes['LineItem']>, ParentType, ContextType>;
  note?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  rateCardVersion?: Resolver<Maybe<ResolversTypes['RateCardVersion']>, ParentType, ContextType>;
  resolvedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  shipment?: Resolver<Maybe<ResolversTypes['Shipment']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['DiscrepancyStatus'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['DiscrepancyType'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DiscrepancyConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['DiscrepancyConnection'] = ResolversParentTypes['DiscrepancyConnection']> = {
  edges?: Resolver<Array<ResolversTypes['DiscrepancyEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type DiscrepancyEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['DiscrepancyEdge'] = ResolversParentTypes['DiscrepancyEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Discrepancy'], ParentType, ContextType>;
};

export type ExtractedLineResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExtractedLine'] = ResolversParentTypes['ExtractedLine']> = {
  amountCents?: Resolver<ResolversTypes['Cents'], ParentType, ContextType>;
  chargeCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lineNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ExtractionResolvers<ContextType = any, ParentType extends ResolversParentTypes['Extraction'] = ResolversParentTypes['Extraction']> = {
  carrierMatch?: Resolver<Maybe<ResolversTypes['CarrierMatch']>, ParentType, ContextType>;
  carrierRead?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  extractedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['ExtractedLine']>, ParentType, ContextType>;
  model?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  problems?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  step?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type FieldChangeResolvers<ContextType = any, ParentType extends ResolversParentTypes['FieldChange'] = ResolversParentTypes['FieldChange']> = {
  field?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  from?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  to?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type InvoiceResolvers<ContextType = any, ParentType extends ResolversParentTypes['Invoice'] = ResolversParentTypes['Invoice']> = {
  auditTrail?: Resolver<Array<ResolversTypes['AuditEntry']>, ParentType, ContextType>;
  carrier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  contentHash?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  currency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  deadLetter?: Resolver<Maybe<ResolversTypes['DeadLetter']>, ParentType, ContextType>;
  discrepancies?: Resolver<ResolversTypes['DiscrepancyConnection'], ParentType, ContextType, RequireFields<InvoiceDiscrepanciesArgs, 'first'>>;
  extraction?: Resolver<Maybe<ResolversTypes['Extraction']>, ParentType, ContextType>;
  failureReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  filename?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  issuedOn?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  lineItems?: Resolver<Array<ResolversTypes['LineItem']>, ParentType, ContextType>;
  number?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  openDiscrepancyCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  proNumber?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  rateCardVersion?: Resolver<Maybe<ResolversTypes['RateCardVersion']>, ParentType, ContextType>;
  reviewReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  shipment?: Resolver<Maybe<ResolversTypes['Shipment']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InvoiceStatus'], ParentType, ContextType>;
  totalCents?: Resolver<Maybe<ResolversTypes['Cents']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type InvoiceConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['InvoiceConnection'] = ResolversParentTypes['InvoiceConnection']> = {
  edges?: Resolver<Array<ResolversTypes['InvoiceEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type InvoiceEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['InvoiceEdge'] = ResolversParentTypes['InvoiceEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Invoice'], ParentType, ContextType>;
};

export type LineItemResolvers<ContextType = any, ParentType extends ResolversParentTypes['LineItem'] = ResolversParentTypes['LineItem']> = {
  amountCents?: Resolver<ResolversTypes['Cents'], ParentType, ContextType>;
  chargeCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lineNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  approveInvoice?: Resolver<ResolversTypes['Invoice'], ParentType, ContextType, RequireFields<MutationApproveInvoiceArgs, 'id'>>;
  correctInvoice?: Resolver<ResolversTypes['Invoice'], ParentType, ContextType, RequireFields<MutationCorrectInvoiceArgs, 'id'>>;
  rejectInvoice?: Resolver<ResolversTypes['Invoice'], ParentType, ContextType, RequireFields<MutationRejectInvoiceArgs, 'id' | 'reason'>>;
  replayDeadLetter?: Resolver<ResolversTypes['DeadLetter'], ParentType, ContextType, RequireFields<MutationReplayDeadLetterArgs, 'id'>>;
  resolveDiscrepancy?: Resolver<ResolversTypes['Discrepancy'], ParentType, ContextType, RequireFields<MutationResolveDiscrepancyArgs, 'decision' | 'id'>>;
};

export type NodeResolvers<ContextType = any, ParentType extends ResolversParentTypes['Node'] = ResolversParentTypes['Node']> = {
  __resolveType: TypeResolveFn<'Carrier' | 'DeadLetter' | 'Discrepancy' | 'Invoice', ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = any, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  carriers?: Resolver<Array<ResolversTypes['Carrier']>, ParentType, ContextType>;
  deadLetters?: Resolver<ResolversTypes['DeadLetterConnection'], ParentType, ContextType, RequireFields<QueryDeadLettersArgs, 'first'>>;
  discrepancies?: Resolver<ResolversTypes['DiscrepancyConnection'], ParentType, ContextType, RequireFields<QueryDiscrepanciesArgs, 'first'>>;
  health?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  invoice?: Resolver<Maybe<ResolversTypes['Invoice']>, ParentType, ContextType, RequireFields<QueryInvoiceArgs, 'id'>>;
  invoices?: Resolver<ResolversTypes['InvoiceConnection'], ParentType, ContextType, RequireFields<QueryInvoicesArgs, 'first'>>;
};

export type RateCardVersionResolvers<ContextType = any, ParentType extends ResolversParentTypes['RateCardVersion'] = ResolversParentTypes['RateCardVersion']> = {
  carrier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  effectiveFrom?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  effectiveTo?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ShipmentResolvers<ContextType = any, ParentType extends ResolversParentTypes['Shipment'] = ResolversParentTypes['Shipment']> = {
  carrier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destination?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  origin?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reference?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  shippedOn?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  weightLb?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
};

export type Resolvers<ContextType = any> = {
  AuditEntry?: AuditEntryResolvers<ContextType>;
  Carrier?: CarrierResolvers<ContextType>;
  Cents?: GraphQLScalarType;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  DeadLetter?: DeadLetterResolvers<ContextType>;
  DeadLetterConnection?: DeadLetterConnectionResolvers<ContextType>;
  DeadLetterEdge?: DeadLetterEdgeResolvers<ContextType>;
  Discrepancy?: DiscrepancyResolvers<ContextType>;
  DiscrepancyConnection?: DiscrepancyConnectionResolvers<ContextType>;
  DiscrepancyEdge?: DiscrepancyEdgeResolvers<ContextType>;
  ExtractedLine?: ExtractedLineResolvers<ContextType>;
  Extraction?: ExtractionResolvers<ContextType>;
  FieldChange?: FieldChangeResolvers<ContextType>;
  Invoice?: InvoiceResolvers<ContextType>;
  InvoiceConnection?: InvoiceConnectionResolvers<ContextType>;
  InvoiceEdge?: InvoiceEdgeResolvers<ContextType>;
  LineItem?: LineItemResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Node?: NodeResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RateCardVersion?: RateCardVersionResolvers<ContextType>;
  Shipment?: ShipmentResolvers<ContextType>;
};

