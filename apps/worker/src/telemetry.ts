// Loaded with node --import before main.ts, so the instrumentation is in place before fastify, pg and ioredis load.
import { startTelemetry } from '@freightaudit/telemetry/sdk';

await startTelemetry('freightaudit-worker');
