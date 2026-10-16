// Trace context across queues: a job carries the W3C traceparent of the span that added it, so its worker continues
// that trace, from the upload through extract (each model call) and reconcile. Messaging attribute names are inlined
// from semconv v1.41.1 (development), as are the GenAI ones in packages/llm.
import { jobDuration, jobRetries, jobWait } from '@freightaudit/telemetry';
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';

export type TraceCarrier = { traceparent: string; tracestate?: string };

const tracer = trace.getTracerProvider().getTracer('@freightaudit/pipeline', undefined, { schemaUrl: 'https://opentelemetry.io/schemas/1.41.1' });
const messaging = (queue: string, operation: 'send' | 'process', id: string | undefined) => ({
  'messaging.system': 'bullmq',
  'messaging.destination.name': queue,
  'messaging.operation.type': operation,
  ...(id ? { 'messaging.message.id': id } : {}),
});

// Adds one job, or one flow, inside a producer span. `add` spreads the span's context into the job data as `otel`, or
// nothing while tracing is off. Only traceparent and tracestate are kept: baggage never reaches job data or dead letters.
export function send<T>(queue: string, jobId: string | undefined, add: (trace: { otel?: TraceCarrier }) => Promise<T>) {
  return tracer.startActiveSpan(`send ${queue}`, { kind: SpanKind.PRODUCER, attributes: messaging(queue, 'send', jobId) }, async (span) => {
    try {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      const { traceparent, tracestate } = carrier;
      return await add(traceparent ? { otel: { traceparent, ...(tracestate ? { tracestate } : {}) } } : {});
    } finally {
      span.end();
    }
  });
}

// Runs one job attempt as a consumer span under the span that added the job, and records its duration, its wait and
// the retry it may cause. A failure keeps only its class: messages may name document values.
export function consume<T>(queue: string, job: Job, run: () => Promise<T>): Promise<T> {
  const data = (job.data ?? {}) as { otel?: TraceCarrier; invoiceId?: unknown };
  const attributes = {
    ...messaging(queue, 'process', job.id),
    'freightaudit.job.name': job.name,
    'freightaudit.job.attempt': job.attemptsMade + 1,
    ...(typeof data.invoiceId === 'string' ? { 'freightaudit.invoice.id': data.invoiceId } : {}),
  };
  const startedAt = Date.now();
  return tracer.startActiveSpan(`process ${queue}`, { kind: SpanKind.CONSUMER, attributes }, propagation.extract(ROOT_CONTEXT, data.otel ?? {}), async (span) => {
    let outcome = 'completed';
    try {
      return await run();
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      // moveToDelayed (budget guard, paused queue) is not a failure.
      if (name === 'DelayedError') outcome = 'delayed';
      else {
        outcome = 'failed';
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', name);
        // BullMQ's own rule for whether it runs the job again.
        if (name !== 'UnrecoverableError' && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) jobRetries.add(1, { queue, error_class: name });
      }
      throw err;
    } finally {
      const labels = { queue, name: job.name };
      // The wait ends at the first attempt that ran; a job moved to delayed has not run yet.
      if (outcome !== 'delayed' && job.attemptsMade === 0) jobWait.record((startedAt - job.timestamp) / 1_000, labels);
      jobDuration.record((Date.now() - startedAt) / 1_000, { ...labels, outcome });
      span.end();
    }
  });
}
