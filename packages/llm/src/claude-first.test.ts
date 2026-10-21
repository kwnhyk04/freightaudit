import { createClaudeProvider } from './claude.ts';
import { CLAUDE_EXTRACTION_CAP, CLAUDE_FIRST_MAX_TOKENS, CLAUDE_INPUT_CAP, CLAUDE_PROMPT_CEILING, estimateInputTokens, gateClaude } from './claude-first.ts';
import { RateLimitError } from './errors.ts';
import { type Call, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, extractInvoices, type Models, type Part, type Provider } from './extract.ts';
// Two gates on one store are two worker processes on one Redis.
import { memoryClaudeStore as memoryStore } from './testing.ts';

const valid = JSON.stringify({
  invoices: [
    {
      first_page: 1,
      carrier: 'Halcyon Ridge Freight',
      invoice_number: '10000001',
      invoice_date: '2026-09-01',
      pro_number: '1000000000',
      currency: 'USD',
      line_items: [{ line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 125_000 }],
      subtotal_cents: null,
      tax_cents: null,
      total_cents: 125_000,
    },
  ],
});
const digital: Part[] = [{ page: 1, text: 'INVOICE' }];
const scan: Part[] = [{ page: 1, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }];
const KEY = 'sk-ant-test-0123456789abcdefghijklmnop';
const ON = Date.parse('2026-10-21T12:00:00Z');

type Scripted = { status: number; body: object; headers?: Record<string, string> } | Error;
// The Messages API on a fake fetch: each request answers with the next scripted response or throws it.
function anthropic(...responses: Scripted[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses[bodies.length - 1] ?? responses.at(-1)!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json', ...next.headers } });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}
const message = (json: string, input = 1_000, output = 200) => ({
  status: 200,
  body: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: json }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: input, output_tokens: output } },
});
const apiError = (status: number, type: string, text: string, headers?: Record<string, string>) => ({ status, body: { type: 'error', error: { type, message: text } }, headers });


function always(name: string, reply: string) {
  const provider = { name, model: `${name}-model`, calls: 0 } as Provider & { calls: number };
  provider.generate = async () => {
    provider.calls++;
    return { text: reply, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, servedModel: undefined };
  };
  return provider;
}

// One worker process: the free chain, and Claude first through its gate on the shared store.
function worker(api: ReturnType<typeof anthropic>, store = memoryStore(), options: { now?: number; inputCap?: number; free?: string } = {}) {
  const logs: object[] = [];
  const client = createClaudeProvider({ apiKey: KEY, model: 'claude-haiku-5-5', baseUrl: 'http://claude.test', fetch: api.fetch, maxTokens: CLAUDE_FIRST_MAX_TOKENS });
  const claude = gateClaude(client, store, { first: true, until: '2026-11-10', maxTokens: CLAUDE_FIRST_MAX_TOKENS, inputCap: options.inputCap, now: () => options.now ?? ON, log: (fields) => void logs.push(fields) });
  const free = { primary: always('gemini', options.free ?? valid), text: always('groq-text', options.free ?? valid), fallback: always('groq', options.free ?? valid) };
  const models: Models = { ...free, claude };
  return { models, free, logs, store };
}

test('Claude reads first: a digital and a scanned invoice each go to Anthropic under their document role, with max_tokens 560', async () => {
  const api = anthropic(message(valid));
  const { models, free } = worker(api);
  const calls: Call[] = [];
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 }, { onCall: (call) => void calls.push(call) })).toMatchObject({ step: 'first_pass', model: 'anthropic/claude-haiku-5-5' });
  expect(await extractInvoices(models, { parts: scan, pageCount: 1 }, { onCall: (call) => void calls.push(call) })).toMatchObject({ step: 'first_pass', model: 'anthropic/claude-haiku-5-5' });
  expect(calls.map(({ role, provider }) => `${role} ${provider}`)).toEqual(['text anthropic', 'primary anthropic']);
  expect(api.bodies.map((body) => body.max_tokens)).toEqual([560, 560]);
  expect(CLAUDE_FIRST_MAX_TOKENS).toBe(560);
  expect(free.text.calls + free.primary.calls + free.fallback.calls).toBe(0);
});

test.each([
  ['a 402 billing_error', apiError(402, 'billing_error', 'Your account has a billing problem.'), 'billing_error'],
  ['a 400 about the credit balance', apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), 'credit_balance'],
  ['a 400 about a spend limit', apiError(400, 'invalid_request_error', 'You have reached your specified API usage limits.'), 'spend_limit'],
  ['a 401', apiError(401, 'authentication_error', 'invalid x-api-key'), 'bad_key_or_model'],
  ['a 403', apiError(403, 'permission_error', 'Your API key does not have permission.'), 'bad_key_or_model'],
  ['a 404', apiError(404, 'not_found_error', 'model: claude-haiku-5-5'), 'bad_key_or_model'],
] as const)('%s: this invoice ends on the free chain, and Claude stays off for good, across a restart, with one alert', async (_case, response, reason) => {
  const api = anthropic(response);
  const first = worker(api);
  expect(await extractInvoices(first.models, { parts: digital, pageCount: 1 })).toMatchObject({ step: 'first_pass', model: 'groq-text/groq-text-model' });
  expect(first.store.state.off).toBe(reason);
  // A restarted worker on the same store never asks Anthropic again.
  const restarted = worker(api, first.store);
  expect(await extractInvoices(restarted.models, { parts: scan, pageCount: 1 })).toMatchObject({ model: 'gemini/gemini-model' });
  expect(api.bodies).toHaveLength(1);
  expect([...first.logs, ...restarted.logs]).toEqual([{ alert: 'claude_switched_off', reason, status: response.status }]);
  expect(JSON.stringify(first.logs)).not.toMatch(/sk-ant|credit balance|usage limits|billing problem|x-api-key/);
});

test('the end date: Claude reads first through 2026-11-10 23:59:59 UTC, and from 2026-11-11 00:00 UTC never again', async () => {
  const api = anthropic(message(valid));
  expect(await extractInvoices(worker(api, memoryStore(), { now: Date.parse('2026-11-10T23:59:59Z') }).models, { parts: digital, pageCount: 1 })).toMatchObject({ model: 'anthropic/claude-haiku-5-5' });
  const after = worker(api, memoryStore(), { now: Date.parse('2026-11-11T00:00:00Z') });
  expect(await extractInvoices(after.models, { parts: digital, pageCount: 1 })).toMatchObject({ model: 'groq-text/groq-text-model' });
  expect(api.bodies).toHaveLength(1);
});

test.each([
  ['a 429 without retry-after', apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit.')],
  ['a 429 with retry-after', apiError(429, 'rate_limit_error', 'Slow down.', { 'retry-after': '7' })],
  ['a 503', apiError(503, 'overloaded_error', 'Overloaded')],
  ['a dropped connection', new TypeError('fetch failed')],
] as const)('%s: this invoice ends on the free chain, and Claude stays on for the next', async (_case, response) => {
  const api = anthropic(response, message(valid));
  const { models, store } = worker(api);
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 })).toMatchObject({ step: 'first_pass', model: 'groq-text/groq-text-model' });
  expect(store.state.off).toBeUndefined();
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 })).toMatchObject({ model: 'anthropic/claude-haiku-5-5' });
});

test('an eval run pins its models: a rate-limited Claude waits and retries instead of handing the invoice to the free models', async () => {
  const api = anthropic(apiError(429, 'rate_limit_error', 'Slow down.', { 'retry-after': '7' }));
  await expect(extractInvoices(worker(api).models, { parts: digital, pageCount: 1 }, { fallbackOnRateLimit: false })).rejects.toBeInstanceOf(RateLimitError);
});

test('the input cap: a prompt estimated over 7,100 tokens never reaches Anthropic, and the free chain reads it', async () => {
  const api = anthropic(message(valid));
  const long: Part[] = [{ page: 1, text: 'LINEHAUL 1,240.00 '.repeat(500) }];
  expect(estimateInputTokens({ prompt: EXTRACTION_PROMPT, parts: long, schema: EXTRACTION_JSON_SCHEMA })).toBeGreaterThan(CLAUDE_INPUT_CAP);
  expect(await extractInvoices(worker(api).models, { parts: long, pageCount: 1 })).toMatchObject({ model: 'groq-text/groq-text-model' });
  expect(api.bodies).toHaveLength(0);
  expect(CLAUDE_INPUT_CAP).toBe(7_100);
});

test('the 100,000-token ceiling binds Claude as the backup too, which has no cap from real use, so no prompt reaches the 5x price', async () => {
  const api = anthropic(message(valid));
  const huge: Part[] = [{ page: 1, text: 'X'.repeat(160_000) }];
  expect(estimateInputTokens({ prompt: EXTRACTION_PROMPT, parts: huge, schema: EXTRACTION_JSON_SCHEMA })).toBeGreaterThan(CLAUDE_PROMPT_CEILING);
  const client = createClaudeProvider({ apiKey: KEY, model: 'claude-haiku-5-5', baseUrl: 'http://claude.test', fetch: api.fetch });
  const claude = gateClaude(client, memoryStore(), { first: false, maxTokens: 65_536, now: () => ON });
  const models: Models = { primary: always('gemini', 'not json'), text: always('groq-text', 'not json'), fallback: always('groq', 'not json'), claude };
  // The free main model and its repair fail, the backup is skipped unsent, and the free fallback fails too.
  expect(await extractInvoices(models, { parts: huge, pageCount: 1 })).toMatchObject({ step: 'needs_review' });
  expect(api.bodies).toHaveLength(0);
});

test("Claude's repair still invalid: the free fallback reads, then needs_review", async () => {
  const api = anthropic(message('not json'), message('not json'));
  const read = worker(api);
  const calls: Call[] = [];
  expect(await extractInvoices(read.models, { parts: digital, pageCount: 1 }, { onCall: (call) => void calls.push(call) })).toMatchObject({ step: 'fallback', model: 'groq/groq-model' });
  expect(calls.map(({ provider, step }) => `${provider} ${step}`)).toEqual(['anthropic first_pass', 'anthropic repair', 'groq fallback']);
  const none = worker(anthropic(message('not json')), memoryStore(), { free: 'not json' });
  expect(await extractInvoices(none.models, { parts: digital, pageCount: 1 })).toMatchObject({ step: 'needs_review' });
});

test('the per-extraction cap: a Claude repair that would take the invoice past 8,500 tokens goes to the free fallback instead', async () => {
  const api = anthropic(message('not json', 7_000, 500));
  const { models } = worker(api);
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 })).toMatchObject({ step: 'fallback', model: 'groq/groq-model' });
  expect(api.bodies).toHaveLength(1);
  expect(CLAUDE_EXTRACTION_CAP).toBe(8_500);
});

test("Claude's daily budget: a call is reserved before it is sent, settled to real use after, and refused once the day would pass it", async () => {
  const api = anthropic(message(valid, 900, 300));
  const store = memoryStore(3_000);
  const { models } = worker(api, store);
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 })).toMatchObject({ model: 'anthropic/claude-haiku-5-5' });
  expect(store.state.spent).toBe(1_200);
  // 1,200 spent: the next reservation (its estimate plus 560) would pass 3,000, so the free chain reads.
  expect(await extractInvoices(models, { parts: digital, pageCount: 1 })).toMatchObject({ model: 'groq-text/groq-text-model' });
  expect(api.bodies).toHaveLength(1);
});
