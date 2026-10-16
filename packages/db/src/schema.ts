import { sql } from 'drizzle-orm';
import { bigint, customType, date, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Query-side mirror of the state after the last migration. migrations/*.sql own every constraint and index;
// migrations.int.test.ts checks that tables, columns, types and nullability match.

const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const tenantId = () => uuid('tenant_id').notNull();
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// Lifecycle order; the database sorts needs_review before reconciled (see 0005), so never order by status.
export const invoiceStatus = pgEnum('invoice_status', [
  'received',
  'extracting',
  'extracted',
  'reconciling',
  'reconciled',
  'needs_review',
  'approved',
  'failed',
]);
export const discrepancyType = pgEnum('discrepancy_type', [
  'rate_mismatch',
  'uncontracted_charge',
  'duplicate_charge',
  'weight_mismatch',
  'arithmetic_error',
]);
export const discrepancyStatus = pgEnum('discrepancy_status', ['open', 'confirmed', 'dismissed']);

export const tenants = pgTable('tenants', { id: id(), name: text('name').notNull(), ...timestamps });

export const carriers = pgTable('carriers', { id: id(), tenantId: tenantId(), name: text('name').notNull(), ...timestamps });

export const rateCardVersions = pgTable('rate_card_versions', {
  id: id(),
  tenantId: tenantId(),
  carrierId: uuid('carrier_id').notNull(),
  version: integer('version').notNull(),
  effective: tstzrange('effective').notNull(),
  // Linehaul terms (0007): the minimum linehaul and the fuel surcharge in basis points of it; null on older versions.
  minimumCents: cents('minimum_cents'),
  fuelBp: integer('fuel_bp'),
  ...timestamps,
});

// Graduated per-mile linehaul bands of a version (0007): each mile from fromMile on pays centsPerMile.
export const rateCardBands = pgTable('rate_card_bands', {
  tenantId: tenantId(),
  rateCardVersionId: uuid('rate_card_version_id').notNull(),
  fromMile: integer('from_mile').notNull(),
  centsPerMile: cents('cents_per_mile').notNull(),
  ...timestamps,
});

// A version's flat accessorial rates; the bands, minimum and fuel surcharge price the linehaul and fuel.
export const rateCards = pgTable('rate_cards', {
  id: id(),
  tenantId: tenantId(),
  rateCardVersionId: uuid('rate_card_version_id').notNull(),
  chargeCode: text('charge_code').notNull(),
  rateCents: cents('rate_cents').notNull(),
  ...timestamps,
});

export const shipments = pgTable('shipments', {
  id: id(),
  tenantId: tenantId(),
  carrierId: uuid('carrier_id').notNull(),
  proNumber: text('pro_number').notNull(),
  reference: text('reference').notNull(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  shippedOn: date('shipped_on').notNull(),
  weightLb: integer('weight_lb'),
  // Trip distance (0007), which prices the linehaul; null until the TMS sends it.
  miles: integer('miles'),
  ...timestamps,
});

export const invoices = pgTable('invoices', {
  id: id(),
  tenantId: tenantId(),
  status: invoiceStatus('status').notNull().default('received'),
  filename: text('filename').notNull(),
  contentSha256: text('content_sha256').notNull(),
  carrierId: uuid('carrier_id'),
  shipmentId: uuid('shipment_id'),
  invoiceNumber: text('invoice_number'),
  proNumber: text('pro_number'),
  invoiceDate: date('invoice_date'),
  currency: text('currency'),
  totalCents: cents('total_cents'),
  // Set on invoices split out of a multi-invoice upload.
  parentInvoiceId: uuid('parent_invoice_id'),
  ...timestamps,
});

// One validated model extraction per invoice; a split upload's row records the outcome of each part instead.
export const extractions = pgTable('extractions', {
  id: id(),
  tenantId: tenantId(),
  invoiceId: uuid('invoice_id').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  result: jsonb('result').notNull(),
  // first_pass, repair, fallback or needs_review; rows before 0009 have none.
  step: text('step'),
  // rate_limited or invalid_output when the fallback model ran.
  fallbackReason: text('fallback_reason'),
  // Why reconciliation sent the invoice to needs_review, such as unsupported_currency: CAD; rows before 0010 have none.
  reviewReason: text('review_reason'),
  // How the carrier read from the document matched a known carrier: exact, normalized or contained; null when none
  // matched, and on rows before 0011.
  carrierMatch: text('carrier_match'),
  ...timestamps,
});

export const llmCalls = pgTable('llm_calls', {
  id: id(),
  tenantId: tenantId(),
  invoiceId: uuid('invoice_id').notNull(),
  role: text('role').notNull(),
  step: text('step').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  servedModel: text('served_model'),
  outcome: text('outcome').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  // Time spent waiting on the role's rate limit before the call was sent, outside latency_ms; rows before 0011 have none.
  waitMs: integer('wait_ms'),
  // Integer micro-dollars (1,000,000 is $1).
  costMicroUsd: bigint('cost_micro_usd', { mode: 'bigint' }).notNull(),
  ...timestamps,
});

export const invoiceLines = pgTable('invoice_lines', {
  id: id(),
  tenantId: tenantId(),
  invoiceId: uuid('invoice_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  description: text('description').notNull(),
  chargeCode: text('charge_code'),
  amountCents: cents('amount_cents').notNull(),
  rateCardVersionId: uuid('rate_card_version_id').notNull(),
  ...timestamps,
});

export const discrepancies = pgTable('discrepancies', {
  id: id(),
  tenantId: tenantId(),
  invoiceId: uuid('invoice_id').notNull(),
  invoiceLineId: uuid('invoice_line_id'),
  shipmentId: uuid('shipment_id'),
  type: discrepancyType('type').notNull(),
  status: discrepancyStatus('status').notNull().default('open'),
  expectedCents: cents('expected_cents').notNull(),
  billedCents: cents('billed_cents').notNull(),
  evidence: text('evidence').notNull(),
  note: text('note'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  tenantId: tenantId(),
  key: text('key').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  ...timestamps,
});

export const deadLetters = pgTable('dead_letters', {
  id: id(),
  tenantId: tenantId(),
  queue: text('queue').notNull(),
  jobId: text('job_id').notNull(),
  payload: jsonb('payload').notNull(),
  error: text('error').notNull(),
  attempts: integer('attempts').notNull(),
  replayedAt: timestamp('replayed_at', { withTimezone: true }),
  ...timestamps,
});

export const tmsSyncState = pgTable('tms_sync_state', {
  tenantId: uuid('tenant_id').primaryKey(),
  cursor: text('cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  ...timestamps,
});
