import { loadEnv } from '@freightaudit/config/env';
import { backlog, createQueues, createStorage } from '@freightaudit/pipeline';
import { httpCheck, serverOptions, shutdownTelemetry, tcpCheck } from '@freightaudit/telemetry';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import pg from 'pg';
import { buildApp } from './app.ts';
import { createService } from './service.ts';

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
]);
// One reconnect attempt per command, so a request fails fast while Redis is down instead of hanging.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
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
