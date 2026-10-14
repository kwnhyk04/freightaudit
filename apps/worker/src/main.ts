import { loadEnv } from '@freightaudit/config/env';
import { readiness, serverOptions, tcpCheck } from '@freightaudit/telemetry';
import Fastify from 'fastify';

// Health endpoints for the worker process; queue processors are not built yet.
const env = loadEnv(['HOST', 'WORKER_PORT', 'LOG_LEVEL', 'DATABASE_URL', 'REDIS_URL']);
const checks = { postgres: tcpCheck(env.DATABASE_URL, 5432), redis: tcpCheck(env.REDIS_URL, 6379) };

const app = Fastify(serverOptions(env.LOG_LEVEL));
app.get('/healthz', async () => ({ status: 'ok' }));
app.get('/readyz', async (req, reply) => {
  const { ready, body } = await readiness(checks, req.log);
  return reply.code(ready ? 200 : 503).send(body);
});
await app.listen({ port: env.WORKER_PORT, host: env.HOST });
