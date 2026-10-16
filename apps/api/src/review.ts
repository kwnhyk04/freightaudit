import { auditEvents, carriers, discrepancies, extractions, invoices } from '@freightaudit/db';
import { type Queues, replayDeadLetter, send } from '@freightaudit/pipeline';
import { and, count, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { GraphQLError } from 'graphql';
import { UUID } from './keyset.ts';

export type ReviewDeps = { db: NodePgDatabase; queues: Queues; tenantId: string };
type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];
type Change = { field: string; from: string | null; to: string | null };

// Expected refusals carry a code and a message for the reviewer; GraphQL masking lets them through.
export const refuse = (code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_USER_INPUT' | 'UNAVAILABLE', message: string) =>
  new GraphQLError(message, { extensions: { code } });

const MAX_TEXT = 1000;
function text(value: string | null | undefined, name: string) {
  const trimmed = value?.trim() || null;
  if (trimmed && trimmed.length > MAX_TEXT) throw refuse('BAD_USER_INPUT', `${name} is longer than ${MAX_TEXT} characters`);
  return trimmed;
}

// A reviewer action in one transaction under app.actor: the status trigger then leaves the audit row to the action,
// which records its reason and field changes itself.
function asReviewer<T>({ db }: ReviewDeps, actor: string, work: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.actor', ${actor}, true)`);
    return work(tx);
  });
}

async function lockInvoice(tx: Tx, tenantId: string, id: string) {
  if (!UUID.test(id)) throw refuse('NOT_FOUND', `invoice ${id} not found`);
  const [invoice] = await tx
    .select({ status: invoices.status, carrierId: invoices.carrierId, proNumber: invoices.proNumber, contentSha256: invoices.contentSha256 })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
    .for('update');
  if (!invoice) throw refuse('NOT_FOUND', `invoice ${id} not found`);
  return invoice;
}

export async function approveInvoice(deps: ReviewDeps, actor: string, id: string) {
  await asReviewer(deps, actor, async (tx) => {
    const invoice = await lockInvoice(tx, deps.tenantId, id);
    if (invoice.status !== 'reconciled' && invoice.status !== 'needs_review') {
      throw refuse('CONFLICT', `only a reconciled invoice or one that needs review can be approved; this one is ${invoice.status}`);
    }
    const [row] = await tx
      .select({ open: count() })
      .from(discrepancies)
      .where(and(eq(discrepancies.invoiceId, id), eq(discrepancies.status, 'open')));
    const open = row?.open ?? 0;
    if (open > 0) throw refuse('CONFLICT', `decide the ${open} open discrepanc${open === 1 ? 'y' : 'ies'} first`);
    await tx.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, id));
    const changes: Change[] = [{ field: 'status', from: invoice.status, to: 'approved' }];
    await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: id, actor, action: 'approved', changes });
  });
}

// Confirm disputes the overcharge; dismiss lets the billed amount stand. A decision may change until approval.
export async function resolveDiscrepancy(deps: ReviewDeps, actor: string, id: string, decision: 'confirmed' | 'dismissed', note?: string | null) {
  const reason = text(note, 'note');
  await asReviewer(deps, actor, async (tx) => {
    if (!UUID.test(id)) throw refuse('NOT_FOUND', `discrepancy ${id} not found`);
    const [row] = await tx
      .select({ status: discrepancies.status, invoiceId: discrepancies.invoiceId, invoiceStatus: invoices.status })
      .from(discrepancies)
      .innerJoin(invoices, eq(invoices.id, discrepancies.invoiceId))
      .where(and(eq(discrepancies.tenantId, deps.tenantId), eq(discrepancies.id, id)))
      .for('update');
    if (!row) throw refuse('NOT_FOUND', `discrepancy ${id} not found`);
    if (row.invoiceStatus !== 'reconciled') {
      throw refuse('CONFLICT', `the invoice is ${row.invoiceStatus}; decisions change only while it is reconciled`);
    }
    await tx.update(discrepancies).set({ status: decision, note: reason, resolvedAt: sql`now()` }).where(eq(discrepancies.id, id));
    const action = decision === 'confirmed' ? 'discrepancy_confirmed' : 'discrepancy_dismissed';
    const changes: Change[] = [{ field: 'status', from: row.status, to: decision }];
    await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: row.invoiceId, discrepancyId: id, actor, action, changes, reason });
  });
}

// The way out of needs_review when the reading matched no shipment: the reviewer corrects the carrier, the PRO number or
// both, and matching runs again (reconcile reads invoices.carrier_id and pro_number; the extraction keeps the reading).
// On an invoice already extracted, nothing changes but matching is queued again.
export async function correctInvoice(deps: ReviewDeps, actor: string, id: string, carrierId?: string | null, proNumber?: string | null) {
  const pro = text(proNumber, 'PRO number');
  if (!carrierId && !pro) throw refuse('BAD_USER_INPUT', 'give the carrier, the PRO number or both');
  if (pro && pro.length > 64) throw refuse('BAD_USER_INPUT', 'PRO number is longer than 64 characters');
  if (carrierId && !UUID.test(carrierId)) throw refuse('BAD_USER_INPUT', 'carrier is not one of yours');
  const contentSha256 = await asReviewer(deps, actor, async (tx) => {
    const invoice = await lockInvoice(tx, deps.tenantId, id);
    const [extraction] = await tx
      .select({ reviewReason: extractions.reviewReason, result: extractions.result })
      .from(extractions)
      .where(eq(extractions.invoiceId, id));
    if (extraction && typeof extraction.result === 'object' && extraction.result !== null && 'parts' in extraction.result) {
      throw refuse('CONFLICT', 'this upload holds several invoices; correct each part instead');
    }
    if (invoice.status === 'needs_review' && extraction?.reviewReason !== 'no_shipment_match') {
      const reason = extraction?.reviewReason ?? 'the extraction failed validation';
      throw refuse('CONFLICT', `correcting the carrier or PRO number cannot help here (${reason}); approve or reject the invoice`);
    }
    if (invoice.status !== 'needs_review' && invoice.status !== 'extracted') {
      throw refuse('CONFLICT', `only an invoice that needs review can be corrected; this one is ${invoice.status}`);
    }
    const changes: Change[] = [];
    const nameOf = async (carrier: string) =>
      (await tx.select({ name: carriers.name }).from(carriers).where(and(eq(carriers.tenantId, deps.tenantId), eq(carriers.id, carrier))))[0]?.name;
    if (carrierId && carrierId !== invoice.carrierId) {
      const next = await nameOf(carrierId);
      if (!next) throw refuse('BAD_USER_INPUT', 'carrier is not one of yours');
      changes.push({ field: 'carrier', from: (invoice.carrierId && (await nameOf(invoice.carrierId))) || null, to: next });
    }
    if (pro && pro !== invoice.proNumber) changes.push({ field: 'proNumber', from: invoice.proNumber, to: pro });
    if (invoice.status === 'needs_review') changes.push({ field: 'status', from: 'needs_review', to: 'extracted' });
    await tx
      .update(invoices)
      .set({ carrierId: carrierId ?? invoice.carrierId, proNumber: pro ?? invoice.proNumber, status: 'extracted' })
      .where(eq(invoices.id, id));
    if (changes.length > 0) await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: id, actor, action: 'corrected', changes });
    return invoice.contentSha256;
  });
  // After the commit, since reconcile skips an invoice that still needs review. The finished job holds the content hash
  // as its id, and adding a job with a taken id is a no-op, so it goes first, as replayDeadLetter does.
  try {
    await deps.queues.queue('reconcile').remove(contentSha256);
    await send('reconcile', contentSha256, (trace) =>
      deps.queues.queue('reconcile').add('reconcile', { tenantId: deps.tenantId, invoiceId: id, ...trace }, { jobId: contentSha256 }),
    );
  } catch {
    throw refuse('UNAVAILABLE', 'the correction is saved, but matching could not be queued; correct the invoice again to retry');
  }
}

export async function rejectInvoice(deps: ReviewDeps, actor: string, id: string, reasonText: string) {
  const reason = text(reasonText, 'reason');
  if (!reason) throw refuse('BAD_USER_INPUT', 'give a reason for the rejection');
  await asReviewer(deps, actor, async (tx) => {
    const invoice = await lockInvoice(tx, deps.tenantId, id);
    if (invoice.status !== 'needs_review') throw refuse('CONFLICT', `only an invoice that needs review can be rejected; this one is ${invoice.status}`);
    await tx.update(invoices).set({ status: 'rejected' }).where(eq(invoices.id, id));
    const changes: Change[] = [{ field: 'status', from: 'needs_review', to: 'rejected' }];
    await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: id, actor, action: 'rejected', changes, reason });
  });
}

export async function replay(deps: ReviewDeps, actor: string, id: string) {
  const replayed = await replayDeadLetter(deps, deps.tenantId, id, actor);
  if (!replayed) throw refuse('NOT_FOUND', `no open dead letter ${id}`);
  return replayed;
}
