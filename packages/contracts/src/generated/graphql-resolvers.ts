import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
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

/** A carrier invoice uploaded for audit. */
export type Invoice = Node & {
  __typename?: 'Invoice';
  carrier?: Maybe<Scalars['String']['output']>;
  /** SHA-256 of the PDF bytes, hex encoded. */
  contentHash: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  /** ISO 4217 currency code. */
  currency?: Maybe<Scalars['String']['output']>;
  /** Discrepancies found on this invoice, newest first. */
  discrepancies: DiscrepancyConnection;
  /** Original upload file name. */
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  issuedOn?: Maybe<Scalars['Date']['output']>;
  /** Charge lines in invoice order. */
  lineItems: Array<LineItem>;
  /** Invoice number printed by the carrier. */
  number?: Maybe<Scalars['String']['output']>;
  /** Rate card version used for reconciliation. */
  rateCardVersion?: Maybe<RateCardVersion>;
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
  | 'APPROVED'
  | 'EXTRACTING'
  | 'FAILED'
  | 'NEEDS_REVIEW'
  | 'RECEIVED'
  | 'RECONCILING';

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
  /** Records a reviewer decision on a discrepancy. */
  resolveDiscrepancy: Discrepancy;
};


/** Reviewer actions. */
export type MutationApproveInvoiceArgs = {
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
  effectiveFrom: Scalars['Date']['output'];
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
    | ( Discrepancy )
    | ( Invoice )
  ;
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Cents: ResolverTypeWrapper<Scalars['Cents']['output']>;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Discrepancy: ResolverTypeWrapper<Discrepancy>;
  DiscrepancyConnection: ResolverTypeWrapper<DiscrepancyConnection>;
  DiscrepancyDecision: DiscrepancyDecision;
  DiscrepancyEdge: ResolverTypeWrapper<DiscrepancyEdge>;
  DiscrepancyStatus: DiscrepancyStatus;
  DiscrepancyType: DiscrepancyType;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Invoice: ResolverTypeWrapper<Invoice>;
  InvoiceConnection: ResolverTypeWrapper<InvoiceConnection>;
  InvoiceEdge: ResolverTypeWrapper<InvoiceEdge>;
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
  Boolean: Scalars['Boolean']['output'];
  Cents: Scalars['Cents']['output'];
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  Discrepancy: Discrepancy;
  DiscrepancyConnection: DiscrepancyConnection;
  DiscrepancyEdge: DiscrepancyEdge;
  Float: Scalars['Float']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Invoice: Invoice;
  InvoiceConnection: InvoiceConnection;
  InvoiceEdge: InvoiceEdge;
  LineItem: LineItem;
  Mutation: Record<PropertyKey, never>;
  Node: ResolversInterfaceTypes<ResolversParentTypes>['Node'];
  PageInfo: PageInfo;
  Query: Record<PropertyKey, never>;
  RateCardVersion: RateCardVersion;
  Shipment: Shipment;
  String: Scalars['String']['output'];
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

export type InvoiceResolvers<ContextType = any, ParentType extends ResolversParentTypes['Invoice'] = ResolversParentTypes['Invoice']> = {
  carrier?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  contentHash?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  currency?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  discrepancies?: Resolver<ResolversTypes['DiscrepancyConnection'], ParentType, ContextType, RequireFields<InvoiceDiscrepanciesArgs, 'first'>>;
  filename?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  issuedOn?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  lineItems?: Resolver<Array<ResolversTypes['LineItem']>, ParentType, ContextType>;
  number?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  rateCardVersion?: Resolver<Maybe<ResolversTypes['RateCardVersion']>, ParentType, ContextType>;
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
  resolveDiscrepancy?: Resolver<ResolversTypes['Discrepancy'], ParentType, ContextType, RequireFields<MutationResolveDiscrepancyArgs, 'decision' | 'id'>>;
};

export type NodeResolvers<ContextType = any, ParentType extends ResolversParentTypes['Node'] = ResolversParentTypes['Node']> = {
  __resolveType: TypeResolveFn<'Discrepancy' | 'Invoice', ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = any, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  discrepancies?: Resolver<ResolversTypes['DiscrepancyConnection'], ParentType, ContextType, RequireFields<QueryDiscrepanciesArgs, 'first'>>;
  health?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  invoice?: Resolver<Maybe<ResolversTypes['Invoice']>, ParentType, ContextType, RequireFields<QueryInvoiceArgs, 'id'>>;
  invoices?: Resolver<ResolversTypes['InvoiceConnection'], ParentType, ContextType, RequireFields<QueryInvoicesArgs, 'first'>>;
};

export type RateCardVersionResolvers<ContextType = any, ParentType extends ResolversParentTypes['RateCardVersion'] = ResolversParentTypes['RateCardVersion']> = {
  carrier?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  effectiveFrom?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
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
  Cents?: GraphQLScalarType;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  Discrepancy?: DiscrepancyResolvers<ContextType>;
  DiscrepancyConnection?: DiscrepancyConnectionResolvers<ContextType>;
  DiscrepancyEdge?: DiscrepancyEdgeResolvers<ContextType>;
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

