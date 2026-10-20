import { auditEvents, carriers, discrepancies, extractions, idempotencyKeys, invoices, possibleDuplicate } from '@freightaudit/db';
import { type Queues, replayDeadLetter, send } from '@freightaudit/pipeline';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { GraphQLError } from 'graphql';
import { cursorAt, UUID } from './keyset.ts';

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
    .select({
      status: invoices.status,
      carrierId: invoices.carrierId,
      invoiceNumber: invoices.invoiceNumber,
      proNumber: invoices.proNumber,
      shipmentId: invoices.shipmentId,
      contentSha256: invoices.contentSha256,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
    .for('update');
  if (!invoice) throw refuse('NOT_FOUND', `invoice ${id} not found`);
  return invoice;
}

// A possible duplicate a reviewer confirmed is never paid, by any decision: the invoice can only be rejected.
const CONFIRMED_DUPLICATE = 'this invoice was confirmed as a duplicate of another one; reject it instead';
const confirmedDuplicate = (finding: { type: string; status: string }) => finding.type === 'duplicate_invoice' && finding.status === 'confirmed';

// The move to approved and its audit row; the reason says which decision approved it, when there was more than one.
async function approve(tx: Tx, tenantId: string, actor: string, id: string, from: string, reason: string | null = null) {
  await tx.update(invoices).set({ status: 'approved' }).where(eq(invoices.id, id));
  const changes: Change[] = [{ field: 'status', from, to: 'approved' }];
  await tx.insert(auditEvents).values({ tenantId, invoiceId: id, actor, action: 'approved', changes, reason });
}

// Why an approval from review stopped short, kept on the move it made instead.
const HELD = 'not approved: another invoice from this carrier has the same number';

export async function approveInvoice(deps: ReviewDeps, actor: string, id: string) {
  await asReviewer(deps, actor, async (tx) => {
    const invoice = await lockInvoice(tx, deps.tenantId, id);
    if (invoice.status !== 'reconciled' && invoice.status !== 'needs_review') {
      throw refuse('CONFLICT', `only a reconciled invoice or one that needs review can be approved; this one is ${invoice.status}`);
    }
    // Reconcile writes the findings, so one that needs review has none: the reconcile's duplicate lookup runs first, by
    // the carrier and number it was read with. A hit holds it unapproved in reconciled with the possible duplicate, which
    // a reviewer decides as on any checked invoice.
    if (invoice.status === 'needs_review') {
      const duplicate = await possibleDuplicate(tx, { tenantId: deps.tenantId, invoiceId: id, carrierId: invoice.carrierId, invoiceNumber: invoice.invoiceNumber });
      if (duplicate) {
        await tx.insert(discrepancies).values({ tenantId: deps.tenantId, invoiceId: id, ...duplicate });
        await tx.update(invoices).set({ status: 'reconciled' }).where(eq(invoices.id, id));
        const changes: Change[] = [{ field: 'status', from: 'needs_review', to: 'reconciled' }];
        await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: id, actor, action: 'status', changes, reason: HELD });
        return;
      }
    }
    const findings = await tx.select({ type: discrepancies.type, status: discrepancies.status }).from(discrepancies).where(eq(discrepancies.invoiceId, id));
    const open = findings.filter((finding) => finding.status === 'open').length;
    if (open > 0) throw refuse('CONFLICT', `decide the ${open} open discrepanc${open === 1 ? 'y' : 'ies'} first`);
    if (findings.some(confirmedDuplicate)) throw refuse('CONFLICT', CONFIRMED_DUPLICATE);
    await approve(tx, deps.tenantId, actor, id, invoice.status);
  });
}

type Decision = 'confirmed' | 'dismissed';
// One finding's decision and its audit row, written alike for a single decision and a decision on the whole invoice.
// The caller holds the invoice's lock.
async function decide(tx: Tx, tenantId: string, actor: string, finding: { id: string; invoiceId: string; status: string }, decision: Decision, reason: string | null) {
  await tx.update(discrepancies).set({ status: decision, note: reason, resolvedAt: sql`now()` }).where(eq(discrepancies.id, finding.id));
  const action = decision === 'confirmed' ? 'discrepancy_confirmed' : 'discrepancy_dismissed';
  const changes: Change[] = [{ field: 'status', from: finding.status, to: decision }];
  await tx.insert(auditEvents).values({ tenantId, invoiceId: finding.invoiceId, discrepancyId: finding.id, actor, action, changes, reason });
}

// Confirm disputes the overcharge; dismiss lets the billed amount stand. A decision may change until approval.
export async function resolveDiscrepancy(deps: ReviewDeps, actor: string, id: string, decision: Decision, note?: string | null) {
  const reason = text(note, 'note');
  await asReviewer(deps, actor, async (tx) => {
    if (!UUID.test(id)) throw refuse('NOT_FOUND', `discrepancy ${id} not found`);
    // A finding never changes invoice, so its invoice is read first and locked before the finding is read: every writer
    // of an invoice's findings takes the invoice's lock first, so two of them can never wait on each other.
    const [found] = await tx
      .select({ invoiceId: discrepancies.invoiceId })
      .from(discrepancies)
      .where(and(eq(discrepancies.tenantId, deps.tenantId), eq(discrepancies.id, id)));
    if (!found) throw refuse('NOT_FOUND', `discrepancy ${id} not found`);
    const invoice = await lockInvoice(tx, deps.tenantId, found.invoiceId);
    if (invoice.status !== 'reconciled') throw refuse('CONFLICT', `the invoice is ${invoice.status}; decisions change only while it is reconciled`);
    const [row] = await tx.select({ status: discrepancies.status }).from(discrepancies).where(eq(discrepancies.id, id));
    await decide(tx, deps.tenantId, actor, { id, invoiceId: found.invoiceId, status: row!.status }, decision, reason);
  });
}

export type InvoiceDecision = 'APPROVE_AS_BILLED' | 'DISPUTE' | 'APPROVE_AT_RATE_CARD';
export const CHANGED = 'This invoice changed since you opened it. Reload it to see what changed.';
const MAX_SEEN = 1_000;

// Every open finding of a reconciled invoice decided at once, then the invoice approved unless the decision is a
// dispute, in one transaction. It goes ahead only if the invoice's findings are exactly those the reviewer saw, at the
// versions they saw; a repeated request finds its key and writes nothing.
export async function decideInvoice(
  deps: ReviewDeps,
  actor: string,
  id: string,
  decision: InvoiceDecision,
  seen: readonly { id: string; version: string }[],
  requestId: string,
) {
  if (!UUID.test(requestId)) throw refuse('BAD_USER_INPUT', 'requestId must be a UUID');
  if (seen.length > MAX_SEEN) throw refuse('BAD_USER_INPUT', `seen lists more than ${MAX_SEEN} discrepancies`);
  // The decision is part of the key, so the same requestId sent with another decision is a new request.
  const key = `decide:${decision}:${requestId.toLowerCase()}`;
  await asReviewer(deps, actor, async (tx) => {
    const invoice = await lockInvoice(tx, deps.tenantId, id);
    const [used] = await tx
      .select({ invoiceId: idempotencyKeys.invoiceId })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, deps.tenantId), eq(idempotencyKeys.key, key)));
    if (used && used.invoiceId !== id) throw refuse('BAD_USER_INPUT', 'requestId was already used for another invoice');
    if (used) return;
    if (invoice.status !== 'reconciled') throw refuse('CONFLICT', `only a reconciled invoice can be decided; this one is ${invoice.status}`);
    const findings = await tx
      .select({ id: discrepancies.id, type: discrepancies.type, status: discrepancies.status, version: cursorAt(discrepancies.updatedAt) })
      .from(discrepancies)
      .where(and(eq(discrepancies.tenantId, deps.tenantId), eq(discrepancies.invoiceId, id)));
    const saw = new Map(seen.map((finding) => [finding.id, finding.version]));
    if (saw.size !== seen.length || saw.size !== findings.length || findings.some((finding) => saw.get(finding.id) !== finding.version)) {
      throw refuse('CONFLICT', CHANGED);
    }
    if (findings.some(confirmedDuplicate)) throw refuse('CONFLICT', CONFIRMED_DUPLICATE);
    const open = findings.filter((finding) => finding.status === 'open');
    if (open.length === 0) throw refuse('CONFLICT', 'no finding of this invoice is open');
    // A possible duplicate is decided on its own: a decision on every finding would pass it with the charges.
    if (open.some((finding) => finding.type === 'duplicate_invoice')) throw refuse('CONFLICT', 'this invoice may duplicate another one; decide that finding on its own first');
    for (const finding of open) {
      await decide(tx, deps.tenantId, actor, { ...finding, invoiceId: id }, decision === 'APPROVE_AS_BILLED' ? 'dismissed' : 'confirmed', null);
    }
    if (decision !== 'DISPUTE') await approve(tx, deps.tenantId, actor, id, 'reconciled', decision === 'APPROVE_AS_BILLED' ? 'as billed' : 'at rate card');
    // Last, so a failure anywhere above leaves no key and a retry runs in full.
    await tx.insert(idempotencyKeys).values({ tenantId: deps.tenantId, key, invoiceId: id });
  });
}

// Why a held invoice's possible duplicate closed when its reading was corrected.
const NO_MATCH = 'the corrected reading matches no other invoice';

// A held invoice (reconciled at its approval from review, with no shipment) takes a corrected carrier or invoice number
// while its possible duplicate is open, and nothing is matched again: the duplicate lookup runs on the corrected values,
// and no other invoice under them closes the finding, while one still there keeps it, named as the earliest now.
async function correctHeld(tx: Tx, tenantId: string, actor: string, id: string, read: { carrierId: string | null; invoiceNumber: string | null }, changes: Change[]) {
  const [finding] = await tx
    .select({ id: discrepancies.id, evidence: discrepancies.evidence })
    .from(discrepancies)
    .where(and(eq(discrepancies.invoiceId, id), eq(discrepancies.type, 'duplicate_invoice'), eq(discrepancies.status, 'open')));
  if (!finding) throw refuse('CONFLICT', 'its possible duplicate is already decided, so its reading stays as it is');
  await tx.update(invoices).set(read).where(eq(invoices.id, id));
  if (changes.length > 0) await tx.insert(auditEvents).values({ tenantId, invoiceId: id, actor, action: 'corrected', changes });
  const duplicate = await possibleDuplicate(tx, { tenantId, invoiceId: id, ...read });
  if (!duplicate) {
    await tx.update(discrepancies).set({ status: 'closed', resolvedAt: sql`now()` }).where(eq(discrepancies.id, finding.id));
    const closed: Change[] = [{ field: 'status', from: 'open', to: 'closed' }];
    await tx.insert(auditEvents).values({ tenantId, invoiceId: id, discrepancyId: finding.id, actor, action: 'discrepancy_closed', changes: closed, reason: NO_MATCH });
  } else if (duplicate.evidence !== finding.evidence) {
    await tx.update(discrepancies).set({ evidence: duplicate.evidence }).where(eq(discrepancies.id, finding.id));
  }
}

// The way out of needs_review when the reading matched no shipment: the reviewer corrects the carrier, the PRO number or
// both, and matching runs again (reconcile reads invoices.carrier_id and pro_number; the extraction keeps the reading).
// On an invoice already extracted, nothing changes but matching is queued again. A held invoice goes to correctHeld.
export async function correctInvoice(
  deps: ReviewDeps,
  actor: string,
  id: string,
  carrierId?: string | null,
  proNumber?: string | null,
  invoiceNumber?: string | null,
) {
  const pro = text(proNumber, 'PRO number');
  const number = text(invoiceNumber, 'invoice number');
  if (!carrierId && !pro && !number) throw refuse('BAD_USER_INPUT', 'give the carrier, the PRO number or the invoice number');
  if (pro && pro.length > 64) throw refuse('BAD_USER_INPUT', 'PRO number is longer than 64 characters');
  if (number && number.length > 64) throw refuse('BAD_USER_INPUT', 'invoice number is longer than 64 characters');
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
    const held = invoice.status === 'reconciled' && invoice.shipmentId === null;
    if (invoice.status === 'needs_review' && extraction?.reviewReason !== 'no_shipment_match') {
      const reason = extraction?.reviewReason ?? 'the extraction failed validation';
      throw refuse('CONFLICT', `correcting the carrier or PRO number cannot help here (${reason}); approve or reject the invoice`);
    }
    if (!held && invoice.status !== 'needs_review' && invoice.status !== 'extracted') {
      throw refuse('CONFLICT', `only an invoice that needs review, or one held for a possible duplicate, can be corrected; this one is ${invoice.status}`);
    }
    if (held && pro) throw refuse('BAD_USER_INPUT', 'a held invoice is not matched to a shipment again, so its PRO number stays as read');
    if (!held && number) throw refuse('BAD_USER_INPUT', 'only an invoice held for a possible duplicate takes a corrected invoice number');
    const changes: Change[] = [];
    const nameOf = async (carrier: string) =>
      (await tx.select({ name: carriers.name }).from(carriers).where(and(eq(carriers.tenantId, deps.tenantId), eq(carriers.id, carrier))))[0]?.name;
    if (carrierId && carrierId !== invoice.carrierId) {
      const next = await nameOf(carrierId);
      if (!next) throw refuse('BAD_USER_INPUT', 'carrier is not one of yours');
      changes.push({ field: 'carrier', from: (invoice.carrierId && (await nameOf(invoice.carrierId))) || null, to: next });
    }
    if (held) {
      if (number && number !== invoice.invoiceNumber) changes.push({ field: 'invoiceNumber', from: invoice.invoiceNumber, to: number });
      await correctHeld(tx, deps.tenantId, actor, id, { carrierId: carrierId ?? invoice.carrierId, invoiceNumber: number ?? invoice.invoiceNumber }, changes);
      return null;
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
  if (!contentSha256) return;
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
    if (invoice.status !== 'needs_review' && invoice.status !== 'reconciled') {
      throw refuse('CONFLICT', `only a reconciled invoice or one that needs review can be rejected; this one is ${invoice.status}`);
    }
    // Its open findings close with it, undecided, so the review queue stops counting them; each audit row says why.
    const closed = await tx
      .update(discrepancies)
      .set({ status: 'closed', resolvedAt: sql`now()` })
      .where(and(eq(discrepancies.invoiceId, id), eq(discrepancies.status, 'open')))
      .returning({ id: discrepancies.id });
    if (closed.length > 0) {
      const changes: Change[] = [{ field: 'status', from: 'open', to: 'closed' }];
      const why = 'the invoice was rejected';
      await tx.insert(auditEvents).values(closed.map((finding) => ({ tenantId: deps.tenantId, invoiceId: id, discrepancyId: finding.id, actor, action: 'discrepancy_closed', changes, reason: why })));
    }
    await tx.update(invoices).set({ status: 'rejected' }).where(eq(invoices.id, id));
    const changes: Change[] = [{ field: 'status', from: invoice.status, to: 'rejected' }];
    await tx.insert(auditEvents).values({ tenantId: deps.tenantId, invoiceId: id, actor, action: 'rejected', changes, reason });
  });
}

export async function replay(deps: ReviewDeps, actor: string, id: string) {
  const replayed = await replayDeadLetter(deps, deps.tenantId, id, actor);
  if (!replayed) throw refuse('NOT_FOUND', `no open dead letter ${id}`);
  return replayed;
}
