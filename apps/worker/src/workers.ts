import { queryError } from '@freightaudit/db';
import { type Limits, type Models, PermanentError } from '@freightaudit/llm';
import {
  consume,
  deadLetter,
  isFinalFailure,
  jitteredBackoff,
  jobOptions,
  type QueueName,
  type Queues,
  type Storage,
  sweepFailedJobs,
} from '@freightaudit/pipeline';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { collect, extract } from './extract.ts';
import { reconcile } from './reconcile.ts';
import { syncShipments } from './tms-sync.ts';

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Logger = { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };

export type Deps = {
  db: Db;
  redis: Redis;
  queues: Queues;
  storage: Storage;
  limits: Limits;
  // One model per role; absent while AI_ENABLED is false, and extract jobs then wait.
  models?: Models;
  // A page whose text layer has fewer non-space characters than this is read as an image.
  textMinChars: number;
  // Evals pass false: a 429 then waits and retries instead of moving the first pass to the fallback model.
  fallbackOnRateLimit?: boolean;
  tmsUrl: string;
  log: Logger;
};

export type WorkerOptions = {
  // How long a worker owns a job before another may recover it; BullMQ renews the lock at half this while it runs.
  lockDuration?: number;
  // How often workers look for stalled jobs; one check per interval runs across all workers. Half the lock by default.
  stalledInterval?: number;
  backoff?: { baseMs?: number; capMs?: number };
  // Documents read at once (EXTRACT_CONCURRENCY).
  extractConcurrency?: number;
};

// TMS sync every 5 minutes. Every worker upserts the same scheduler id, so there is one schedule however many run.
export const scheduleTmsSync = (queues: Queues, tenantId: string) =>
  queues.queue('tms-sync').upsertJobScheduler('tms-sync', { every: 5 * 60_000 }, { name: 'sync', data: { tenantId }, opts: jobOptions });
// Without a TMS (the public demo) the schedule goes too, so turning the sync off sticks.
export const unscheduleTmsSync = (queues: Queues) => queues.queue('tms-sync').removeJobScheduler('tms-sync');

// Permanent errors fail the job at once; every other error is retried with backoff. A failed query's message lists
// every bound value, extracted line items included, and BullMQ stores the message, so only the driver code is kept.
export async function failFast(work: () => Promise<unknown>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof PermanentError) throw new UnrecoverableError(err.message);
    throw queryError(err) ?? err;
  }
}

// How often each worker process redoes dead-letter moves that did not finish.
const SWEEP_MS = 5 * 60_000;

export function startWorkers(
  deps: Deps,
  { lockDuration = 60_000, stalledInterval = lockDuration / 2, backoff = {}, extractConcurrency = 8 }: WorkerOptions = {},
): { workers: Worker[]; close(): Promise<void> } {
  const backoffStrategy = jitteredBackoff(backoff.baseMs, backoff.capMs);
  const common = {
    connection: deps.redis,
    prefix: deps.queues.prefix,
    lockDuration,
    stalledInterval,
    // A job that stalls twice (say, it crashes its worker each time) fails and is dead-lettered.
    maxStalledCount: 1,
    settings: { backoffStrategy },
  };
  // Each attempt runs as a consumer span in the trace of the span that added the job, with its metrics.
  const workers = [
    new Worker(
      'extract',
      (job: Job, token?: string) =>
        consume('extract', job, () => failFast(() => (job.name === 'collect' ? collect(deps, job) : extract(deps, job, token)))),
      { ...common, concurrency: extractConcurrency },
    ),
    new Worker('reconcile', (job: Job) => consume('reconcile', job, () => failFast(() => reconcile(deps, job))), { ...common, concurrency: 8 }),
    new Worker('tms-sync', (job: Job) => consume('tms-sync', job, () => failFast(() => syncShipments(deps, job, backoffStrategy))), common),
  ];

  // Dead-letter moves still running; close() waits for them before the connections go away.
  const moving = new Set<Promise<void>>();
  for (const worker of workers) {
    const queue = worker.name as QueueName;
    // One handler for every final failure, including jobs failed for stalling too often.
    worker.on('failed', (job, err) => {
      if (!job) return;
      deps.log.warn({ queue, jobId: job.id, attemptsMade: job.attemptsMade, reason: err.message }, 'job failed');
      if (!isFinalFailure(job, err)) return;
      const move = deadLetter(deps, queue, job, err).catch((moveErr: unknown) =>
        deps.log.error({ queue, jobId: job.id, err: moveErr }, 'dead-letter move failed'),
      );
      moving.add(move);
      void move.finally(() => moving.delete(move));
    });
    worker.on('error', (err) => deps.log.error({ queue, err }, 'worker error'));
  }

  const sweep = () =>
    Promise.all(
      workers.map((worker) =>
        sweepFailedJobs(deps, worker.name as QueueName).catch((err: unknown) =>
          deps.log.error({ queue: worker.name, err }, 'dead-letter sweep failed'),
        ),
      ),
    );
  let sweeping = sweep();
  const sweeper = setInterval(() => (sweeping = sweep()), SWEEP_MS);

  return {
    workers,
    // Lets running jobs finish, then waits for dead-letter moves. A job cut off by a kill is recovered as stalled.
    async close() {
      clearInterval(sweeper);
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([...moving, sweeping]);
    },
  };
}
