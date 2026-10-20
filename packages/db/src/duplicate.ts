import { duplicateInvoice } from '@freightaudit/domain';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { invoices } from './schema.ts';

// The possible-duplicate check of reconcile and of an approval from review: the carrier's other invoices under the
// invoice's number, earliest first, and the domain decides. Without a carrier and a number there is nothing to compare.
// ponytail: scans the tenant's invoices; an index on (tenant_id, carrier_id, invoice_number) past about 100k.
export async function possibleDuplicate(
  db: Pick<NodePgDatabase, 'select'>,
  { tenantId, invoiceId, carrierId, invoiceNumber }: { tenantId: string; invoiceId: string; carrierId: string | null; invoiceNumber: string | null },
) {
  if (!carrierId || !invoiceNumber) return undefined;
  const others = await db
    .select({ filename: invoices.filename, status: invoices.status, receivedOn: sql<string>`to_char(${invoices.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')` })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.carrierId, carrierId), eq(invoices.invoiceNumber, invoiceNumber), ne(invoices.id, invoiceId)))
    .orderBy(asc(invoices.createdAt), asc(invoices.id));
  return duplicateInvoice(invoiceNumber, others);
}
