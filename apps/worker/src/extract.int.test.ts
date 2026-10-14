import { deadLetters, extractions, invoices, tenants } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { replayDeadLetter, sweepFailedJobs } from '@freightaudit/pipeline';
import { resetDev } from '@freightaudit/pipeline/scripts/reset';
import { UnrecoverableError, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PermanentError } from '@freightaudit/llm';
import { createTestEnv, extraction, fakeGemini, makePdf, waitFor } from './testing.ts';
import { failFast } from './workers.ts';

let env: Awaited<ReturnType<typeof createTestEnv>> | undefined;
let gemini: Awaited<ReturnType<typeof fakeGemini>> | undefined;
afterEach(async () => {
  import.meta.jest.useRealTimers();
  await env?.close();
  await gemini?.close();
  env = gemini = undefined;
});

async function setup(reply: Parameters<typeof fakeGemini>[0]) {
  gemini = await fakeGemini(reply);
  env = await createTestEnv();
  return { env, gemini };
}

const extractionRows = (invoiceId: string) => env!.db.select().from(extractions).where(eq(extractions.invoiceId, invoiceId));
// After extraction the reconcile job runs; this tenant has no shipments, so it ends at needs_review.
const EXTRACTED = ['extracted', 'reconciling', 'needs_review'];
const statusOf = async (invoiceId: string) =>
  (await env!.db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId)))[0]?.status;
// The state first, then the job: a job read before its last attempt ends would show that attempt as not yet made.
const finished = async (queueName: 'extract', jobId: string) => {
  const queue = env!.queues.queue(queueName);
  return (await queue.getJobState(jobId)) === 'completed' && queue.getJob(jobId);
};

test('a 429 from the model is retried with backoff and writes exactly one extraction row', async () => {
  const { env, gemini } = await setup(({ n }) => (n < 2 ? { status: 429, headers: { 'retry-after': '0' } } : { status: 200, text: extraction() }));
  env.runWorkers({ geminiUrl: gemini.url });
  const invoice = await env.upload(await makePdf());

  const job = await waitFor(() => finished('extract', invoice.contentSha256));
  // BullMQ counts every finished attempt: two 429s, then the success.
  expect(job.attemptsMade).toBe(3);
  expect(gemini.calls()).toBe(3);
  expect(await extractionRows(invoice.id)).toHaveLength(1);
  expect(EXTRACTED).toContain(await statusOf(invoice.id));

  // The job id is the content hash, so adding the same invoice again is a no-op.
  const again = await env.queues.queue('extract').add('extract', { tenantId: env.tenantId, invoiceId: invoice.id }, { jobId: invoice.contentSha256 });
  expect(await again.getState()).toBe('completed');
  expect(gemini.calls()).toBe(3);
});

test('a PDF uploaded before pnpm db:reset is extracted again after it', async () => {
  const { env, gemini } = await setup(() => ({ status: 200, text: extraction() }));
  env.runWorkers({ geminiUrl: gemini.url });
  const before = await env.upload(await makePdf());
  // Both jobs finished, so the reset meets no running job; both job ids (the PDF's hash) stay taken until it.
  await waitFor(async () => (await env.queues.queue('reconcile').getJobState(before.contentSha256)) === 'completed');

  await resetDev({ databaseUrl: env.databaseUrl, redisUrl: testEnv('REDIS_URL'), prefix: env.prefix, log: () => {} });
  // The same bytes again, as the api would add them, for the tenant the reset seeded.
  const [tenant] = await env.db.select({ id: tenants.id }).from(tenants);
  const [after] = await env.db.insert(invoices).values({ tenantId: tenant!.id, filename: 'invoice.pdf', contentSha256: before.contentSha256 }).returning();
  await env.queues.queue('extract').add('extract', { tenantId: tenant!.id, invoiceId: after!.id }, { jobId: before.contentSha256 });
  await waitFor(async () => (await extractionRows(after!.id)).length > 0);
  expect(gemini.calls()).toBe(2);
});

test('a poisoned job lands in extract-dlq and dead_letters, then replays successfully', async () => {
  let poisoned = true;
  const { env, gemini } = await setup(() => ({ status: 200, text: poisoned ? 'not json' : extraction() }));
  env.runWorkers({ geminiUrl: gemini.url });
  const invoice = await env.upload(await makePdf());

  // The DLQ copy is written last, so once it exists the move has finished.
  await waitFor(() => env.queues.dlq('extract').getJob(invoice.contentSha256));
  const [dead] = await env.db.select().from(deadLetters).where(eq(deadLetters.jobId, invoice.contentSha256));
  // Invalid output after one repair is permanent: no retries, one attempt.
  expect(dead).toMatchObject({ queue: 'extract', attempts: 1, replayedAt: null, payload: { tenantId: env.tenantId, invoiceId: invoice.id } });
  expect(dead!.error).toMatch(/^schema invalid after repair/);
  expect(gemini.calls()).toBe(2);
  expect((await env.queues.dlq('extract').getJob(invoice.contentSha256))?.data).toEqual({ tenantId: env.tenantId, invoiceId: invoice.id });
  expect(await env.queues.queue('extract').getJobState(invoice.contentSha256)).toBe('failed');
  expect(await statusOf(invoice.id)).toBe('failed');

  poisoned = false;
  expect(await replayDeadLetter(env, env.tenantId, dead!.id)).toEqual({ id: dead!.id, jobId: invoice.contentSha256 });
  await waitFor(() => finished('extract', invoice.contentSha256));
  expect(await extractionRows(invoice.id)).toHaveLength(1);
  expect(EXTRACTED).toContain(await statusOf(invoice.id));
  const [replayed] = await env.db.select().from(deadLetters).where(eq(deadLetters.id, dead!.id));
  expect(replayed?.replayedAt).toBeInstanceOf(Date);
  expect(await env.queues.dlq('extract').getJob(invoice.contentSha256)).toBeUndefined();
  // A dead letter replays once.
  expect(await replayDeadLetter(env, env.tenantId, dead!.id)).toBeUndefined();
});

test('a failed query keeps only its driver code, never the bound values that may hold line items', async () => {
  const query = Object.assign(new Error('Failed query: insert into extractions\nparams: Halcyon Ridge Freight,143750'), {
    query: 'insert into extractions',
    params: ['Halcyon Ridge Freight', 143_750],
    cause: { code: '57P01' },
  });
  await expect(failFast(() => Promise.reject(query))).rejects.toThrow(/^database query failed: 57P01$/);
  await expect(failFast(() => Promise.reject(new PermanentError('bad PDF')))).rejects.toMatchObject({ name: 'UnrecoverableError' });
});

test('the sweep moves a failed job whose dead-letter move never ran, once', async () => {
  const current = (env = await createTestEnv());
  const invoice = await current.upload(await makePdf());
  // A bare worker without the failed handler stands in for one that died before the move.
  const bare = new Worker('extract', async () => Promise.reject(new UnrecoverableError('provider rejected the request')), {
    connection: current.redis,
    prefix: current.prefix,
  });
  await waitFor(async () => (await current.queues.queue('extract').getJobState(invoice.contentSha256)) === 'failed');
  await bare.close();

  expect(await sweepFailedJobs(current, 'extract')).toBe(1);
  expect(await sweepFailedJobs(current, 'extract')).toBe(0);
  const rows = await current.db.select().from(deadLetters).where(eq(deadLetters.jobId, invoice.contentSha256));
  expect(rows.map((row) => row.error)).toEqual(['provider rejected the request']);
  expect(await current.queues.dlq('extract').getJob(invoice.contentSha256)).toBeDefined();
});

test('the budget guard delays extract jobs without calling the model once the daily cap is reached', async () => {
  // Noon UTC on a fixed day, moving in real time, so the day cannot roll over mid-test. Only Date is fake: timers run
  // as usual, and Redis and Postgres keep their own clocks.
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] as const;
  import.meta.jest.useFakeTimers({
    now: Date.parse('2026-10-14T12:00:00Z'),
    advanceTimers: true,
    doNotFake: [...timers, 'hrtime', 'nextTick', 'performance', 'queueMicrotask'],
  });
  const { env, gemini } = await setup(() => ({ status: 200, text: extraction() }));
  await env.redis.hset(`${env.prefix}:llm:day:2026-10-14`, 'tokens', 1_000);
  env.runWorkers({ geminiUrl: gemini.url, limits: { dailyTokenBudget: 1_000 } });
  const invoice = await env.upload(await makePdf());

  await waitFor(async () => (await env.queues.queue('extract').getJobState(invoice.contentSha256)) === 'delayed');
  // Delayed until the UTC day, and with it the budget, rolls over.
  const score = Number(await env.redis.zscore(`${env.prefix}:extract:delayed`, invoice.contentSha256));
  expect(Math.floor(score / 0x1000)).toBe(Date.parse('2026-10-15T00:00:00Z'));
  expect(gemini.calls()).toBe(0);
  expect((await env.queues.queue('extract').getJob(invoice.contentSha256))?.attemptsMade).toBe(0);
  expect(await statusOf(invoice.id)).toBe('received');
});

test('a multi-invoice PDF splits into child jobs, and a failed child does not fail the parent', async () => {
  // The whole file holds invoices on pages 1-2 and 3; the one-page part keeps failing validation.
  const { env, gemini } = await setup(({ pages }) => ({
    status: 200,
    text: pages === 3 ? extraction(1, 3) : pages === 2 ? extraction() : 'not json',
  }));
  env.runWorkers({ geminiUrl: gemini.url });
  const upload = await env.upload(await makePdf(3));

  const [row] = await waitFor(async () => {
    const rows = await extractionRows(upload.id);
    return rows.length > 0 && rows;
  });
  expect(await statusOf(upload.id)).toBe('extracted');
  expect(await env.queues.queue('extract').getJobState(`split-${upload.contentSha256}`)).toBe('completed');

  const parts = await env.db.select().from(invoices).where(eq(invoices.parentInvoiceId, upload.id));
  const byName = Object.fromEntries(parts.map((part) => [part.filename, part]));
  expect(Object.keys(byName).sort()).toEqual(['invoice.pdf (pages 1-2)', 'invoice.pdf (pages 3-3)']);
  const good = byName['invoice.pdf (pages 1-2)']!;
  const bad = byName['invoice.pdf (pages 3-3)']!;
  const outcomes = (row!.result as { parts: { invoiceId: string; status: string; error?: string }[] }).parts;
  expect(outcomes).toHaveLength(2);
  expect(outcomes.find((outcome) => outcome.invoiceId === bad.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/schema invalid/) });
  expect(EXTRACTED).toContain(outcomes.find((outcome) => outcome.invoiceId === good.id)?.status);
  expect(await extractionRows(good.id)).toHaveLength(1);

  // The failed part was dead-lettered on its own.
  await waitFor(async () => (await env.db.select().from(deadLetters).where(eq(deadLetters.jobId, bad.contentSha256))).length === 1);
  expect(await statusOf(bad.id)).toBe('failed');
});
