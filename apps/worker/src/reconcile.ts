import { extractions, invoices, shipments } from '@freightaudit/db';
import { PermanentError, TransientError } from '@freightaudit/llm';
import type { InvoiceJob } from '@freightaudit/pipeline';
import type { Job } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from './workers.ts';

// ponytail: stub. It marks the invoice reconciling and links its shipment; rate-card checks, discrepancies and the
// final reconciled or needs_review status arrive with the domain rules in step 6.
export async function reconcile({ db }: Deps, job: Job<InvoiceJob>) {
  const { invoiceId } = job.data;
  const [invoice] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new PermanentError(`invoice ${invoiceId} not found`);
  if (invoice.status === 'failed') throw new TransientError('invoice is still failed; waiting for its replay to commit');
  // A split upload has no lines of its own (its extraction lists parts); the parts are reconciled one by one.
  const [split] = await db
    .select({ id: extractions.id })
    .from(extractions)
    .where(and(eq(extractions.invoiceId, invoiceId), sql`${extractions.result} ? 'parts'`));
  if (split || (invoice.status !== 'extracted' && invoice.status !== 'reconciling')) return { invoiceId, skipped: invoice.status };

  const [updated] = await db
    .update(invoices)
    .set({
      status: 'reconciling',
      // The shipment with the invoice's carrier and PRO number, once the TMS sync has it.
      shipmentId: sql`(SELECT ${shipments.id} FROM ${shipments} WHERE ${shipments.tenantId} = ${invoices.tenantId}
        AND ${shipments.carrierId} = ${invoices.carrierId} AND ${shipments.proNumber} = ${invoices.proNumber})`,
    })
    .where(and(eq(invoices.id, invoiceId), inArray(invoices.status, ['extracted', 'reconciling'])))
    .returning({ shipmentId: invoices.shipmentId });
  return { invoiceId, shipmentId: updated?.shipmentId ?? null };
}
