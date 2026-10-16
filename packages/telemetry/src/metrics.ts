import { metrics } from '@opentelemetry/api';

// Every instrument, named as infra/grafana/freightaudit.json and infra/prometheus-alerts.yml query them. Created at
// import: the metrics API has no proxy, so apps load this module only after --import started the SDK (sdk.ts), and
// everywhere else (tests, scripts, evals) the instruments are no-ops. Attributes stay low-cardinality and never carry
// document content.
const meter = metrics.getMeter('freightaudit');

// Seconds, from a quick reconcile to a long wait in the extract queue.
const seconds = { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60, 120, 300] };

export const queueJobs = meter.createObservableGauge('freightaudit.queue.jobs', { description: 'Jobs per queue and state: wait, active, delayed' });
export const deadLetterJobs = meter.createObservableGauge('freightaudit.queue.dead_letters', { description: 'Jobs waiting in each <queue>-dlq' });
export const extractPaused = meter.createObservableGauge('freightaudit.extract.paused', { description: '1 while the circuit breaker holds the extract queue paused' });
export const jobDuration = meter.createHistogram('freightaudit.job.duration', { unit: 's', description: 'Time one job attempt took', advice: seconds });
export const jobWait = meter.createHistogram('freightaudit.job.wait', { unit: 's', description: 'Time from enqueue to the first attempt that ran', advice: seconds });
export const jobRetries = meter.createCounter('freightaudit.job.retries', { description: 'Failed attempts BullMQ will retry, by error class' });
export const llmTokens = meter.createCounter('freightaudit.llm.tokens', { unit: '{token}', description: 'Model tokens by role, model and type' });
export const llmPaidEquivalent = meter.createCounter('freightaudit.llm.paid_equivalent_micro_usd', {
  description: 'What the model calls would cost at paid prices (packages/llm/prices.json), in micro-dollars',
});
export const llmRateLimited = meter.createCounter('freightaudit.llm.rate_limited', { description: 'Provider 429 responses' });
export const extractEscalations = meter.createCounter('freightaudit.extract.escalations', { description: 'Extractions that needed more than a first pass, by the step they ended on' });
export const extractFallbacks = meter.createCounter('freightaudit.extract.fallbacks', { description: 'Extractions that turned to the fallback model, by reason' });
export const invoicesNeedsReview = meter.createCounter('freightaudit.invoices.needs_review', { description: 'Invoices sent to needs_review, by reason' });
export const intakeRejected = meter.createCounter('freightaudit.intake.rejected', { description: 'Uploads refused with 503, by reason' });
