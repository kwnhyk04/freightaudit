import { loadEnv } from '@freightaudit/config/env';
import { serverOptions } from '@freightaudit/telemetry';
import Fastify from 'fastify';

const env = loadEnv(['HOST', 'MOCK_TMS_PORT', 'LOG_LEVEL']);
const app = Fastify(serverOptions(env.LOG_LEVEL));
app.get('/healthz', async () => ({ status: 'ok' }));
// No dependencies, so it is ready whenever it is up.
app.get('/readyz', async () => ({ status: 'ok', checks: {} }));
await app.listen({ port: env.MOCK_TMS_PORT, host: env.HOST });
