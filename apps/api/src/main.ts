import { configError, loadEnv } from '@freightaudit/config/env';
import { createPool } from '@freightaudit/db';
import { backlog, createQueues, createStorage } from '@freightaudit/pipeline';
import { httpCheck, serverOptions, shutdownTelemetry, tcpCheck } from '@freightaudit/telemetry';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { buildApp } from './app.ts';
import { createService } from './service.ts';
import { manifestDigests } from './uploads.ts';

const env = loadEnv([
  'HOST',
  'API_PORT',
  'LOG_LEVEL',
  'API_KEYS',
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_PREFIX',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'TENANT_ID',
  'EXTRACT_HIGH_WATER',
  'RATE_LIMIT_PER_MIN',
  'UPLOAD_RATE_LIMIT_PER_MIN',
  'UPLOAD_ALLOWLIST',
]);
// The public demo's manifest: only the PDFs it lists may be uploaded. A missing or empty one stops startup.
function allowlist(path: string) {
  try {
    return manifestDigests(readFileSync(path, 'utf8'));
  } catch (err) {
    return configError(`UPLOAD_ALLOWLIST: ${(err as Error).message}`);
  }
}
// One reconnect attempt per command, so a request fails fast while Redis is down instead of hanging.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
// The logger exists by the time the pool has an idle connection to lose.
const pool = createPool(env.DATABASE_URL, (msg, fields) => app.log.warn(fields, msg));
const queues = createQueues(redis, env.REDIS_PREFIX);
const db = drizzle(pool);
const storage = createStorage({ endpoint: env.S3_ENDPOINT, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY, bucket: env.S3_BUCKET });
const app = buildApp(serverOptions(env.LOG_LEVEL), {
  apiKeys: env.API_KEYS,
  checks: {
    postgres: tcpCheck(env.DATABASE_URL, 5432),
    redis: tcpCheck(env.REDIS_URL, 6379),
    minio: httpCheck(new URL('/minio/health/live', env.S3_ENDPOINT).href),
  },
  service: createService({ db, queues, tenantId: env.TENANT_ID, storage }),
  graphql: { db, queues, tenantId: env.TENANT_ID },
  storage,
  redis,
  prefix: env.REDIS_PREFIX,
  rateLimits: { general: env.RATE_LIMIT_PER_MIN, upload: env.UPLOAD_RATE_LIMIT_PER_MIN },
  backlog: { waiting: () => backlog(queues.queue('extract')), highWater: env.EXTRACT_HIGH_WATER },
  uploadAllowlist: env.UPLOAD_ALLOWLIST ? allowlist(env.UPLOAD_ALLOWLIST) : undefined,
});

// SIGTERM: stop accepting connections, finish in-flight requests, then close the clients.
async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await shutdownTelemetry();
    await queues.close();
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
await app.listen({ port: env.API_PORT, host: env.HOST });
