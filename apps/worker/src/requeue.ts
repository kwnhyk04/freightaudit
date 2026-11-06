import { deadLetters, extractions, invoices, llmCalls } from '@freightaudit/db';
import { send } from '@freightaudit/pipeline';
import { and, asc, countDistinct, eq, inArray, lte, sql, sum } from 'drizzle-orm';
import { type CollectJob, queueReconcile } from './extract.ts';
import type { Deps } from './workers.ts';

// An invoice in a mid-pipeline status moves only while a job is on its way, and that job lives in Redis alone: a Redis that
// loses it, or an upload that stopped between its row and its job, strands the invoice. This finds invoices with no job
// and puts each back at its step. Safe to repeat: the job id is the content hash, so a job that exists stops a second
// one, and every job checks the status again when it runs.

// The queue each mid-pipeline status waits on.
const NEXT = { received: 'extract', extracting: 'extract', extracted: 'reconcile', reconciling: 'reconcile' } as const;
const MID_PIPELINE = Object.keys(NEXT) as (keyof typeof NEXT)[];
const REPLIED = inArray(llmCalls.outcome, ['valid', 'invalid']);

// The step an invoice went back to, or why it stayed: its job is on its way, a person has to replay it, a split upload's
// parts are not all read, there is no PDF to read, the seed wrote it, or it is a split upload that is finished.
export type Outcome = 'extract' | 'collect' | 'reconcile' | 'queued' | 'held' | 'parts_pending' | 'no_pdf' | 'seeded' | 'split_done';
export const isRequeued = (outcome: Outcome) => outcome === 'extract' || outcome === 'collect' || outcome === 'reconcile';

type SweepDeps = Pick<Deps, 'db' | 'queues' | 'storage'>;

// Invoices past the age, with what decides their fate. A job's id is the invoice's content hash, or for a split upload's
// collect job that hash prefixed, as failureReason in the api finds them too.
const candidates = (db: Deps['db'], minAgeMs: number) =>
  db
    .select({
      id: invoices.id,
      tenantId: invoices.tenantId,
      status: invoices.status,
      contentSha256: invoices.contentSha256,
      updatedAt: invoices.updatedAt,
      model: extractions.model,
      split: sql<boolean | null>`${extractions.result} ? 'parts'`,
      deadLettered: sql<boolean>`EXISTS (SELECT 1 FROM ${deadLetters} WHERE ${deadLetters.tenantId} = ${invoices.tenantId} AND ${deadLetters.replayedAt} IS NULL
        AND ${deadLetters.jobId} IN (${invoices.contentSha256}, 'split-' || ${invoices.contentSha256}))`,
    })
    .from(invoices)
    .leftJoin(extractions, eq(extractions.invoiceId, invoices.id))
    .where(and(inArray(invoices.status, MID_PIPELINE), lte(invoices.updatedAt, sql`now() - make_interval(secs => ${minAgeMs / 1_000})`)))
    .orderBy(asc(invoices.createdAt), asc(invoices.id));
type Candidate = Awaited<ReturnType<typeof candidates>>[number];

// A split upload that lost its collect job: the read that split it is recorded, so the job is built from that and the
// parts, once the parts are read, as the flow would have run it. No second read, which could draw other parts.
async function queueCollect({ db, queues }: SweepDeps, { id: invoiceId, tenantId, contentSha256 }: Candidate, parts: { invoiceId: string; jobId: string }[]) {
  const calls = await db
    .select({ provider: llmCalls.provider, model: llmCalls.model, step: llmCalls.step, inputTokens: llmCalls.inputTokens, outputTokens: llmCalls.outputTokens })
    .from(llmCalls)
    .where(and(eq(llmCalls.invoiceId, invoiceId), REPLIED))
    .orderBy(asc(llmCalls.createdAt), asc(llmCalls.id));
  const last = calls.at(-1);
  const data: CollectJob = {
    tenantId,
    invoiceId,
    model: last ? `${last.provider}/${last.model}` : 'unknown',
    usage: { inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0), outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0) },
    step: last?.step as CollectJob['step'],
    parts,
  };
  const jobId = `split-${contentSha256}`;
  await send('extract', jobId, (trace) => queues.queue('extract').add('collect', { ...data, ...trace }, { jobId }));
}

async function settle(deps: SweepDeps, row: Candidate, dryRun: boolean): Promise<Outcome> {
  const { db, queues, storage } = deps;
  const { id, tenantId, contentSha256 } = row;
  const status = row.status as keyof typeof NEXT;
  // A finished split upload stays at extracted for good: its parts go on, and reconcile would only skip it.
  if (row.split) return 'split_done';
  // The seed writes invoices at every status for the pages to show, with no job behind them: those before extraction have
  // no PDF, and those after it carry this model. Running them would rewrite the demo's data, or fail them.
  if (row.model === 'seed') return 'seeded';
  if (row.deadLettered) return 'held';

  const step = NEXT[status];
  const queue = queues.queue(step);
  // ponytail: one state lookup per invoice, each scanning the queue's lists; read the job ids once if a backlog of many
  // thousands ever sits past the age.
  const jobIds = status === 'extracting' ? [contentSha256, `split-${contentSha256}`] : [contentSha256];
  const states = await Promise.all(jobIds.map((jobId) => queue.getJobState(jobId)));
  if (states.some((state) => state !== 'unknown' && state !== 'completed' && state !== 'failed')) return 'queued';
  // Its attempts are used up: the dead-letter sweep takes it from here.
  if (states.includes('failed')) return 'held';

  const parts = status === 'extracting' ? await db.select({ invoiceId: invoices.id, jobId: invoices.contentSha256, status: invoices.status }).from(invoices).where(eq(invoices.parentInvoiceId, id)) : [];
  if (parts.some((part) => part.status === 'received' || part.status === 'extracting')) return 'parts_pending';
  const outcome = parts.length > 0 ? 'collect' : step;
  // The job would only fail, and take the invoice with it.
  if (outcome === 'extract' && !(await storage.has(contentSha256))) return 'no_pdf';
  if (dryRun) return outcome;

  // A finished job keeps its id for a week and adding a job with a taken id is a no-op, so it goes first.
  await Promise.all(jobIds.map((jobId, i) => (states[i] === 'completed' ? queue.remove(jobId) : undefined)));
  if (outcome === 'collect') await queueCollect(deps, row, parts.map(({ invoiceId, jobId }) => ({ invoiceId, jobId })));
  else if (outcome === 'reconcile') await queueReconcile(deps, row);
  else await send('extract', contentSha256, (trace) => queue.add('extract', { tenantId, invoiceId: id, ...trace }, { jobId: contentSha256 }));
  return outcome;
}

// Every invoice in a mid-pipeline status past the age, and what became of it. A dry run changes nothing.
export async function requeueStranded(deps: SweepDeps, { minAgeMs, dryRun = false }: { minAgeMs: number; dryRun?: boolean }) {
  const swept: { id: string; status: string; since: Date; outcome: Outcome }[] = [];
  for (const row of await candidates(deps.db, minAgeMs)) swept.push({ id: row.id, status: row.status, since: row.updatedAt, outcome: await settle(deps, row, dryRun) });
  return swept;
}

// The eval's average read, for a deployment with no calls recorded yet: 320,016 tokens on 98 invoices (evals/README.md).
const EVAL_TOKENS_PER_READ = 3_300;

// What reading one invoice took here, repairs included, from the calls that returned a reply; Claude's tokens alone when
// given its provider, since a Claude read is what spends Claude's day.
export async function tokensPerRead(db: Deps['db'], provider?: string) {
  const [row] = await db
    .select({ tokens: sum(sql`${llmCalls.inputTokens} + ${llmCalls.outputTokens}`), invoices: countDistinct(llmCalls.invoiceId) })
    .from(llmCalls)
    .where(provider ? and(REPLIED, eq(llmCalls.provider, provider)) : REPLIED);
  const { tokens, invoices: read } = row!;
  return read > 0 ? { tokens: Math.round(Number(tokens) / read), invoices: read } : { tokens: EVAL_TOKENS_PER_READ, invoices: 0 };
}

// Who would read `reads` invoices of `perRead` tokens today: Claude while its day lasts, the free models while theirs
// does, and the rest wait for the next UTC day. An estimate, by the average: each call reserves a little more than it
// uses, so Claude's last read of the day may go to the free models.
export function extractionPlan(reads: number, perRead: number, left: { claude: number; free: number }) {
  const claude = Math.min(reads, Math.floor(left.claude / perRead));
  const free = Math.min(reads - claude, Math.floor(left.free / perRead));
  return { tokens: reads * perRead, claude, free, nextDay: reads - claude - free };
}
