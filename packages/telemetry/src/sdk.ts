// Starts OpenTelemetry for one service. Loaded through node --import (apps/*/src/telemetry.ts), before the app imports
// fastify, pg or ioredis, so the ESM hook and the instrumentations exist before those modules load. It must not import
// index.ts or metrics.ts: the metrics API has no proxy, and instruments made before sdk.start() would stay no-ops.
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { loadEnv } from '@freightaudit/config/env';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { metrics, NodeSDK, resources } from '@opentelemetry/sdk-node';
import { createAddHookMessageChannel } from 'import-in-the-middle';
import { register } from 'node:module';
import { hostname } from 'node:os';
import { onShutdown } from './shutdown.ts';

const PROBES = /^\/(healthz|readyz)(\?|$)/;

export async function startTelemetry(serviceName: string) {
  const env = loadEnv(['OTEL_SDK_DISABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_METRIC_EXPORT_INTERVAL']);
  // Instrumentation constructors patch modules, so a disabled SDK builds none of them.
  if (env.OTEL_SDK_DISABLED) return;
  // The hook wraps only the modules instrumentations ask for (pg, ioredis, http), never the app's own files. They ask
  // in their constructors, so they are built after this.
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '');
  const sdk = new NodeSDK({
    serviceName,
    // One series per process: two workers must not overwrite each other's counters.
    resource: resources.defaultResource().merge(resources.resourceFromAttributes({ 'service.instance.id': `${hostname()}-${process.pid}` })),
    // OTLP/JSON, which the collector takes on 4318 and the span-scan test reads without a protobuf decoder.
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: env.OTEL_METRIC_EXPORT_INTERVAL,
      }),
    ],
    // Logs stay pino JSON lines on stdout.
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => PROBES.test(req.url ?? '') }),
      // Sets http.route on the request span and its duration metric. No exception events: a message may echo input.
      new FastifyOtelInstrumentation({ registerOnInitialization: true, recordExceptions: false, ignorePaths: ({ url }) => PROBES.test(url) }),
      // SQL text with $n placeholders; bound values stay out (enhancedDatabaseReporting is off).
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true }),
      // Command names only: the default keeps every EVALSHA argument, and BullMQ passes job data and results that way.
      new IORedisInstrumentation({ requireParentSpan: true, dbStatementSerializer: (command) => command }),
    ],
  });
  sdk.start();
  onShutdown(() => sdk.shutdown());
  await waitForAllMessagesAcknowledged();
}
