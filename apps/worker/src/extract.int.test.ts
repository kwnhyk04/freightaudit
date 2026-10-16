import { carriers, deadLetters, extractions, invoices, llmCalls, tenants } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { PermanentError } from '@freightaudit/llm';
import { replayDeadLetter, sweepFailedJobs } from '@freightaudit/pipeline';
import { resetDev } from '@freightaudit/pipeline/scripts/reset';
import { resumeExtract } from '@freightaudit/pipeline/scripts/resume-extract';
import { UnrecoverableError, Worker } from 'bullmq';
import { asc, eq } from 'drizzle-orm';
import { createTestEnv, extraction, type FakeCall, fakeModels, makePdf, MODEL_IDS, replyWith, waitFor } from './testing.ts';
import { failFast } from './workers.ts';

let env: Awaited<ReturnType<typeof createTestEnv>> | undefined;
let fake: Awaited<ReturnType<typeof fakeModels>> | undefined;
afterEach(async () => {
  import.meta.jest.useRealTimers();
  await env?.close();
  await fake?.close();
  env = fake = undefined;
});

async function setup(reply: Parameters<typeof fakeModels>[0]) {
  fake = await fakeModels(reply);
  env = await createTestEnv();
  return { env, fake };
}

// Every test page is blank, so it goes to the primary model as an image.
const valid = (call: FakeCall) => replyWith(call.protocol, extraction());
// Error bodies in the shape the Gemini API documents.
const geminiError = (code: number, status: string, details: object[] = []) => ({ status: code, body: { error: { code, message: 'error', status, details } } });
const quota = geminiError(429, 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0s' }]);

const extractionRows = (invoiceId: string) => env!.db.select().from(extractions).where(eq(extractions.invoiceId, invoiceId));
const savedExtraction = async (invoiceId: string) => (await waitFor(async () => (await extractionRows(invoiceId))[0]))!;
const callsOf = (invoiceId: string) => env!.db.select().from(llmCalls).where(eq(llmCalls.invoiceId, invoiceId)).orderBy(asc(llmCalls.createdAt), asc(llmCalls.id));
const steps = async (invoiceId: string) => (await callsOf(invoiceId)).map(({ role, step, outcome }) => `${role} ${step} ${outcome}`);
// After extraction the reconcile job runs; this tenant has no shipments, so it ends at needs_review.
const EXTRACTED = ['extracted', 'reconciling', 'needs_review'];
const statusOf = async (invoiceId: string) =>
  (await env!.db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId)))[0]?.status;
// The state first, then the job: a job read before its last attempt ends would show that attempt as not yet made.
const finished = async (queueName: 'extract', jobId: string) => {
  const queue = env!.queues.queue(queueName);
  return (await queue.getJobState(jobId)) === 'completed' && queue.getJob(jobId);
};

test('a 429 on the primary falls back to the fallback model, and the extraction and its calls record it', async () => {
  const { env } = await setup((call) => (call.model === MODEL_IDS.primary ? quota : valid(call)));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  expect(await savedExtraction(invoice.id)).toMatchObject({ step: 'first_pass', fallbackReason: 'rate_limited', model: 'groq/fake-fallback' });
  expect(await steps(invoice.id)).toEqual(['primary first_pass rate_limited', 'fallback first_pass valid']);
  const [limited, read] = await callsOf(invoice.id);
  expect(limited).toMatchObject({ provider: 'gemini', model: 'fake-primary', inputTokens: 0, outputTokens: 0, costMicroUsd: 0n, waitMs: expect.any(Number) });
  expect(limited).toMatchObject({ errorClass: '429', httpStatus: 429, errorMessage: 'gemini HTTP 429 RESOURCE_EXHAUSTED' });
  expect(read).toMatchObject({ provider: 'groq', model: 'fake-fallback', servedModel: expect.any(String), costMicroUsd: 0n, waitMs: expect.any(Number), errorClass: null });
  expect(read!.inputTokens).toBeGreaterThan(0);
  expect(read!.latencyMs).toBeGreaterThanOrEqual(0);
  // No retry was needed.
  expect((await waitFor(() => finished('extract', invoice.contentSha256))).attemptsMade).toBe(1);
});

test('a scan longer than the fallback takes ends needs_review with fallback_page_cap after a primary 429, never a dead letter', async () => {
  const { env } = await setup((call) => (call.model === MODEL_IDS.primary ? quota : valid(call)));
  env.runWorkers({ modelsUrl: fake!.url });
  // Four blank pages are four page images; the fake fallback is on Groq, which takes three.
  const invoice = await env.upload(await makePdf(4));

  const row = await savedExtraction(invoice.id);
  expect(row).toMatchObject({ step: 'needs_review', fallbackReason: 'rate_limited', model: 'gemini/fake-primary' });
  expect(row.result).toEqual({ problems: ['fallback_page_cap: 4 page images, more than the 3 groq/fake-fallback takes'], output: null });
  expect(await steps(invoice.id)).toEqual(['primary first_pass rate_limited']);
  await waitFor(async () => (await statusOf(invoice.id)) === 'needs_review');
  expect((await waitFor(() => finished('extract', invoice.contentSha256))).attemptsMade).toBe(1);
  expect(fake!.calls()).toBe(1);
  expect(await env.db.select().from(deadLetters)).toEqual([]);
});

test('when the fallback is rate limited too, the job retries with backoff and writes exactly one extraction row', async () => {
  const { env } = await setup((call) => (call.n < 2 ? (call.model === MODEL_IDS.primary ? quota : { status: 429, headers: { 'retry-after': '0' } }) : valid(call)));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  const job = await waitFor(() => finished('extract', invoice.contentSha256));
  // BullMQ counts every finished attempt: the rate-limited one, then the success.
  expect(job.attemptsMade).toBe(2);
  expect(await extractionRows(invoice.id)).toHaveLength(1);
  expect(await steps(invoice.id)).toEqual(['primary first_pass rate_limited', 'fallback first_pass rate_limited', 'primary first_pass valid']);
  expect(EXTRACTED).toContain(await statusOf(invoice.id));

  // The job id is the content hash, so adding the same invoice again is a no-op.
  const again = await env.queues.queue('extract').add('extract', { tenantId: env.tenantId, invoiceId: invoice.id }, { jobId: invoice.contentSha256 });
  expect(await again.getState()).toBe('completed');
  expect(fake!.calls()).toBe(3);
});

test('schema-invalid output gets exactly one repair, then one pass on the fallback, then needs_review', async () => {
  const { env } = await setup((call) => replyWith(call.protocol, JSON.stringify({ invoices: [{ carrier: 'Halcyon Ridge Freight', total_cents: '1,437.50' }] })));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  const row = await savedExtraction(invoice.id);
  expect(row).toMatchObject({ step: 'needs_review', fallbackReason: 'invalid_output', model: 'groq/fake-fallback' });
  const { problems, output } = row.result as { problems: string[]; output: unknown };
  expect(problems).toContain('invoices.0.total_cents: Invalid input: expected number, received string');
  expect(problems.join(' ')).not.toMatch(/Halcyon|1,437/);
  expect(output).toEqual({ invoices: [{ carrier: 'Halcyon Ridge Freight', total_cents: '1,437.50' }] });
  expect(await steps(invoice.id)).toEqual(['primary first_pass invalid', 'primary repair invalid', 'fallback fallback invalid']);
  await waitFor(async () => (await statusOf(invoice.id)) === 'needs_review');
  expect(fake!.calls()).toBe(3);
  // It waits for a reviewer: no reconcile job, no dead letter.
  expect(await env.queues.queue('reconcile').getJob(invoice.contentSha256)).toBeUndefined();
  expect(await env.db.select().from(deadLetters)).toEqual([]);
});

test('an arithmetic failure triggers the repair, whose output is saved', async () => {
  const wrongTotal = JSON.stringify({ invoices: [{ ...JSON.parse(extraction()).invoices[0], total_cents: 99_999 }] });
  const { env } = await setup((call) => replyWith(call.protocol, call.n === 0 ? wrongTotal : extraction()));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  expect(await savedExtraction(invoice.id)).toMatchObject({ step: 'repair', fallbackReason: null, model: 'gemini/fake-primary' });
  expect(await steps(invoice.id)).toEqual(['primary first_pass invalid', 'primary repair valid']);
});

test('the extracted carrier finds its carrier when printed in capitals beside a title line, and the extraction records how', async () => {
  const { env } = await setup((call) => replyWith(call.protocol, extraction().replace('Halcyon Ridge Freight', 'HALCYON RIDGE FREIGHT — Freight Bill')));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  const [carrier] = await env.db.select({ id: carriers.id }).from(carriers).where(eq(carriers.tenantId, env.tenantId));
  const carrierOf = async () => (await env.db.select({ carrierId: invoices.carrierId }).from(invoices).where(eq(invoices.id, invoice.id)))[0]?.carrierId;
  expect(await savedExtraction(invoice.id)).toMatchObject({ carrierMatch: 'contained', result: { carrier: 'HALCYON RIDGE FREIGHT — Freight Bill' } });
  expect(await carrierOf()).toBe(carrier!.id);
});

test('one 401 pauses the extract queue and raises the alert; nothing is dead-lettered, and resuming processes the waiting jobs', async () => {
  let rejected = true;
  const unauthenticated = geminiError(401, 'UNAUTHENTICATED', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }]);
  const { env } = await setup((call) => (rejected ? unauthenticated : valid(call)));
  const alerts: object[] = [];
  env.runWorkers({ modelsUrl: fake!.url, log: { warn: () => {}, error: (obj) => void alerts.push(obj) } });
  const uploads = [await env.upload(await makePdf()), await env.upload(await makePdf()), await env.upload(await makePdf())];
  const queue = env.queues.queue('extract');

  await waitFor(() => queue.isPaused());
  // Each job that met the 401 went back without using an attempt; none runs while the queue is paused.
  await waitFor(async () => (await queue.getJobCounts('active', 'delayed')).active === 0);
  expect(alerts).toContainEqual(expect.objectContaining({ alert: 'extract_paused', reason: 'gemini HTTP 401 UNAUTHENTICATED ACCESS_TOKEN_TYPE_UNSUPPORTED' }));
  for (const upload of uploads) {
    expect(['completed', 'failed']).not.toContain(await queue.getJobState(upload.contentSha256));
    expect((await queue.getJob(upload.contentSha256))?.attemptsMade).toBe(0);
  }
  expect(await env.db.select().from(deadLetters)).toEqual([]);
  expect((await env.queues.dlq('extract').getJobCounts()).wait ?? 0).toBe(0);

  // The setting is fixed; resuming lets every waiting job through.
  rejected = false;
  expect(await resumeExtract({ redisUrl: testEnv('REDIS_URL'), prefix: env.prefix })).toMatchObject({ paused: true });
  for (const upload of uploads) {
    await waitFor(() => finished('extract', upload.contentSha256));
    expect(await extractionRows(upload.id)).toHaveLength(1);
  }
  expect(await queue.isPaused()).toBe(false);
  expect(await env.db.select().from(deadLetters)).toEqual([]);
});

test('a PDF uploaded before pnpm db:reset is extracted again after it', async () => {
  const { env } = await setup(valid);
  env.runWorkers({ modelsUrl: fake!.url });
  const before = await env.upload(await makePdf());
  // Both jobs finished, so the reset meets no running job; both job ids (the PDF's hash) stay taken until it.
  await waitFor(async () => (await env.queues.queue('reconcile').getJobState(before.contentSha256)) === 'completed');

  await resetDev({ databaseUrl: env.databaseUrl, redisUrl: testEnv('REDIS_URL'), prefix: env.prefix, log: () => {} });
  // The same bytes again, as the api would add them, for the tenant the reset seeded.
  const [tenant] = await env.db.select({ id: tenants.id }).from(tenants);
  const [after] = await env.db.insert(invoices).values({ tenantId: tenant!.id, filename: 'invoice.pdf', contentSha256: before.contentSha256 }).returning();
  await env.queues.queue('extract').add('extract', { tenantId: tenant!.id, invoiceId: after!.id }, { jobId: before.contentSha256 });
  await waitFor(async () => (await extractionRows(after!.id)).length > 0);
  expect(fake!.calls()).toBe(2);
});

test('a request the provider rejects lands in extract-dlq and dead_letters, then replays successfully', async () => {
  let poisoned = true;
  const { env } = await setup((call) => (poisoned ? geminiError(400, 'INVALID_ARGUMENT') : valid(call)));
  env.runWorkers({ modelsUrl: fake!.url });
  const invoice = await env.upload(await makePdf());

  // The DLQ copy is written last, so once it exists the move has finished.
  await waitFor(() => env.queues.dlq('extract').getJob(invoice.contentSha256));
  const [dead] = await env.db.select().from(deadLetters).where(eq(deadLetters.jobId, invoice.contentSha256));
  // A 400 is permanent: no retries, no fallback, one attempt.
  expect(dead).toMatchObject({ queue: 'extract', attempts: 1, replayedAt: null, error: 'gemini HTTP 400 INVALID_ARGUMENT' });
  expect(dead!.payload).toEqual({ tenantId: env.tenantId, invoiceId: invoice.id });
  expect(fake!.calls()).toBe(1);
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
  const { env } = await setup(valid);
  await env.redis.hset(`${env.prefix}:llm:day:2026-10-14`, 'tokens', 1_000);
  env.runWorkers({ modelsUrl: fake!.url, limits: { dailyTokenBudget: 1_000 } });
  const invoice = await env.upload(await makePdf());

  await waitFor(async () => (await env.queues.queue('extract').getJobState(invoice.contentSha256)) === 'delayed');
  // Delayed until the UTC day, and with it the budget, rolls over.
  const score = Number(await env.redis.zscore(`${env.prefix}:extract:delayed`, invoice.contentSha256));
  expect(Math.floor(score / 0x1000)).toBe(Date.parse('2026-10-15T00:00:00Z'));
  expect(fake!.calls()).toBe(0);
  expect((await env.queues.queue('extract').getJob(invoice.contentSha256))?.attemptsMade).toBe(0);
  expect(await statusOf(invoice.id)).toBe('received');
});

test('a multi-invoice PDF splits into child jobs, and a part that stays unreadable waits for review', async () => {
  // The whole file holds invoices on pages 1-2 and 3; the one-page part never gets valid output.
  const { env } = await setup((call) => replyWith(call.protocol, call.pages === 3 ? extraction(1, 3) : call.pages === 2 ? extraction() : 'not json'));
  env.runWorkers({ modelsUrl: fake!.url });
  const upload = await env.upload(await makePdf(3));

  const row = await savedExtraction(upload.id);
  await waitFor(async () => (await statusOf(upload.id)) === 'extracted');
  expect(await env.queues.queue('extract').getJobState(`split-${upload.contentSha256}`)).toBe('completed');

  const parts = await env.db.select().from(invoices).where(eq(invoices.parentInvoiceId, upload.id));
  const byName = Object.fromEntries(parts.map((part) => [part.filename, part]));
  expect(Object.keys(byName).sort()).toEqual(['invoice.pdf (pages 1-2)', 'invoice.pdf (pages 3-3)']);
  const good = byName['invoice.pdf (pages 1-2)']!;
  const bad = byName['invoice.pdf (pages 3-3)']!;
  const outcomes = (row.result as { parts: { invoiceId: string; status: string }[] }).parts;
  expect(row.step).toBe('first_pass');
  expect(outcomes.find((outcome) => outcome.invoiceId === bad.id)).toMatchObject({ status: 'needs_review' });
  expect(EXTRACTED).toContain(outcomes.find((outcome) => outcome.invoiceId === good.id)?.status);
  expect(await extractionRows(good.id)).toHaveLength(1);
  expect((await extractionRows(bad.id))[0]).toMatchObject({ step: 'needs_review' });
  expect(await steps(bad.id)).toEqual(['primary first_pass invalid', 'primary repair invalid', 'fallback fallback invalid']);
  expect(await env.db.select().from(deadLetters)).toEqual([]);
});
