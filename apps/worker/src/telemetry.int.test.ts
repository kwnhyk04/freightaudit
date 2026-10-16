import { invoices } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { createStorage } from '@freightaudit/pipeline';
import { eq } from 'drizzle-orm';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createTestEnv, extraction, fakeModels, makePdf, replyWith, waitFor } from './testing.ts';

// The real api and worker processes with telemetry on, exporting to an OTLP/JSON receiver in this test: one upload of a
// two-invoice PDF must give one trace from the api through the split, each part's model call and reconcile, and no
// exported span or log line may carry document content or a key.
type Value = Record<string, unknown>;
type KeyValue = { key: string; value: Value };
type Span = {
  traceId: string;
  name: string;
  attributes?: KeyValue[];
  events?: { attributes?: KeyValue[] }[];
  status?: { message?: string };
};
type Received = { service: string; scope: string; resource: KeyValue[]; span: Span };

const CANARY = 'cnry7f3a';
const API_KEY = `${CANARY}-api-key-0123456789abcdef0123456789`;
const MODEL_KEYS = { GEMINI_API_KEY: `${CANARY}-gemini-key`, GROQ_API_KEY: `${CANARY}-groq-key` };
// Attribute keys no span may carry: prompts and outputs, captured headers, bound SQL values, message bodies, credentials.
const FORBIDDEN = [
  /^gen_ai\.(input|output)\.messages$/,
  /^gen_ai\.system_instructions$/,
  /^gen_ai\.(prompt|completion)/,
  /^http\.(request|response)\.header\./,
  /^db\.postgresql\.(values|plan)$/,
  /^db\.query\.parameter\./,
  /^messaging\.message\.body/,
  /api[._-]?key|authorization|cookie|secret|passw/i,
];

const attribute = (span: Span, key: string) => {
  const value = span.attributes?.find((kv) => kv.key === key)?.value;
  return value && (value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue ?? value.arrayValue);
};

async function otlpReceiver() {
  const spans: Received[] = [];
  const metrics = new Set<string>();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body || '{}') as {
      resourceSpans?: { resource?: { attributes?: KeyValue[] }; scopeSpans?: { scope?: { name?: string }; spans?: Span[] }[] }[];
      resourceMetrics?: { scopeMetrics?: { metrics?: { name: string }[] }[] }[];
    };
    for (const { resource, scopeSpans = [] } of json.resourceSpans ?? []) {
      const service = String(resource?.attributes?.find((kv) => kv.key === 'service.name')?.value.stringValue);
      for (const { scope, spans: batch = [] } of scopeSpans) {
        for (const span of batch) spans.push({ service, scope: scope?.name ?? '', resource: resource?.attributes ?? [], span });
      }
    }
    for (const { scopeMetrics = [] } of json.resourceMetrics ?? []) for (const { metrics: batch = [] } of scopeMetrics) for (const { name } of batch) metrics.add(name);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const close = () => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, spans, metrics, close };
}

// A service started as `node --import <its telemetry.ts> <its main.ts>`, its stdout and stderr lines kept for the scan.
function start(app: 'api' | 'worker', env: NodeJS.ProcessEnv) {
  const dir = new URL(`../../${app}/src/`, import.meta.url);
  const child = spawn(process.execPath, ['--import', new URL('telemetry.ts', dir).href, fileURLToPath(new URL('main.ts', dir))], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  createInterface({ input: child.stderr! }).on('line', (line) => lines.push(line));
  const url = new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout! }).on('line', (line) => {
      lines.push(line);
      const { msg } = (line.startsWith('{') ? JSON.parse(line) : {}) as { msg?: string };
      if (msg?.startsWith('Server listening at ')) resolve(msg.slice('Server listening at '.length));
    });
    child.once('exit', (code) => reject(new Error(`${app} exited with ${code}:\n${lines.join('\n')}`)));
  });
  return { child, lines, url };
}

test('one upload is one trace from the api through every extract, model call and reconcile, and nothing leaks', async () => {
  const receiver = await otlpReceiver();
  // A three-page upload holds two invoices, pages 1-2 and 3, so the split-out parts differ in bytes; each part is one.
  // The replies plant the canary in every line description and invoice number.
  const plant = (json: string) => json.replaceAll('Linehaul', `Linehaul ${CANARY}`).replaceAll('"invoice_number":"', `"invoice_number":"${CANARY}-`);
  const models = await fakeModels((call) => replyWith(call.protocol, plant(call.pages === 3 ? extraction(1, 3) : extraction())));
  const bucket = 'freightaudit-test';
  const storage = createStorage({ endpoint: testEnv('S3_ENDPOINT'), accessKey: testEnv('S3_ACCESS_KEY'), secretKey: testEnv('S3_SECRET_KEY'), bucket });
  const env = await createTestEnv(storage);
  const shared = {
    HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    DATABASE_URL: env.databaseUrl,
    REDIS_PREFIX: env.prefix,
    S3_BUCKET: bucket,
    TENANT_ID: env.tenantId,
    OTEL_SDK_DISABLED: 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
    // Children are killed hard on Windows, so nothing waits for a flush at exit: export soon and often instead.
    OTEL_BSP_SCHEDULE_DELAY: '100',
    OTEL_METRIC_EXPORT_INTERVAL: '500',
  };
  const services: ChildProcess[] = [];
  const logs: string[][] = [];
  try {
    const api = start('api', { ...shared, API_PORT: '0', API_KEYS: API_KEY });
    const worker = start('worker', {
      ...shared,
      WORKER_PORT: '0',
      AI_ENABLED: 'true',
      // The pinned models, each served by the fake.
      LLM_PRIMARY_BASE_URL: models.url,
      LLM_TEXT_BASE_URL: models.url,
      LLM_FALLBACK_BASE_URL: models.url,
      MOCK_TMS_URL: models.url,
      ...MODEL_KEYS,
    });
    services.push(api.child, worker.child);
    logs.push(api.lines, worker.lines);
    const [apiUrl] = await Promise.all([api.url, worker.url]);

    const form = new FormData();
    form.append('file', new Blob([await makePdf(3)], { type: 'application/pdf' }), 'two-invoices.pdf');
    const response = await fetch(`${apiUrl}/v1/invoices`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Idempotency-Key': randomUUID() },
      body: form,
    });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };

    // The upload ends extracted once its parts are done; each part matches no shipment and ends needs_review.
    const parts = await waitFor(async () => {
      const rows = await env.db.select({ id: invoices.id, status: invoices.status }).from(invoices).where(eq(invoices.parentInvoiceId, id));
      const [upload] = await env.db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id));
      return rows.length === 2 && rows.every((row) => row.status === 'needs_review') && upload?.status === 'extracted' && rows;
    }, 60_000);
    const named = (name: string) => receiver.spans.filter(({ span }) => span.name === name);
    const wanted = ['freightaudit.job.duration', 'freightaudit.job.wait', 'freightaudit.llm.tokens', 'freightaudit.llm.paid_equivalent_micro_usd', 'freightaudit.queue.jobs', 'freightaudit.invoices.needs_review', 'http.server.request.duration'];
    await waitFor(async () => named('process reconcile').length === 2 && named('process extract').length >= 4 && wanted.every((name) => receiver.metrics.has(name)), 30_000);

    // One trace: the api's request, the upload's extract and its split, both parts' extracts, model calls and reconciles.
    const upload = receiver.spans.find(({ service, span }) => service === 'freightaudit-api' && attribute(span, 'http.route') === '/v1/invoices');
    expect(upload).toBeDefined();
    const pipeline = receiver.spans.filter(({ span }) => /^(process (extract|reconcile)|generate_content |chat )/.test(span.name));
    expect(new Set(pipeline.map(({ span }) => span.traceId))).toEqual(new Set([upload!.span.traceId]));
    const invoiceIds = new Set(pipeline.map(({ span }) => attribute(span, 'freightaudit.invoice.id')));
    for (const invoiceId of [id, ...parts.map((part) => part.id)]) expect(invoiceIds).toContain(invoiceId);
    expect(named('process extract').map(({ span }) => attribute(span, 'freightaudit.job.name'))).toContain('collect');

    // Model calls follow the GenAI conventions, read from the recorded Gemini body.
    const calls = receiver.spans.filter(({ span }) => span.name === 'generate_content gemini-3.5-flash-lite');
    expect(calls).toHaveLength(3);
    for (const { span } of calls) {
      expect(attribute(span, 'gen_ai.provider.name')).toBe('gcp.gemini');
      expect(Number(attribute(span, 'gen_ai.usage.input_tokens'))).toBeGreaterThan(0);
      expect(attribute(span, 'gen_ai.response.finish_reasons')).toEqual({ values: [{ stringValue: 'STOP' }] });
    }

    // The ESM hook took: pg and ioredis spans exist, and Redis spans name the command only, never its arguments.
    expect(receiver.spans.some(({ scope }) => scope === '@opentelemetry/instrumentation-pg')).toBe(true);
    const redis = receiver.spans.filter(({ scope }) => scope === '@opentelemetry/instrumentation-ioredis');
    expect(redis.length).toBeGreaterThan(0);
    for (const { span } of redis) expect(String(attribute(span, 'db.query.text') ?? attribute(span, 'db.statement'))).toMatch(/^\w+$/);

    // No forbidden key and no canary anywhere: attributes, events, resources, status messages and every log line.
    for (const { span, resource } of receiver.spans) {
      const pairs = [...(span.attributes ?? []), ...(span.events ?? []).flatMap((event) => event.attributes ?? []), ...resource];
      for (const { key } of pairs) expect(FORBIDDEN.filter((rule) => rule.test(key)).map(() => key)).toEqual([]);
      expect(JSON.stringify([pairs, span.status?.message ?? ''])).not.toContain(CANARY);
    }
    expect(logs.flat().filter((line) => line.includes(CANARY))).toEqual([]);
  } finally {
    for (const child of services) {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    }
    await env.close();
    await models.close();
    await receiver.close();
  }
}, 120_000);
