// The extraction eval: runs eval cases through the real worker (extract, repair, fallback, reconcile) against the small
// seed in throwaway Postgres and Redis, with one pinned model per role from the environment. The provider 429 fallback
// is off, so a 429 waits and retries; each case's result is cached, so a quota stop resumes later instead of starting
// over. Usage: pnpm eval --suite extraction --subset ci|dev|full|compare [--fresh] [--set-floors] [--concurrency 4]
import { LLM_SETTINGS, llmRoles, type LlmRole, settings } from '@freightaudit/config/env';
import { deadLetters, discrepancies, extractions, invoiceLines, invoices, llmCalls, tenants } from '@freightaudit/db';
import { migrate } from '@freightaudit/db/migrate';
import { seed } from '@freightaudit/db/scripts/seed';
import { createLimits, createModels, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, hasPrice, paidCost } from '@freightaudit/llm';
import { createMemoryStorage, createQueues, type Queues, type Storage } from '@freightaudit/pipeline';
import { startWorkers } from '@freightaudit/worker/workers';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { z } from 'zod';
import type { GoldenCase, Manifest } from '../golden/build.ts';
import type { CaseResult, PredictedInvoice, Read } from './metrics.ts';
import { report } from './report.ts';

export type Roles = Record<'primary' | 'text' | 'fallback', LlmRole>;
export type Subset = 'dev' | 'ci' | 'full' | 'compare';
export type Run = {
  label: string;
  roles: Roles;
  cases: GoldenCase[];
  results: Map<string, CaseResult>;
  stopped: string | undefined;
  computed: number;
  key: string;
  promptHash: string;
};

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
// Cached results are only reused for the same prompt and schema.
export const PROMPT_HASH = sha256(EXTRACTION_PROMPT + JSON.stringify(EXTRACTION_JSON_SCHEMA)).slice(0, 12);
export const pinsOf = (roles: Roles) => Object.fromEntries(Object.entries(roles).map(([role, { provider, model }]) => [role, `${provider}/${model}`]));
const llmSettings = z.object(Object.fromEntries(LLM_SETTINGS.map((key) => [key, settings[key]])) as Pick<typeof settings, (typeof LLM_SETTINGS)[number]>);
// The roles as the worker resolves them from the environment, with what keeps them from running.
export const configuredRoles = (source: Record<string, string | undefined> = process.env) => llmRoles(llmSettings.parse(source));

// Ports bound to 127.0.0.1 only, labelled with this run's pid, so a test run removes them if this process dies.
class LocalContainer extends GenericContainer {
  withLocalPorts(...ports: number[]) {
    this.withExposedPorts(...ports);
    const bindings = (this.hostConfig.PortBindings ??= {});
    for (const port of ports) bindings[`${port}/tcp`] = [{ HostIp: '127.0.0.1', HostPort: '0' }];
    return this.withLabels({ 'freightaudit.test-run': String(process.pid) });
  }
}

export type Environment = { db: NodePgDatabase; queues: Queues; storage: Storage; tenantId: string; alerts: object[]; close(): Promise<void> };

// The small seed in Postgres, Redis for queues and limits, and the worker in this process with the given roles. Without
// URLs it starts its own containers from the images the compose file pins.
export async function startEnvironment(roles: Roles, urls: { databaseUrl?: string; redisUrl?: string } = {}): Promise<Environment> {
  const containers: StartedTestContainer[] = [];
  let { databaseUrl, redisUrl } = urls;
  if (!databaseUrl || !redisUrl) {
    process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
    const [postgres, redis] = await Promise.all([
      new LocalContainer('postgres:18.6-alpine')
        .withLocalPorts(5432)
        .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
        .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
        .withTmpFs({ '/var/lib/postgresql': 'rw' })
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start(),
      new LocalContainer('redis:8.10.2-alpine').withLocalPorts(6379).withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start(),
    ]);
    containers.push(postgres, redis);
    databaseUrl = `postgres://test:test@127.0.0.1:${postgres.getMappedPort(5432)}/test`;
    redisUrl = `redis://127.0.0.1:${redis.getMappedPort(6379)}`;
  }
  await migrate(databaseUrl, { log: () => {} });
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await seed(client, 'small', { log: () => {} });
  } finally {
    await client.end();
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const prefix = `eval-${process.pid}`;
  const queues = createQueues(redis, prefix);
  const limits = createLimits(redis, { prefix, enabled: true, dailyTokenBudget: Number.MAX_SAFE_INTEGER, roles });
  const storage = createMemoryStorage();
  // A provider that rejects its key or model pauses the extract queue; the run stops instead of waiting on it.
  const alerts: object[] = [];
  const workers = startWorkers(
    {
      db,
      redis,
      queues,
      storage,
      limits,
      models: createModels(roles, limits),
      textMinChars: settings.LLM_TEXT_MIN_CHARS.parse(process.env.LLM_TEXT_MIN_CHARS),
      tmsUrl: 'http://127.0.0.1:9',
      log: { warn: () => {}, error: (obj) => void alerts.push(obj) },
      fallbackOnRateLimit: false,
    },
    { lockDuration: 300_000 },
  );
  const [tenant] = await db.select({ id: tenants.id }).from(tenants);
  return {
    db,
    queues,
    storage,
    tenantId: tenant!.id,
    alerts,
    async close() {
      await workers.close();
      await queues.close();
      await redis.quit();
      await pool.end();
      await Promise.all(containers.map((container) => container.stop()));
    },
  };
}

const TERMINAL = new Set(['reconciled', 'needs_review', 'failed', 'approved']);
// The first invoice of a model output, as a needs_review extraction keeps it.
const firstInvoice = (output: unknown) => ((output as { invoices?: Read[] } | null)?.invoices?.[0] ?? null);

// Uploads one case as the api would, waits until it and any parts it split into are final, and reads back what the
// pipeline stored: each invoice's status, extraction and findings, and every model call.
export async function runCase(env: Environment, root: URL, golden: GoldenCase): Promise<CaseResult> {
  const pdf = await readFile(new URL(golden.file, root));
  const contentSha256 = sha256(pdf);
  await env.storage.put(contentSha256, pdf);
  const [upload] = await env.db.insert(invoices).values({ tenantId: env.tenantId, filename: `${golden.id}.pdf`, contentSha256 }).returning({ id: invoices.id });
  const uploadId = upload!.id;
  const started = performance.now();
  await env.queues.queue('extract').add('extract', { tenantId: env.tenantId, invoiceId: uploadId }, { jobId: contentSha256 });
  const deadline = Date.now() + 30 * 60_000;
  const read = () =>
    env.db
      .select({ id: invoices.id, status: invoices.status, filename: invoices.filename, parent: invoices.parentInvoiceId, hash: invoices.contentSha256 })
      .from(invoices)
      .where(or(eq(invoices.id, uploadId), eq(invoices.parentInvoiceId, uploadId)));
  let rows = await read();
  for (;;) {
    const parts = rows.filter((row) => row.parent === uploadId);
    const own = rows.find((row) => row.id === uploadId)!;
    const done = parts.length === 0 ? TERMINAL.has(own.status) : (own.status === 'extracted' || own.status === 'failed') && parts.every((part) => TERMINAL.has(part.status));
    if (done) break;
    if (env.alerts.length > 0) throw new Error(`the worker paused extraction: ${JSON.stringify(env.alerts[0])}`);
    // A 429 whose wait outlasts 10 minutes (a spent daily quota) stops the run here, to resume after the reset.
    const job = await env.queues.queue('extract').getJob(contentSha256);
    if (job && (await job.isDelayed()) && job.delay > 600_000 && /HTTP 429/.test(job.failedReason ?? '')) {
      return { id: golden.id, status: 'stopped', error: `${job.failedReason}, retry in ${Math.round(job.delay / 1000)} s`, e2eMs: 0, invoices: [], calls: [] };
    }
    if (Date.now() > deadline) throw new Error(`${golden.id} did not finish in 30 minutes`);
    await setTimeout(250);
    rows = await read();
  }
  const e2eMs = Math.round(performance.now() - started);

  const parts = rows.filter((row) => row.parent === uploadId).sort((a, b) => a.filename.localeCompare(b.filename, 'en', { numeric: true }));
  const predicted = parts.length > 0 ? parts : rows.filter((row) => row.id === uploadId);
  const out: PredictedInvoice[] = [];
  for (const row of predicted) {
    const [extraction] = await env.db
      .select({ step: extractions.step, reviewReason: extractions.reviewReason, result: extractions.result })
      .from(extractions)
      .where(eq(extractions.invoiceId, row.id));
    const result = extraction?.result as (Read & { output?: unknown }) | undefined;
    const findings = await env.db
      .select({ line: invoiceLines.lineNumber, type: discrepancies.type, expected: discrepancies.expectedCents, billed: discrepancies.billedCents })
      .from(discrepancies)
      .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
      .where(eq(discrepancies.invoiceId, row.id));
    out.push({
      status: row.status,
      step: extraction?.step ?? null,
      reviewReason: extraction?.reviewReason ?? null,
      read: !result ? null : extraction?.step === 'needs_review' ? firstInvoice(result.output) : result,
      findings: findings.map((found) => ({ line_number: found.line, type: found.type, expected_cents: Number(found.expected), billed_cents: Number(found.billed) })),
    });
  }
  const calls = await env.db
    .select()
    .from(llmCalls)
    .where(inArray(llmCalls.invoiceId, rows.map((row) => row.id)))
    .orderBy(asc(llmCalls.createdAt), asc(llmCalls.id));
  const [dead] = await env.db.select({ error: deadLetters.error }).from(deadLetters).where(inArray(deadLetters.jobId, rows.map((row) => row.hash)));
  return {
    id: golden.id,
    status: out.map((invoice) => invoice.status).join(','),
    error: dead?.error ?? null,
    e2eMs,
    invoices: out,
    calls: calls.map((call) => ({
      role: call.role,
      step: call.step,
      provider: call.provider,
      model: call.model,
      servedModel: call.servedModel,
      outcome: call.outcome,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      costMicroUsd: Number(call.costMicroUsd),
      paidMicroUsd: Number(paidCost(call.provider, call.model, call)),
    })),
  };
}

// Runs every selected case not yet cached for these pins, prompt and set version, `concurrency` at a time.
export async function evaluate({
  set,
  subset,
  label,
  roles,
  fresh = false,
  concurrency = 4,
  only,
  cachedOnly = false,
  environment = (r: Roles) => startEnvironment(r),
}: {
  set: 'golden' | 'comparison';
  subset: Subset;
  label: string;
  roles: Roles;
  fresh?: boolean;
  concurrency?: number;
  // These case ids alone, for tests.
  only?: string[];
  // Reports from the cache alone, with no model calls; cases not cached yet are left out.
  cachedOnly?: boolean;
  environment?: (roles: Roles) => Promise<Environment>;
}): Promise<Run> {
  const root = new URL(`../${set}/v1/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as Manifest;
  const inSubset = (entry: Manifest['cases'][number]) => (subset === 'dev' ? entry.split === 'dev' : subset === 'ci' ? entry.ci : true);
  const chosen = manifest.cases.filter((entry) => (only ? only.includes(entry.id) : inSubset(entry)));
  const cases = await Promise.all(chosen.map(async (entry) => JSON.parse(await readFile(new URL(`cases/${entry.id}.json`, root), 'utf8')) as GoldenCase));
  const key = sha256(JSON.stringify({ set, version: manifest.version, pins: pinsOf(roles), prompt: PROMPT_HASH })).slice(0, 12);
  const cache = new URL(`../.cache/${set}-${manifest.version}/${key}/`, import.meta.url);
  await mkdir(cache, { recursive: true });
  // A cached result is reused only for the same set version, every pinned provider/model and the prompt hash (the
  // directory) and the same PDF (its sha256 in the file name), so no result from another prompt or file mixes in.
  const cached = (golden: GoldenCase) => new URL(`${golden.id}-${golden.sha256.slice(0, 16)}.json`, cache);
  const results = new Map<string, CaseResult>();
  for (const golden of cases) {
    const file = cached(golden);
    if (!fresh && existsSync(file)) results.set(golden.id, JSON.parse(await readFile(file, 'utf8')) as CaseResult);
  }
  const todo = cases.filter((golden) => !results.has(golden.id));
  let stopped: string | undefined;
  if (todo.length > 0 && !cachedOnly) {
    const env = await environment(roles);
    try {
      const queue = [...todo];
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          for (let golden = queue.shift(); golden && !stopped; golden = queue.shift()) {
            const result = await runCase(env, root, golden);
            // A 429 that outlasted every retry is a spent quota: leave the case uncached and stop.
            if (result.error && /HTTP 429/.test(result.error)) {
              stopped = `${golden.id}: ${result.error}`;
              break;
            }
            results.set(golden.id, result);
            await writeFile(cached(golden), JSON.stringify(result));
            console.log(JSON.stringify({ msg: 'case done', run: label, id: golden.id, status: result.status, ms: result.e2eMs, done: results.size, of: cases.length }));
          }
        }),
      );
    } finally {
      await env.close();
    }
  }
  return { label, roles, cases, results, stopped, computed: cachedOnly ? 0 : todo.length, key, promptHash: PROMPT_HASH };
}

async function main() {
  const { values } = parseArgs({
    options: {
      suite: { type: 'string', default: 'extraction' },
      subset: { type: 'string', default: 'ci' },
      fresh: { type: 'boolean', default: false },
      'set-floors': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '4' },
      cached: { type: 'boolean', default: false },
    },
  });
  if (values.suite !== 'extraction') throw new Error('--suite must be extraction');
  if (!['dev', 'ci', 'full', 'compare'].includes(values.subset)) throw new Error('--subset must be dev, ci, full or compare');
  const subset = values.subset as Subset;
  const { roles, problems } = configuredRoles();
  const unpriced = Object.values(roles).flatMap(({ provider, model }) => (hasPrice(provider, model) ? [] : [`${provider}/${model} has no entry in packages/llm/prices.json`]));
  if (problems.length + unpriced.length > 0) throw new Error([...problems, ...unpriced].join('\n'));
  const started = Date.now();
  // The comparison pins only the primary differently: gemini-3.8-flash beside the configured one, on the comparison set.
  const plans =
    subset === 'compare'
      ? [
          { label: `${roles.primary.provider}/${roles.primary.model}`, roles },
          { label: 'gemini/gemini-3.8-flash', roles: { ...roles, primary: { ...roles.primary, provider: 'gemini' as const, model: 'gemini-3.8-flash', rpm: 5 } } },
        ]
      : [{ label: 'pinned', roles }];
  const runs: Run[] = [];
  for (const plan of plans) {
    runs.push(await evaluate({ set: subset === 'compare' ? 'comparison' : 'golden', subset, ...plan, fresh: values.fresh, concurrency: Number(values.concurrency), cachedOnly: values.cached }));
  }
  process.exit(await report({ subset, runs, durationMs: Date.now() - started, setFloors: values['set-floors'] }));
}

if (import.meta.main) await main();
