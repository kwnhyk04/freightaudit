// pnpm requeue [--dry-run], and pnpm demo:requeue on the demo: puts invoices that lost their job back in their queues
// (requeue.ts). --dry-run lists what a run would do: its database sessions refuse writes and it writes nothing to Redis.
import { loadEnv } from '@freightaudit/config/env';
import { createPool } from '@freightaudit/db';
import { dayLeft } from '@freightaudit/llm';
import { createQueues, createStorage } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { parseArgs } from 'node:util';
import { extractionPlan, isRequeued, type Outcome, requeueStranded, tokensPerRead } from './requeue.ts';

// parseArgs refuses an unknown flag, so a mistyped --dry-run never becomes a real run.
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const dryRun = values['dry-run'];
const env = loadEnv([
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_PREFIX',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'DAILY_AI_TOKEN_BUDGET',
  'DAILY_CLAUDE_TOKEN_BUDGET',
  'LLM_CLAUDE_FIRST_UNTIL',
  'REQUEUE_MIN_AGE_MINUTES',
]);

const LEFT_ALONE: [Outcome, string][] = [
  ['queued', 'a job is waiting or running'],
  ['held', 'an open dead letter or a failed job, for a person to replay'],
  ['parts_pending', 'split uploads whose parts are not all read; run this again once they are'],
  ['no_pdf', 'no stored PDF, so a read could only fail them (the seed writes such rows)'],
  ['seeded', 'written by the seed, so they never had a job'],
  ['split_done', 'split uploads that are finished: extracted is their last status'],
];
const number = (value: number) => value.toLocaleString('en-US');
const reads = (count: number) => `${number(count)} ${count === 1 ? 'read' : 'reads'}`;
function byStatus(rows: { status: string }[]) {
  const counts = new Map<string, number>();
  for (const { status } of rows) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts].map(([status, count]) => `${status} ${count}`).join(', ');
}

const pool = createPool(env.DATABASE_URL, (msg, fields) => console.error(JSON.stringify({ msg, ...fields })), { readOnly: dryRun });
const db = drizzle(pool);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
const queues = createQueues(redis, env.REDIS_PREFIX, { readOnly: dryRun });
const storage = createStorage({ endpoint: env.S3_ENDPOINT, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY, bucket: env.S3_BUCKET });
try {
  const swept = await requeueStranded({ db, queues, storage }, { minAgeMs: env.REQUEUE_MIN_AGE_MINUTES * 60_000, dryRun });
  if (dryRun) console.log('Dry run: nothing changed.');
  console.log(`${number(swept.length)} invoices have been mid-pipeline for over ${env.REQUEUE_MIN_AGE_MINUTES} minutes.`);
  const requeued = swept.filter(({ outcome }) => isRequeued(outcome));
  console.log(`${dryRun ? 'Would re-queue' : 'Re-queued'} ${requeued.length}${requeued.length > 0 ? `: ${byStatus(requeued)}` : ''}.`);
  for (const { id, status, since, outcome } of requeued) console.log(`  ${id} ${status} since ${since.toISOString()}: ${outcome}`);
  for (const [outcome, why] of LEFT_ALONE) {
    const left = swept.filter((row) => row.outcome === outcome);
    if (left.length > 0) console.log(`Left alone, ${why}: ${left.length} (${byStatus(left)}).`);
  }

  const toRead = swept.filter(({ outcome }) => outcome === 'extract').length;
  if (toRead === 0) console.log('Extraction: no reads, so no tokens.');
  else {
    // An end date needs a model (llmRoles), so it says Claude reads; on the demo this one-off holds no other Claude setting.
    const claudeReads = new Date().toISOString().slice(0, 10) <= env.LLM_CLAUDE_FIRST_UNTIL;
    const read = await tokensPerRead(db, claudeReads ? 'anthropic' : undefined);
    const left = await dayLeft(redis, env.REDIS_PREFIX, { dailyTokenBudget: env.DAILY_AI_TOKEN_BUDGET, dailyClaudeBudget: claudeReads ? env.DAILY_CLAUDE_TOKEN_BUDGET : 0 });
    const plan = extractionPlan(toRead, read.tokens, left);
    const measured = read.invoices > 0 ? `measured on ${number(read.invoices)} ${read.invoices === 1 ? 'invoice' : 'invoices'}` : "the eval's average";
    console.log(`Extraction: ${reads(toRead)}, about ${number(plan.tokens)} tokens at ${number(read.tokens)} a read, ${measured}.`);
    console.log(`Today's budgets leave ${number(left.claude)} Claude tokens and ${number(left.free)} for the free models: about ${plan.claude} read with Claude, ${plan.free} with the free models, ${plan.nextDay} wait for 00:00 UTC.`);
  }
} finally {
  await queues.close();
  redis.disconnect();
  await pool.end();
}
