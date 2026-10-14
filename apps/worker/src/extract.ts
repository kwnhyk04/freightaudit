import { carriers, extractions, invoices } from '@freightaudit/db';
import {
  type ExtractedInvoice,
  extractInvoices,
  MAX_PAGES,
  PermanentError,
  readPdf,
  splitPdf,
  TransientError,
  type Usage,
} from '@freightaudit/llm';
import { type InvoiceJob, jobOptions } from '@freightaudit/pipeline';
import { DelayedError, type Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Deps } from './workers.ts';

type Invoice = typeof invoices.$inferSelect;
type Pdf = Awaited<ReturnType<typeof readPdf>>;
type Extraction = { invoices: ExtractedInvoice[]; model: string; usage: Usage };
type CollectJob = InvoiceJob & { model: string; usage: Usage; parts: { invoiceId: string; jobId: string }[] };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function loadInvoice({ db }: Deps, invoiceId: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new PermanentError(`invoice ${invoiceId} not found`);
  // A replay requeues the job before it resets the status, so retry until that commits.
  if (invoice.status === 'failed') throw new TransientError('invoice is still failed; waiting for its replay to commit');
  return invoice;
}

const queueReconcile = ({ queues }: Deps, invoice: Invoice) =>
  queues.queue('reconcile').add('reconcile', { tenantId: invoice.tenantId, invoiceId: invoice.id }, { jobId: invoice.contentSha256 });

// Extracts one uploaded or split-out invoice. Safe to rerun from any point: the status guards and the unique
// extraction row mean a recovered or duplicated job never writes twice.
export async function extract(deps: Deps, job: Job<InvoiceJob>, token?: string) {
  const { db, storage, limits, provider } = deps;
  const invoice = await loadInvoice(deps, job.data.invoiceId);
  if (invoice.status !== 'received' && invoice.status !== 'extracting') {
    // An earlier run saved its result but may have stopped before queueing reconcile; a repeat add is a no-op.
    if (invoice.status === 'extracted') await queueReconcile(deps, invoice);
    return { invoiceId: invoice.id, skipped: invoice.status };
  }

  // Budget spent or AI switched off: wait without calling the model and without using an attempt.
  const until = await limits.blockedUntil();
  if (until !== undefined) {
    await job.moveToDelayed(until, token);
    throw new DelayedError();
  }
  if (!provider) throw new PermanentError('AI is enabled but no model provider is configured');

  if (invoice.status === 'received') {
    await db.update(invoices).set({ status: 'extracting' }).where(and(eq(invoices.id, invoice.id), eq(invoices.status, 'received')));
  }
  const bytes = await storage.get(invoice.contentSha256);
  if (!bytes) throw new PermanentError('PDF is missing from object storage');
  const pdf = await readPdf(bytes);
  const pageCount = pdf.getPageCount();
  if (pageCount > MAX_PAGES) throw new PermanentError(`PDF has ${pageCount} pages; the limit is ${MAX_PAGES}`);

  const result = await extractInvoices(provider, { pdf: bytes, pageCount });
  if (result.invoices.length > 1) {
    if (invoice.parentInvoiceId) throw new PermanentError('a split-out part holds more than one invoice');
    return split(deps, invoice, pdf, result);
  }
  await save(deps, invoice, result.invoices[0]!, result);
  await queueReconcile(deps, invoice);
  return { invoiceId: invoice.id, status: 'extracted' };
}

async function save({ db }: Deps, invoice: Invoice, data: ExtractedInvoice, { model, usage }: Extraction) {
  await db.transaction(async (tx) => {
    // The unique invoice_id makes this a no-op when another run already saved.
    const extraction = { tenantId: invoice.tenantId, invoiceId: invoice.id, model, ...usage, result: data };
    await tx.insert(extractions).values(extraction).onConflictDoNothing();
    const [carrier] = await tx
      .select({ id: carriers.id })
      .from(carriers)
      .where(and(eq(carriers.tenantId, invoice.tenantId), eq(carriers.name, data.carrier)));
    await tx
      .update(invoices)
      .set({
        status: 'extracted',
        carrierId: carrier?.id ?? null,
        invoiceNumber: data.invoice_number,
        proNumber: data.pro_number,
        invoiceDate: data.invoice_date,
        currency: data.currency,
        totalCents: BigInt(data.total_cents),
      })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.status, 'extracting')));
  });
}

// A multi-invoice upload: one PDF and invoice row per part, then a flow whose parent runs once every part has
// finished, failed or not, and records each outcome on the upload.
async function split({ db, storage, queues }: Deps, invoice: Invoice, pdf: Pdf, { invoices: found, model, usage }: Extraction) {
  const pageCount = pdf.getPageCount();
  const ranges = found.map((part, i): [number, number] => [part.first_page, (found[i + 1]?.first_page ?? pageCount + 1) - 1]);
  const parts = await splitPdf(pdf, ranges);
  const children: { invoiceId: string; jobId: string }[] = [];
  for (const [i, bytes] of parts.entries()) {
    const contentSha256 = sha256(bytes);
    await storage.put(contentSha256, bytes);
    const [from, to] = ranges[i]!;
    const filename = `${invoice.filename} (pages ${from}-${to})`;
    await db
      .insert(invoices)
      .values({ tenantId: invoice.tenantId, filename, contentSha256, parentInvoiceId: invoice.id })
      .onConflictDoNothing();
    const [child] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, invoice.tenantId), eq(invoices.contentSha256, contentSha256)));
    children.push({ invoiceId: child!.id, jobId: contentSha256 });
  }
  await queues.flows.add({
    name: 'collect',
    queueName: 'extract',
    data: { tenantId: invoice.tenantId, invoiceId: invoice.id, model, usage, parts: children } satisfies CollectJob,
    opts: { ...jobOptions, jobId: `split-${invoice.contentSha256}` },
    children: children.map(({ invoiceId, jobId }) => ({
      name: 'extract',
      queueName: 'extract',
      data: { tenantId: invoice.tenantId, invoiceId } satisfies InvoiceJob,
      // A failed part must not fail the upload; the parent reads the failure instead.
      opts: { ...jobOptions, jobId, ignoreDependencyOnFailure: true },
    })),
  });
  return { invoiceId: invoice.id, split: children.length };
}

// Parent of a split: records each part's outcome on the upload, then marks the upload extracted (from failed when
// a dead-lettered collect is replayed).
export async function collect({ db }: Deps, job: Job<CollectJob>) {
  const { tenantId, invoiceId, model, usage, parts } = job.data;
  // Keyed by job key (<prefix>:extract:<job id>), with the failure reason.
  const failures = Object.entries(await job.getIgnoredChildrenFailures());
  const rows = await db
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(inArray(invoices.id, parts.map((part) => part.invoiceId)));
  const statuses = new Map(rows.map((row) => [row.id, row.status]));
  const outcomes = parts.map(({ invoiceId: id, jobId }) => {
    const error = failures.find(([key]) => key.endsWith(`:${jobId}`))?.[1];
    return error === undefined ? { invoiceId: id, status: statuses.get(id) } : { invoiceId: id, status: 'failed', error };
  });
  await db.transaction(async (tx) => {
    await tx.insert(extractions).values({ tenantId, invoiceId, model, ...usage, result: { parts: outcomes } }).onConflictDoNothing();
    const unfinished = and(eq(invoices.id, invoiceId), inArray(invoices.status, ['extracting', 'failed']));
    await tx.update(invoices).set({ status: 'extracted' }).where(unfinished);
  });
  return { invoiceId, parts: outcomes };
}
