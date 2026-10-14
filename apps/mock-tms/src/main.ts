import { loadEnv } from '@freightaudit/config/env';
import { serverOptions } from '@freightaudit/telemetry';
import { buildApp } from './app.ts';

const env = loadEnv(['HOST', 'MOCK_TMS_PORT', 'LOG_LEVEL', 'FAULT_RATE', 'LATENCY_MS']);
const app = buildApp(serverOptions(env.LOG_LEVEL), { faultRate: env.FAULT_RATE, latencyMs: env.LATENCY_MS });
await app.listen({ port: env.MOCK_TMS_PORT, host: env.HOST });
