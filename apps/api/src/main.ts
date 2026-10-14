import { loadEnv } from '@freightaudit/config/env';
import { httpCheck, serverOptions, tcpCheck } from '@freightaudit/telemetry';
import { buildApp } from './app.ts';

const env = loadEnv(['HOST', 'API_PORT', 'LOG_LEVEL', 'API_KEYS', 'DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT']);
const app = buildApp(serverOptions(env.LOG_LEVEL), {
  apiKeys: env.API_KEYS,
  checks: {
    postgres: tcpCheck(env.DATABASE_URL, 5432),
    redis: tcpCheck(env.REDIS_URL, 6379),
    minio: httpCheck(new URL('/minio/health/live', env.S3_ENDPOINT).href),
  },
});
await app.listen({ port: env.API_PORT, host: env.HOST });
