import { deadLetters, invoices } from '@freightaudit/db';
import type { Job } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isQueueName, type QueueName, type Queues } from './queues.ts';
import { send, type TraceCarrier } from './tracing.ts';

type Deps = { db: NodePgDatabase; queues: Queues };
type JobData = { tenantId: string; invoiceId?: string; otel?: TraceCarrier };

// Lifecycle (docs/context.md): the status an invoice holds while a queue's step runs, and the one a replay restores.
const RUNNING = { extract: 'extracting', reconcile: 'reconciling' } as const;
const REPLAYED = { extract: 'received', reconcile: 'extracted' } as const;
const isInvoiceStep = (queue: QueueName): queue is keyof typeof RUNNING => queue in RUNNING;
// Job name for a dead letter whose queue copy is gone, such as the rows the seed writes.
const DEFAULT_JOB_NAME: Record<QueueName, string> = { extract: 'extract', reconcile: 'reconcile', 'tms-sync': 'sync' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True once BullMQ will not run the job again.
export const isFinalFailure = (job: Job, err: Error) =>
  err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);

// Final failure: records the job in dead_letters, marks its invoice failed, then copies the job to <queue>-dlq. Both
// writes are idempotent (the open-job unique index, the DLQ job id), and the copy comes last, so it marks a move that
// finished: sweepFailedJobs redoes any move that has no copy.
export async function deadLetter({ db, queues }: Deps, queue: QueueName, job: Job<JobData>, err: Error) {
  const jobId = job.id!;
  await db.transaction(async (tx) => {
    const row = { tenantId: job.data.tenantId, queue, jobId, payload: job.data, error: err.message, attempts: Math.max(1, job.attemptsMade) };
    await tx.insert(deadLetters).values(row).onConflictDoNothing();
    if (isInvoiceStep(queue) && job.data.invoiceId) {
      const running = and(eq(invoices.id, job.data.invoiceId), eq(invoices.status, RUNNING[queue]));
      await tx.update(invoices).set({ status: 'failed' }).where(running);
    }
  });
  await queues.dlq(queue).add(job.name, job.data, { jobId });
}

// Redoes dead-letter moves that did not finish: the handler failed (Postgres was down), or its worker died between
// BullMQ's move to failed and the handler. Every job in the failed set has used up its attempts.
export async function sweepFailedJobs(deps: Deps, queue: QueueName) {
  let moved = 0;
  for (const job of await deps.queues.queue(queue).getFailed()) {
    if (!job.id || (await deps.queues.dlq(queue).getJob(job.id))) continue;
    await deadLetter(deps, queue, job, new Error(job.failedReason));
    moved++;
  }
  return moved;
}

// Requeues a dead letter: the job goes back first, then the row and invoice change. A worker that meets the invoice
// still failed retries until that commits, and a replay that stops halfway leaves the dead letter open to try again.
export async function replayDeadLetter({ db, queues }: Deps, tenantId: string, id: string) {
  if (!UUID.test(id)) return undefined;
  const open = and(eq(deadLetters.id, id), eq(deadLetters.tenantId, tenantId), isNull(deadLetters.replayedAt));
  const [row] = await db.select().from(deadLetters).where(open);
  if (!row || !isQueueName(row.queue)) return undefined;
  const queueName = row.queue;
  const copy = await queues.dlq(queueName).getJob(row.jobId);
  const data = { ...((copy?.data ?? { ...(row.payload as object), tenantId }) as JobData) };
  // The replay continues the trace of the request that asked for it, not the one the job failed in.
  delete data.otel;
  const name = copy?.name ?? DEFAULT_JOB_NAME[queueName];
  // The failed original still holds the job id, and adding a job with a taken id is a no-op.
  await queues.queue(queueName).remove(row.jobId);
  await send(queueName, row.jobId, (trace) => queues.queue(queueName).add(name, { ...data, ...trace }, { jobId: row.jobId }));
  await db.transaction(async (tx) => {
    await tx.update(deadLetters).set({ replayedAt: sql`now()` }).where(eq(deadLetters.id, row.id));
    // Only a queue's own step restarts the lifecycle; other jobs, such as a split's collect, move the status themselves.
    if (isInvoiceStep(queueName) && name === DEFAULT_JOB_NAME[queueName] && typeof data.invoiceId === 'string') {
      const failed = and(eq(invoices.id, data.invoiceId), eq(invoices.status, 'failed'));
      await tx.update(invoices).set({ status: REPLAYED[queueName] }).where(failed);
    }
  });
  await queues.dlq(queueName).remove(row.jobId);
  return { id: row.id, jobId: row.jobId };
}
