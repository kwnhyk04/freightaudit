import type { components, operations } from '@freightaudit/contracts';
import { carriers, discrepancies, idempotencyKeys, invoiceLines, invoices } from '@freightaudit/db';
import { type Queues, replayDeadLetter } from '@freightaudit/pipeline';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail, problem } from './problem.ts';
import { type Upload, uploadsOf } from './uploads.ts';

type Invoice = components['schemas']['Invoice'];
type BatchItemResult = components['schemas']['BatchItemResult'];
// Validation applies the spec default, so limit is always set here.
type PageQuery = { limit: number; cursor?: string };
export type ServiceDeps = { db: NodePgDatabase; queues: Queues; tenantId: string };

// Keyset cursor: the last row's created_at in UTC to the microsecond, and its id, as opaque base64url JSON.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorAt = (column: PgColumn) => sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Rows after the cursor in (created_at DESC, id DESC) order, the order of the keyset indexes.
function after(createdAt: PgColumn, id: PgColumn, cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw fail(400, 'cursor is invalid');
  }
  const [at, last] = Array.isArray(decoded) ? decoded : [];
  if (typeof at !== 'string' || !AT.test(at) || typeof last !== 'string' || !UUID.test(last)) throw fail(400, 'cursor is invalid');
  return sql`(${createdAt}, ${id}) < (${at}::timestamptz, ${last}::uuid)`;
}

// Fetch limit + 1 rows: the extra row only tells whether another page exists.
function page<Row extends { id: string; cursorAt: string }, Item>(rows: Row[], limit: number, toItem: (row: Row) => Item) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next = rows.length > limit && last ? Buffer.from(JSON.stringify([last.cursorAt, last.id])).toString('base64url') : null;
  return { items: items.map(toItem), next_cursor: next };
}

const invoiceColumns = {
  id: invoices.id,
  status: invoices.status,
  filename: invoices.filename,
  contentSha256: invoices.contentSha256,
  carrier: carriers.name,
  invoiceNumber: invoices.invoiceNumber,
  invoiceDate: invoices.invoiceDate,
  currency: invoices.currency,
  totalCents: invoices.totalCents,
  createdAt: invoices.createdAt,
  cursorAt: cursorAt(invoices.createdAt),
};

type InvoiceRow = {
  id: string;
  status: Invoice['status'];
  filename: string;
  contentSha256: string;
  carrier: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
  totalCents: bigint | null;
  createdAt: Date;
};

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  status: row.status,
  filename: row.filename,
  content_hash: row.contentSha256,
  carrier: row.carrier,
  invoice_number: row.invoiceNumber,
  invoice_date: row.invoiceDate,
  currency: row.currency,
  total_cents: row.totalCents === null ? null : Number(row.totalCents),
  created_at: row.createdAt.toISOString(),
});

// REST handlers keyed by operationId, as fastify-openapi-glue expects.
export function createService(deps: ServiceDeps) {
  const { db, queues, tenantId } = deps;
  const selectInvoices = () => db.select(invoiceColumns).from(invoices).leftJoin(carriers, eq(carriers.id, invoices.carrierId));

  // A new file gets an invoice row and an extract job whose id is the content hash. An invoice still received is
  // queued again in case an earlier add was lost; while its job exists, the add is a no-op.
  async function ingest({ filename, sha256 }: Upload) {
    const [created] = await db
      .insert(invoices)
      .values({ tenantId, filename, contentSha256: sha256 })
      .onConflictDoNothing()
      .returning({ id: invoices.id, status: invoices.status });
    const [invoice] = created
      ? [created]
      : await db
          .select({ id: invoices.id, status: invoices.status })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), eq(invoices.contentSha256, sha256)));
    if (invoice!.status === 'received') {
      await queues.queue('extract').add('extract', { tenantId, invoiceId: invoice!.id }, { jobId: sha256 });
    }
    return { id: invoice!.id, created: created !== undefined };
  }

  return {
    async createInvoice(req: FastifyRequest, reply: FastifyReply) {
      const key = req.headers['idempotency-key'] as string;
      const [upload] = uploadsOf(req, 'file');
      if (!upload) throw fail(400, 'file is required');
      if (upload.rejection) throw fail(upload.rejection.status, upload.rejection.detail);
      const [used] = await db
        .select({ sha256: invoices.contentSha256 })
        .from(idempotencyKeys)
        .innerJoin(invoices, eq(invoices.id, idempotencyKeys.invoiceId))
        .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)));
      if (used && used.sha256 !== upload.sha256) throw fail(422, 'Idempotency-Key was already used with a different file');
      const { id, created } = await ingest(upload);
      if (!used) await db.insert(idempotencyKeys).values({ tenantId, key, invoiceId: id }).onConflictDoNothing();
      return reply.code(created ? 202 : 200).send({ id });
    },

    async createInvoiceBatch(req: FastifyRequest, reply: FastifyReply) {
      const results: BatchItemResult[] = [];
      for (const [index, upload] of uploadsOf(req, 'files').entries()) {
        if (upload.rejection) {
          results.push({ index, status: 'rejected', error: problem(upload.rejection.status, upload.rejection.detail) });
          continue;
        }
        const { id, created } = await ingest(upload);
        results.push({ index, status: created ? 'accepted' : 'duplicate', invoice_id: id });
      }
      return reply.code(202).send({ results });
    },

    async listInvoices(req: FastifyRequest) {
      const { limit, cursor, status } = req.query as PageQuery & { status?: Invoice['status'] };
      const rows = await selectInvoices()
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            status === undefined ? undefined : eq(invoices.status, status),
            after(invoices.createdAt, invoices.id, cursor),
          ),
        )
        .orderBy(desc(invoices.createdAt), desc(invoices.id))
        .limit(limit + 1);
      return page(rows, limit, toInvoice);
    },

    async getInvoice(req: FastifyRequest) {
      const { id } = req.params as operations['getInvoice']['parameters']['path'];
      const [row] = await selectInvoices().where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
      if (!row) throw fail(404, `invoice ${id} not found`);
      return toInvoice(row);
    },

    async listDiscrepancies(req: FastifyRequest) {
      const { limit, cursor } = req.query as PageQuery;
      const rows = await db
        .select({
          id: discrepancies.id,
          invoiceId: discrepancies.invoiceId,
          lineItemId: discrepancies.invoiceLineId,
          shipmentId: discrepancies.shipmentId,
          rateCardVersionId: invoiceLines.rateCardVersionId,
          type: discrepancies.type,
          status: discrepancies.status,
          expectedCents: discrepancies.expectedCents,
          billedCents: discrepancies.billedCents,
          evidence: discrepancies.evidence,
          createdAt: discrepancies.createdAt,
          cursorAt: cursorAt(discrepancies.createdAt),
        })
        .from(discrepancies)
        .leftJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
        .where(and(eq(discrepancies.tenantId, tenantId), after(discrepancies.createdAt, discrepancies.id, cursor)))
        .orderBy(desc(discrepancies.createdAt), desc(discrepancies.id))
        .limit(limit + 1);
      return page(rows, limit, (row) => ({
        id: row.id,
        invoice_id: row.invoiceId,
        line_item_id: row.lineItemId,
        shipment_id: row.shipmentId,
        rate_card_version_id: row.rateCardVersionId,
        type: row.type,
        status: row.status,
        expected_cents: Number(row.expectedCents),
        billed_cents: Number(row.billedCents),
        evidence: row.evidence,
        created_at: row.createdAt.toISOString(),
      }));
    },

    async replayDeadLetter(req: FastifyRequest, reply: FastifyReply) {
      const { id } = req.params as operations['replayDeadLetter']['parameters']['path'];
      const replayed = await replayDeadLetter(deps, tenantId, id);
      if (!replayed) throw fail(404, `dead letter ${id} not found`);
      return reply.code(202).send({ id: replayed.id, job_id: replayed.jobId });
    },
  };
}
