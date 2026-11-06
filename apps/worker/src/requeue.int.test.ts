import { createPool, deadLetters, extractions, invoices, llmCalls } from '@freightaudit/db';
import { seed } from '@freightaudit/db/scripts/seed';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createStorage, type Storage } from '@freightaudit/pipeline';
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { extractionPlan, requeueStranded, tokensPerRead } from './requeue.ts';
import { createTestEnv, extraction, fakeModels, makePdf, replyWith, sha256, waitFor } from './testing.ts';

let env: Awaited<ReturnType<typeof createTestEnv>>;
let fake: Awaited<ReturnType<typeof fakeModels>>;
beforeEach(async () => {
  fake = await fakeModels((call) => replyWith(call.protocol, extraction()));
  env = await createTestEnv();
});
afterEach(async () => {
  await env.close();
  await fake.close();
});

type Status = 'received' | 'extracting' | 'extracted' | 'reconciling' | 'reconciled';
const read = JSON.parse(extraction()).invoices[0] as object;
// A row left at this status: its PDF stored, the extraction a later status holds, and no job anywhere.
async function stranded(status: Status, { storage = env.storage, parentInvoiceId, model = 'groq/fake-text', result = read }: { storage?: Storage; parentInvoiceId?: string; model?: string; result?: object } = {}) {
  const pdf = await makePdf();
  const contentSha256 = sha256(pdf);
  await storage.put(contentSha256, pdf);
  const [invoice] = await env.db.insert(invoices).values({ tenantId: env.tenantId, filename: 'stranded.pdf', contentSha256, status, parentInvoiceId }).returning();
  if (status === 'extracted' || status === 'reconciling') {
    await env.db.insert(extractions).values({ tenantId: env.tenantId, invoiceId: invoice!.id, model, inputTokens: 1, outputTokens: 1, result, step: 'first_pass' });
  }
  return invoice!;
}
const data = ({ id }: { id: string }) => ({ tenantId: env.tenantId, invoiceId: id });
const statusOf = async (id: string) => (await env.db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id)))[0]?.status;
// This tenant has no shipments, so a reconcile ends at needs_review.
const settled = (rows: { id: string }[]) => waitFor(async () => (await Promise.all(rows.map(({ id }) => statusOf(id)))).every((status) => status === 'reconciled' || status === 'needs_review'));
const outcomes = (swept: { outcome: string }[]) => swept.map(({ outcome }) => outcome);
const outcomeOf = (swept: { id: string; outcome: string }[], { id }: { id: string }) => swept.find((row) => row.id === id)?.outcome;
const sweep = () => requeueStranded(env, { minAgeMs: 0 });

// Takes a queue's next job as a worker would, and finishes it, or fails it for good, so that it keeps holding its id.
async function finish(queue: 'extract' | 'reconcile', how: 'completed' | 'failed') {
  const worker = new Worker(queue, undefined, { connection: env.redis, prefix: env.prefix });
  const job = await worker.getNextJob('token');
  await (how === 'completed' ? job!.moveToCompleted('done', 'token', false) : job!.moveToFailed(new Error('boom'), 'token', false));
  await worker.close();
}

test('each invoice that lost its job goes back to the step it stopped at, under its content hash, and finishes', async () => {
  const rows = await Promise.all((['received', 'extracting', 'extracted', 'reconciling'] as const).map((status) => stranded(status)));
  const swept = await sweep();
  expect(Object.fromEntries(swept.map(({ status, outcome }) => [status, outcome]))).toEqual({ received: 'extract', extracting: 'extract', extracted: 'reconcile', reconciling: 'reconcile' });
  for (const row of rows) {
    const queue = env.queues.queue(row.status === 'received' || row.status === 'extracting' ? 'extract' : 'reconcile');
    expect(await queue.getJob(row.contentSha256)).toMatchObject({ name: queue.name, data: data(row) });
  }

  env.runWorkers({ modelsUrl: fake.url });
  await settled(rows);
  // Only the two that had no reading are read.
  expect(fake.calls()).toBe(2);
});

test('an invoice whose job is waiting or delayed is left as it is', async () => {
  const [waiting, delayed] = [await stranded('received'), await stranded('extracted')];
  await env.queues.queue('extract').add('extract', data(waiting), { jobId: waiting.contentSha256 });
  await env.queues.queue('reconcile').add('reconcile', data(delayed), { jobId: delayed.contentSha256, delay: 3_600_000 });
  const before = await env.queues.queue('reconcile').getJob(delayed.contentSha256);

  expect(outcomes(await sweep())).toEqual(['queued', 'queued']);
  const after = await env.queues.queue('reconcile').getJob(delayed.contentSha256);
  expect([await after!.getState(), after!.timestamp, after!.delay]).toEqual(['delayed', before!.timestamp, 3_600_000]);
  expect(await env.queues.queue('extract').getJobCounts('waiting')).toEqual({ waiting: 1 });
});

test('run twice, the second run adds nothing, and each invoice is read once', async () => {
  const rows = [await stranded('received'), await stranded('extracting'), await stranded('extracted')];
  expect(outcomes(await sweep())).toEqual(['extract', 'extract', 'reconcile']);
  expect(outcomes(await sweep())).toEqual(['queued', 'queued', 'queued']);
  expect(await env.queues.queue('extract').getJobCounts('waiting')).toEqual({ waiting: 2 });
  expect(await env.queues.queue('reconcile').getJobCounts('waiting')).toEqual({ waiting: 1 });

  env.runWorkers({ modelsUrl: fake.url });
  await settled(rows);
  expect(fake.calls()).toBe(2);
  // Done, so a run after the work finds nothing, and adds nothing to read again.
  expect(await sweep()).toEqual([]);
  expect(fake.calls()).toBe(2);
});

test('an invoice younger than the set age is left out', async () => {
  await stranded('received');
  expect(await requeueStranded(env, { minAgeMs: 3_600_000 })).toEqual([]);
  expect(await env.queues.queue('extract').count()).toBe(0);
});

test('a finished job still holding the id, as after a database restore, gives way to a new one: adding over it does nothing', async () => {
  const row = await stranded('extracted');
  const queue = env.queues.queue('reconcile');
  await queue.add('reconcile', data(row), { jobId: row.contentSha256 });
  await finish('reconcile', 'completed');
  expect(await queue.getJobState(row.contentSha256)).toBe('completed');

  expect(outcomes(await sweep())).toEqual(['reconcile']);
  expect(await queue.getJobState(row.contentSha256)).toBe('waiting');
});

test('an open dead letter or a failed job waits for a person, and a replayed letter no longer holds the invoice', async () => {
  const [lettered, failed] = [await stranded('received'), await stranded('received')];
  const [letter] = await env.db.insert(deadLetters).values({ tenantId: env.tenantId, queue: 'extract', jobId: lettered.contentSha256, payload: {}, error: 'boom', attempts: 8 }).returning();
  await env.queues.queue('extract').add('extract', data(failed), { jobId: failed.contentSha256, attempts: 1 });
  await finish('extract', 'failed');
  expect(await env.queues.queue('extract').getJobState(failed.contentSha256)).toBe('failed');

  expect(outcomes(await sweep())).toEqual(['held', 'held']);
  await env.db.update(deadLetters).set({ replayedAt: new Date() }).where(eq(deadLetters.id, letter!.id));
  expect(outcomeOf(await sweep(), lettered)).toBe('extract');
});

test('a read with no stored PDF could only fail, so it stays out, while a reconcile needs none', async () => {
  const lost: Storage = { put: async () => {}, get: async () => undefined, has: async () => false };
  const [unread, read] = [await stranded('received', { storage: lost }), await stranded('extracted', { storage: lost })];
  const swept = await sweep();
  expect([outcomeOf(swept, unread), outcomeOf(swept, read)]).toEqual(['no_pdf', 'reconcile']);
  expect(await statusOf(unread.id)).toBe('received');
  expect(await env.queues.queue('extract').count()).toBe(0);
});

test("the seed's 61 in-flight rows are left alone: 27 have no PDF, and 34 were read by the seed, so no job was ever lost", async () => {
  const database = await createTestDatabase();
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  await seed(client, 'small', { log: () => {} });
  await client.end();
  const pool = new pg.Pool({ connectionString: database.url });
  try {
    const swept = await requeueStranded({ db: drizzle(pool), queues: env.queues, storage: env.storage }, { minAgeMs: 0 });
    const tally: Record<string, number> = {};
    for (const { status, outcome } of swept) tally[`${status} ${outcome}`] = (tally[`${status} ${outcome}`] ?? 0) + 1;
    expect(tally).toEqual({ 'received no_pdf': 19, 'extracting no_pdf': 8, 'extracted seeded': 21, 'reconciling seeded': 13 });
    expect(await env.queues.queue('extract').count()).toBe(0);
    expect(await env.queues.queue('reconcile').count()).toBe(0);
    // The query docs/deploy.md gives for telling these rows apart on the demo, which needs no new image.
    const { rows } = await pool.query<{ rows: number; seeded: number }>(`
      SELECT count(*)::int AS rows,
        count(*) FILTER (WHERE content_sha256 IN (SELECT encode(sha256(('seed-invoice-' || n)::bytea), 'hex') FROM generate_series(0, 499) AS n))::int AS seeded
      FROM invoices WHERE status IN ('received', 'extracting', 'extracted', 'reconciling') GROUP BY status`);
    expect(rows.map((row) => row.rows - row.seeded)).toEqual([0, 0, 0, 0]);
    expect(rows.reduce((sum, row) => sum + row.seeded, 0)).toBe(61);
  } finally {
    await pool.end();
    await database.drop();
  }
});

test('a split upload that collected its parts is finished, so extracted is where it stays', async () => {
  await stranded('extracted', { result: { parts: [] } });
  expect(outcomes(await sweep())).toEqual(['split_done']);
  expect(await env.queues.queue('reconcile').count()).toBe(0);
});

test("a split upload's collect job is its job, so the upload is left alone while its parts run", async () => {
  const upload = await stranded('extracting');
  await env.queues.flows.add({
    name: 'collect',
    queueName: 'extract',
    data: data(upload),
    opts: { jobId: `split-${upload.contentSha256}` },
    children: [{ name: 'extract', queueName: 'extract', data: { tenantId: env.tenantId, invoiceId: 'part' }, opts: { jobId: 'part' } }],
  });
  expect(outcomes(await sweep())).toEqual(['queued']);
});

test('a split upload that lost its collect job waits for its parts, then is collected without a second read, which could draw other parts', async () => {
  const upload = await stranded('extracting');
  await env.db.insert(llmCalls).values({ tenantId: env.tenantId, invoiceId: upload.id, role: 'primary', step: 'first_pass', provider: 'gemini', model: 'fake-primary', outcome: 'valid', inputTokens: 900, outputTokens: 100, latencyMs: 1, costMicroUsd: 0n });
  const [waiting, done] = [await stranded('received', { parentInvoiceId: upload.id }), await stranded('reconciled', { parentInvoiceId: upload.id })];

  const first = await sweep();
  expect([outcomeOf(first, upload), outcomeOf(first, waiting)]).toEqual(['parts_pending', 'extract']);
  env.runWorkers({ modelsUrl: fake.url });
  await settled([waiting]);

  expect(outcomeOf(await sweep(), upload)).toBe('collect');
  await waitFor(async () => (await statusOf(upload.id)) === 'extracted');
  const [row] = await env.db.select().from(extractions).where(eq(extractions.invoiceId, upload.id));
  expect(row).toMatchObject({ model: 'gemini/fake-primary', inputTokens: 900, outputTokens: 100, step: 'first_pass' });
  expect((row!.result as { parts: { invoiceId: string; status: string }[] }).parts.map(({ invoiceId, status }) => [invoiceId, status]).sort()).toEqual(
    [[waiting.id, 'needs_review'], [done.id, 'reconciled']].sort(),
  );
  expect(fake.calls()).toBe(1);
  expect(outcomeOf(await sweep(), upload)).toBe('split_done');
});

test('a dry run reports what a run would do and changes nothing', async () => {
  const row = await stranded('extracted');
  await stranded('received');
  await env.queues.queue('reconcile').add('reconcile', data(row), { jobId: row.contentSha256 });
  await finish('reconcile', 'completed');
  const keys = async () => (await env.redis.keys(`${env.prefix}:*`)).sort();
  const before = await keys();

  expect(outcomes(await requeueStranded(env, { minAgeMs: 0, dryRun: true }))).toEqual(['reconcile', 'extract']);
  expect(await keys()).toEqual(before);
  expect(await env.queues.queue('reconcile').getJobState(row.contentSha256)).toBe('completed');
  expect(await env.queues.queue('extract').count()).toBe(0);
});

test('the pool a dry run reads through refuses every write', async () => {
  const pool = createPool(env.databaseUrl, () => {}, { readOnly: true });
  try {
    expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
    await expect(pool.query("UPDATE invoices SET filename = 'changed'")).rejects.toMatchObject({ code: '25006' });
  } finally {
    await pool.end();
  }
});

test("reads fill Claude's day first, then the free models', and the rest wait for the next UTC day", () => {
  expect(extractionPlan(27, 3_300, { claude: 70_000, free: 100_000 })).toEqual({ tokens: 89_100, claude: 21, free: 6, nextDay: 0 });
  expect(extractionPlan(10, 3_300, { claude: 70_000, free: 100_000 })).toEqual({ tokens: 33_000, claude: 10, free: 0, nextDay: 0 });
  expect(extractionPlan(27, 3_300, { claude: 0, free: 10_000 })).toEqual({ tokens: 89_100, claude: 0, free: 3, nextDay: 24 });
});

test("a read is priced from the tokens this deployment's invoices took, Claude's alone while Claude reads, else the eval's average", async () => {
  expect(await tokensPerRead(env.db)).toEqual({ tokens: 3_300, invoices: 0 });
  const [one, two] = [await stranded('reconciled'), await stranded('reconciled')];
  const call = { tenantId: env.tenantId, role: 'text', step: 'first_pass', model: 'm', outcome: 'valid', latencyMs: 1, costMicroUsd: 0n };
  await env.db.insert(llmCalls).values([
    { ...call, invoiceId: one.id, provider: 'anthropic', inputTokens: 2_000, outputTokens: 400 },
    // A repair is part of the read.
    { ...call, invoiceId: one.id, provider: 'anthropic', step: 'repair', inputTokens: 1_000, outputTokens: 200 },
    { ...call, invoiceId: two.id, provider: 'anthropic', inputTokens: 1_500, outputTokens: 300 },
    { ...call, invoiceId: two.id, provider: 'groq', inputTokens: 9_000, outputTokens: 900 },
  ]);
  expect(await tokensPerRead(env.db, 'anthropic')).toEqual({ tokens: 2_700, invoices: 2 });
  expect(await tokensPerRead(env.db)).toEqual({ tokens: 7_650, invoices: 2 });
});

test('on a schedule, the worker clears a stray by itself', async () => {
  const row = await stranded('received');
  env.runWorkers({ modelsUrl: fake.url, requeue: { everyMs: 50, minAgeMs: 0 } });
  await settled([row]);
  expect(fake.calls()).toBe(1);
});

// pnpm requeue for real: src/requeue-cli.ts in a plain Node process, outside the Jest realm, with MinIO for the PDFs.
const cli = fileURLToPath(new URL('requeue-cli.ts', import.meta.url));
const bucket = 'freightaudit-test';
async function run(args: string[], settings: Record<string, string>) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], {
    env: { ...process.env, DATABASE_URL: env.databaseUrl, S3_BUCKET: bucket, REQUEUE_MIN_AGE_MINUTES: '0', DAILY_CLAUDE_TOKEN_BUDGET: '70000', DAILY_AI_TOKEN_BUDGET: '100000', ...settings },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let [stdout, stderr] = ['', ''];
  child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}
const minio = () => createStorage({ endpoint: testEnv('S3_ENDPOINT'), accessKey: testEnv('S3_ACCESS_KEY'), secretKey: testEnv('S3_SECRET_KEY'), bucket });

test('pnpm requeue --dry-run lists what it would re-queue by status, with its tokens and who reads them, and leaves Redis untouched; the real run then does it, once', async () => {
  const storage = minio();
  const rows = [await stranded('received', { storage }), await stranded('received', { storage }), await stranded('extracted', { storage })];
  await env.db.insert(llmCalls).values({ tenantId: env.tenantId, invoiceId: rows[2]!.id, role: 'text', step: 'first_pass', provider: 'anthropic', model: 'm', outcome: 'valid', inputTokens: 2_500, outputTokens: 500, latencyMs: 1, costMicroUsd: 0n });
  await env.db.insert(invoices).values({ tenantId: env.tenantId, filename: 'gone.pdf', contentSha256: '0'.repeat(64) });
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  const claude = { REDIS_PREFIX: prefix, LLM_CLAUDE_FIRST_UNTIL: '2099-12-31' };

  const dry = await run(['--dry-run'], claude);
  expect([dry.code, dry.stderr]).toEqual([0, '']);
  expect(dry.stdout).toContain('Dry run: nothing changed.');
  expect(dry.stdout).toContain('Would re-queue 3: received 2, extracted 1.');
  expect(dry.stdout).toContain(`  ${rows[0]!.id} received since `);
  expect(dry.stdout).toContain('Left alone, no stored PDF, so a read could only fail them (the seed writes such rows): 1 (received 1).');
  expect(dry.stdout).toContain('Extraction: 2 reads, about 6,000 tokens at 3,000 a read, measured on 1 invoice.');
  expect(dry.stdout).toContain("Today's budgets leave 70,000 Claude tokens and 100,000 for the free models: about 2 read with Claude, 0 with the free models, 0 wait for 00:00 UTC.");
  expect(await env.redis.keys(`${prefix}:*`)).toEqual([]);

  const real = await run([], claude);
  expect([real.code, real.stderr]).toEqual([0, '']);
  expect(real.stdout).toContain('Re-queued 3: received 2, extracted 1.');
  expect(real.stdout).not.toContain('Dry run');
  const again = await run([], claude);
  expect(again.stdout).toContain('Re-queued 0.');
  expect(again.stdout).toContain('Left alone, a job is waiting or running: 3 (received 2, extracted 1).');
  await env.redis.del(...(await env.redis.keys(`${prefix}:*`)));
});

test('past its end date Claude reads none, and a mistyped flag stops before anything runs', async () => {
  const row = await stranded('received', { storage: minio() });
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  const ended = await run(['--dry-run'], { REDIS_PREFIX: prefix, LLM_CLAUDE_FIRST_UNTIL: '2026-01-01' });
  expect(ended.stdout).toContain("Today's budgets leave 0 Claude tokens and 100,000 for the free models: about 0 read with Claude, 1 with the free models, 0 wait for 00:00 UTC.");

  const typo = await run(['--dryrun'], { REDIS_PREFIX: prefix });
  expect(typo.code).not.toBe(0);
  expect(typo.stderr).toContain('--dryrun');
  expect(await env.redis.keys(`${prefix}:*`)).toEqual([]);
  expect(await statusOf(row.id)).toBe('received');
});
