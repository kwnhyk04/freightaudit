import type { components, operations } from '@freightaudit/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { problem } from './problem.ts';
import { type Upload, uploadsOf } from './uploads.ts';

type Invoice = components['schemas']['Invoice'];
type Discrepancy = components['schemas']['Discrepancy'];
type BatchItemResult = components['schemas']['BatchItemResult'];
// Validation applies the spec default, so limit is always set here.
type PageQuery = { limit: number; cursor?: string };

// ponytail: in-memory store with offset cursors; the Postgres store with keyset cursors replaces it.
export function createStore() {
  return {
    invoices: [] as Invoice[],
    invoiceIdsByHash: new Map<string, string>(),
    hashesByIdempotencyKey: new Map<string, string>(),
    discrepancies: [] as Discrepancy[],
    deadLetterIds: new Set<string>(),
  };
}

export type Store = ReturnType<typeof createStore>;

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

function page<T>(items: T[], { limit, cursor }: PageQuery) {
  const offset = cursor === undefined ? 0 : Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, 'cursor is invalid');
  const end = offset + limit;
  const nextCursor = end < items.length ? Buffer.from(String(end)).toString('base64url') : null;
  return { items: items.slice(offset, end), next_cursor: nextCursor };
}

// Stub handlers keyed by operationId, as fastify-openapi-glue expects.
export function createStubService(store: Store) {
  function addInvoice({ filename, sha256 }: Upload) {
    const invoice: Invoice = {
      id: randomUUID(),
      status: 'received',
      filename,
      content_hash: sha256,
      carrier: null,
      invoice_number: null,
      invoice_date: null,
      currency: null,
      total_cents: null,
      created_at: new Date().toISOString(),
    };
    store.invoices.unshift(invoice);
    store.invoiceIdsByHash.set(sha256, invoice.id);
    return invoice.id;
  }

  return {
    getHealthz: async () => ({ status: 'ok' }),

    async createInvoice(req: FastifyRequest, reply: FastifyReply) {
      const key = req.headers['idempotency-key'] as string;
      const [upload] = uploadsOf(req, 'file');
      if (!upload?.isPdf) throw fail(415, 'file must be a PDF');
      const keyHash = store.hashesByIdempotencyKey.get(key);
      if (keyHash !== undefined && keyHash !== upload.sha256) {
        throw fail(422, 'Idempotency-Key was already used with a different file');
      }
      store.hashesByIdempotencyKey.set(key, upload.sha256);
      const existing = store.invoiceIdsByHash.get(upload.sha256);
      return existing ? reply.code(200).send({ id: existing }) : reply.code(202).send({ id: addInvoice(upload) });
    },

    async createInvoiceBatch(req: FastifyRequest, reply: FastifyReply) {
      const results = uploadsOf(req, 'files').map((upload, index): BatchItemResult => {
        if (!upload.isPdf) return { index, status: 'rejected', error: problem(415, 'file must be a PDF') };
        const existing = store.invoiceIdsByHash.get(upload.sha256);
        if (existing) return { index, status: 'duplicate', invoice_id: existing };
        return { index, status: 'accepted', invoice_id: addInvoice(upload) };
      });
      return reply.code(202).send({ results });
    },

    async listInvoices(req: FastifyRequest) {
      const query = req.query as PageQuery & { status?: Invoice['status'] };
      const invoices = query.status ? store.invoices.filter((invoice) => invoice.status === query.status) : store.invoices;
      return page(invoices, query);
    },

    async getInvoice(req: FastifyRequest) {
      const { id } = req.params as operations['getInvoice']['parameters']['path'];
      const invoice = store.invoices.find((candidate) => candidate.id === id);
      if (!invoice) throw fail(404, `invoice ${id} not found`);
      return invoice;
    },

    listDiscrepancies: async (req: FastifyRequest) => page(store.discrepancies, req.query as PageQuery),

    async replayDeadLetter(req: FastifyRequest, reply: FastifyReply) {
      const { id } = req.params as operations['replayDeadLetter']['parameters']['path'];
      if (!store.deadLetterIds.delete(id)) throw fail(404, `dead letter ${id} not found`);
      return reply.code(202).send({ id, job_id: randomUUID() });
    },
  };
}
