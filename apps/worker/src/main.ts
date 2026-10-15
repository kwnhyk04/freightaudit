import { configError, LLM_SETTINGS, llmRoles, loadEnv } from '@freightaudit/config/env';
import { createLimits, createModels, hasPrice } from '@freightaudit/llm';
import { createQueues, createStorage } from '@freightaudit/pipeline';
import { readiness, serverOptions, tcpCheck } from '@freightaudit/telemetry';
import { drizzle } from 'drizzle-orm/node-postgres';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { scheduleTmsSync, startWorkers } from './workers.ts';

const env = loadEnv([
  'HOST',
  'WORKER_PORT',
  'LOG_LEVEL',
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_PREFIX',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'TENANT_ID',
  'AI_ENABLED',
  'DAILY_AI_TOKEN_BUDGET',
  'LLM_TEXT_MIN_CHARS',
  'MOCK_TMS_URL',
  'JOB_LOCK_MS',
  ...LLM_SETTINGS,
]);
// With AI off nothing is required: no model is built and extract jobs wait.
const { roles, problems } = llmRoles(env);
const unpriced = Object.values(roles).flatMap(({ provider, model }) => (hasPrice(provider, model) ? [] : [`${provider}/${model} has no entry in packages/llm/prices.json`]));
if (env.AI_ENABLED && problems.length + unpriced.length > 0) configError([...problems, ...unpriced].join('\n'));

const app = Fastify(serverOptions(env.LOG_LEVEL));
// Workers block on Redis, so BullMQ needs a connection that never gives up on a command by itself.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const queues = createQueues(redis, env.REDIS_PREFIX);
const limits = createLimits(redis, { prefix: env.REDIS_PREFIX, enabled: env.AI_ENABLED, dailyTokenBudget: env.DAILY_AI_TOKEN_BUDGET, roles });
const workers = startWorkers(
  {
    db: drizzle(pool),
    redis,
    queues,
    limits,
    models: env.AI_ENABLED ? createModels(roles, limits) : undefined,
    textMinChars: env.LLM_TEXT_MIN_CHARS,
    storage: createStorage({ endpoint: env.S3_ENDPOINT, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY, bucket: env.S3_BUCKET }),
    tmsUrl: env.MOCK_TMS_URL,
    log: app.log,
  },
  { lockDuration: env.JOB_LOCK_MS },
);
await scheduleTmsSync(queues, env.TENANT_ID);

const checks = { postgres: tcpCheck(env.DATABASE_URL, 5432), redis: tcpCheck(env.REDIS_URL, 6379) };
app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/readyz', async (req, reply) => {
  const { ready, body } = await readiness(checks, req.log);
  return reply.code(ready ? 200 : 503).send(body);
});

// SIGTERM: take no new jobs, let running ones finish, then close connections. Whatever sends SIGTERM must wait longer
// than the slowest job; a job cut off by a kill is recovered as stalled by another worker.
async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  try {
    await workers.close();
    await queues.close();
    await app.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown failed');
    process.exit(1);
  }
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
await app.listen({ port: env.WORKER_PORT, host: env.HOST });
