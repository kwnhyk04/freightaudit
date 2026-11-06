import { deadLetterJobs, extractPaused, queueJobs } from '@freightaudit/telemetry';
import { FlowProducer, type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { TraceCarrier } from './tracing.ts';

export const QUEUE_NAMES = ['extract', 'reconcile', 'tms-sync'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export const isQueueName = (name: string): name is QueueName => (QUEUE_NAMES as readonly string[]).includes(name);

// Job data holds ids and trace context only, never document contents; the invoice row has the rest.
export type InvoiceJob = { tenantId: string; invoiceId: string; otel?: TraceCarrier };
export type TmsSyncJob = { tenantId: string };

// Eight attempts, spaced by the worker's 'jittered' backoffStrategy, so a job outlasts a provider outage of 5 minutes:
// its seven waits add up to 5 min 7.5 s at the least and 10 min 15 s at the most. Completed jobs stay a week, so adding a
// job whose id (the invoice content hash) was already used stays a no-op for at least that long. Failed jobs stay two
// weeks, long after their move to the dead-letter queue and table.
export const jobOptions = {
  attempts: 8,
  backoff: { type: 'jittered' },
  removeOnComplete: { age: 7 * 86_400 },
  removeOnFail: { age: 14 * 86_400 },
} satisfies JobsOptions;

// Exponential from baseMs, capped at capMs. Jitter spreads only the upper half of each delay: full jitter could spend
// every attempt inside an outage. An error's retryAfterMs (Retry-After) is the floor, and may pass capMs.
export const jitteredBackoff =
  (baseMs = 5_000, capMs = 300_000, random = Math.random) =>
  (attemptsMade: number, _type?: string, err?: Error) => {
    const ceiling = Math.min(capMs, baseMs * 2 ** (attemptsMade - 1));
    const floor = (err as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 0;
    return Math.max(Math.round((ceiling * (1 + random())) / 2), floor);
  };

// Jobs not yet running: waiting, plus delayed by a retry backoff or by the AI budget guard.
export async function backlog(queue: Queue) {
  const counts = await queue.getJobCounts('wait', 'delayed');
  return (counts.wait ?? 0) + (counts.delayed ?? 0);
}

// The pipeline queues, each with a <name>-dlq dead-letter queue, plus a flow producer, on one shared connection. BullMQ
// writes a queue's settings to Redis as it opens, which a read-only set, for a dry run, skips.
export function createQueues(connection: Redis, prefix: string, { readOnly = false } = {}) {
  const open = (name: string, defaultJobOptions?: JobsOptions) => new Queue(name, { connection, prefix, defaultJobOptions, skipMetasUpdate: readOnly });
  const queues = new Map(QUEUE_NAMES.map((name) => [name, open(name, jobOptions)]));
  const dlqs = new Map(QUEUE_NAMES.map((name) => [name, open(`${name}-dlq`)]));
  const flows = new FlowProducer({ connection, prefix });
  return {
    prefix,
    flows,
    queue: (name: QueueName) => queues.get(name)!,
    dlq: (name: QueueName) => dlqs.get(name)!,
    async close() {
      await Promise.all([...queues.values(), ...dlqs.values(), flows].map((closable) => closable.close()));
    },
  };
}

export type Queues = ReturnType<typeof createQueues>;

// Queue depth, dead letters waiting and the extract circuit breaker, read from Redis at each metric export. One
// process reports them (the worker); with several, dashboards take the max.
export function observeQueues(queues: Queues) {
  queueJobs.addCallback(async (result) => {
    for (const queue of QUEUE_NAMES) {
      const counts = await queues.queue(queue).getJobCounts('wait', 'active', 'delayed');
      for (const [state, count] of Object.entries(counts)) result.observe(count, { queue, state });
    }
  });
  deadLetterJobs.addCallback(async (result) => {
    for (const queue of QUEUE_NAMES) result.observe((await queues.dlq(queue).getJobCounts('wait')).wait ?? 0, { queue });
  });
  extractPaused.addCallback(async (result) => result.observe((await queues.queue('extract').isPaused()) ? 1 : 0));
}
