import { createClaudeProvider } from './claude.ts';
import { CLAUDE_EXTRACTION_CAP, CLAUDE_FIRST_MAX_TOKENS, CLAUDE_INPUT_CAP, CLAUDE_PROMPT_CEILING, estimateInputTokens, gateClaude } from './claude-first.ts';
import { PermanentError, RateLimitError, TransientError } from './errors.ts';
import { type Call, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, extractInvoices, type Models, type Part, type Provider } from './extract.ts';
import { callCost } from './prices.ts';
// Two gates on one store are two worker processes on one Redis.
import { anthropicAnswer, memoryClaudeStore as memoryStore } from './testing.ts';

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
const firstPassEstimate = (parts: Part[]) => estimateInputTokens({ prompt: EXTRACTION_PROMPT, parts, schema: EXTRACTION_JSON_SCHEMA });

type Scripted = { status: number; body: object; headers?: Record<string, string> } | Error | 'hang';
// The Messages API on a fake fetch: each request answers with the next scripted response, throws it, or hangs until the
// SDK's timeout aborts it. A recorded answer's framing headers are left out, since its body is sent anew.
function anthropic(...responses: Scripted[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses[bodies.length - 1] ?? responses.at(-1)!;
    if (next === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    if (next instanceof Error) throw next;
    const headers = Object.fromEntries(Object.entries(next.headers ?? {}).filter(([name]) => !/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(name)));
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json', ...headers } });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}
const message = (json: string, input = 1_000, output = 200) => ({
  status: 200,
  body: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: json }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: input, output_tokens: output } },
});

// A free model that answers its scripted replies in order, then the last one again; an Error is thrown.
function scripted(name: string, ...replies: (string | Error)[]) {
  const provider = { name, model: `${name}-model`, calls: 0, prompts: [] as string[] } as Provider & { calls: number; prompts: string[] };
  provider.generate = async ({ prompt }) => {
    provider.prompts.push(prompt);
    const reply = replies[Math.min(provider.calls++, replies.length - 1)] ?? valid;
    if (reply instanceof Error) throw reply;
    return { text: reply, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, servedModel: undefined };
  };
  return provider;
}

type Free = { primary?: (string | Error)[]; text?: (string | Error)[]; fallback?: (string | Error)[] };
// One worker process: Claude first through its gate on the shared store, and the free chain behind it.
function worker(api: ReturnType<typeof anthropic>, store = memoryStore(), options: { now?: number; inputCap?: number; timeoutMs?: number; free?: Free } = {}) {
  const logs: object[] = [];
  const client = createClaudeProvider({ apiKey: KEY, model: 'claude-haiku-5-5', baseUrl: 'http://claude.test', fetch: api.fetch, timeoutMs: options.timeoutMs });
  const claude = gateClaude(client, store, { until: '2026-11-10', inputCap: options.inputCap, now: () => options.now ?? ON, log: (fields) => void logs.push(fields) });
  const free = {
    primary: scripted('gemini', ...(options.free?.primary ?? [valid])),
    text: scripted('groq-text', ...(options.free?.text ?? [valid])),
    fallback: scripted('groq', ...(options.free?.fallback ?? [valid])),
  };
  const models: Models = { ...free, claude };
  const calls: Call[] = [];
  const run = (parts = digital, fallbackOnRateLimit = true) =>
    extractInvoices(models, { parts, pageCount: parts.length }, { fallbackOnRateLimit, onCall: (call) => void calls.push(call) });
  return { models, free, logs, store, calls, run };
}
const trail = (calls: Call[]) => calls.map(({ role, step, provider, outcome }) => `${role} ${step} ${provider} ${outcome}`);

test('Claude reads first: a digital and a scanned invoice each go to Anthropic under their document role, with max_tokens 560', async () => {
  const api = anthropic(message(valid));
  const { run, calls, free } = worker(api);
  expect(await run(digital)).toMatchObject({ step: 'first_pass', model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(await run(scan)).toMatchObject({ step: 'first_pass', model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(calls.map(({ role, provider }) => `${role} ${provider}`)).toEqual(['text anthropic', 'primary anthropic']);
  expect(api.bodies.map((body) => body.max_tokens)).toEqual([560, 560]);
  expect(CLAUDE_FIRST_MAX_TOKENS).toBe(560);
  expect(free.text.calls + free.primary.calls + free.fallback.calls).toBe(0);
});

test.each([
  ['the credit used up (a 400 naming the credit balance)', 'credit_balance', 'credit_balance'],
  ['a 402 billing_error', 'billing_error', 'billing_error'],
  ['a spend limit set in the Console (a 400)', 'spend_limit', 'spend_limit'],
  ["a workspace's spend limit (a 400)", 'workspace_spend_limit', 'spend_limit'],
  ["the usage tier's monthly spend cap (a 429 with enforced_spend_limit_reached and no retry-after)", 'tier_spend_cap', 'spend_limit'],
  ['a key Anthropic rejects (the recorded 401)', 'bad-key', 'bad_key_or_model'],
  ['a 403 permission_error', 'permission_error', 'bad_key_or_model'],
  ['a model Anthropic does not know (the recorded 404)', 'unknown-model', 'bad_key_or_model'],
] as const)('%s switches Claude off for good: this invoice and every later one end on the free chain, which says why, across a restart, with one alert', async (_case, name, reason) => {
  const answer = anthropicAnswer(name);
  const api = anthropic(answer);
  const first = worker(api);
  expect(await first.run(digital)).toMatchObject({ step: 'first_pass', model: 'groq-text/groq-text-model', claudeHandoff: reason });
  expect(first.store.state.off).toBe(reason);
  // Anthropic bills nothing it refused, so the call's reservation came back.
  expect(first.store.state).toMatchObject({ spent: 0, micro: 0n });
  // A restarted worker on the same store never asks Anthropic again.
  const restarted = worker(api, first.store);
  expect(await restarted.run(scan)).toMatchObject({ model: 'gemini/gemini-model', claudeHandoff: 'switched_off' });
  expect(api.bodies).toHaveLength(1);
  expect([...first.logs, ...restarted.logs]).toEqual([{ alert: 'claude_switched_off', reason, status: answer.status }]);
  // The reason and the status only: never the key or Anthropic's message.
  expect(JSON.stringify(first.logs)).not.toMatch(/sk-ant|too low|usage limits|payment information|x-api-key|permission to use|model: /);
});

test.each([
  ['a 429 with retry-after', 'rate_limited', '429'],
  ['a 429 without retry-after', 'rate_limited_no_retry_after', '429'],
  ['a 529 overloaded_error', 'overloaded', '5xx'],
  ['a 500 api_error', 'api_error', '5xx'],
  ['a 504 timeout_error', 'timeout_error', '5xx'],
  ['a 400 about the request itself', 'invalid_request', 'other'],
  ['a 413 request_too_large', 'request_too_large', 'other'],
] as const)('%s falls through for that call only: the free model behind Claude reads, its reservation comes back, and Claude reads the next invoice', async (_case, name, failure) => {
  const answer = anthropicAnswer(name);
  const api = anthropic(answer, message(valid));
  const { run, calls, store, logs } = worker(api);
  expect(await run(digital)).toMatchObject({ step: 'first_pass', model: 'groq-text/groq-text-model', claudeHandoff: failure });
  expect(trail(calls)).toEqual([`text first_pass anthropic ${failure === '429' ? 'rate_limited' : 'error'}`, 'text first_pass groq-text valid']);
  expect(calls[0]).toMatchObject({ errorClass: failure, httpStatus: answer.status });
  expect(store.state).toMatchObject({ off: undefined, spent: 0, micro: 0n });
  expect(await run(digital)).toMatchObject({ model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(logs).toEqual([]);
});

test('Claude takes the next step after a call fell through: a rate-limited read goes to the free model, and Claude repairs its reply', async () => {
  const api = anthropic(anthropicAnswer('rate_limited'), message(valid, 900, 300));
  const { run, calls, store } = worker(api, memoryStore(), { free: { text: ['not json'] } });
  // The reply used is Claude's, so nothing was handed off.
  expect(await run(digital)).toMatchObject({ step: 'repair', model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(trail(calls)).toEqual(['text first_pass anthropic rate_limited', 'text first_pass groq-text invalid', 'text repair anthropic valid']);
  // Only the repair counts against Claude's day and cap.
  expect(store.state).toMatchObject({ spent: 1_200, micro: callCost('anthropic', 'claude-haiku-5-5', { inputTokens: 900, outputTokens: 300 }) });
});

test.each([
  ['a timeout', 'hang', 'timeout'],
  ['a dropped connection', new TypeError('fetch failed'), 'network'],
] as const)('%s leaves the rest of that attempt to the free models, keeps its reservation, and Claude reads the next invoice', async (_case, response, failure) => {
  const api = anthropic(response, message(valid));
  const { run, calls, store } = worker(api, memoryStore(), { timeoutMs: 50, free: { text: ['not json', valid] } });
  expect(await run(digital)).toMatchObject({ step: 'repair', model: 'groq-text/groq-text-model', claudeHandoff: failure });
  // The repair never asked Claude.
  expect(trail(calls)).toEqual(['text first_pass anthropic error', 'text first_pass groq-text invalid', 'text repair groq-text valid']);
  expect(api.bodies).toHaveLength(1);
  // Anthropic may have billed a call it never answered, so its reservation stays.
  expect(store.state.spent).toBe(firstPassEstimate(digital) + 560);
  expect(await run(digital)).toMatchObject({ model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
});

test("a 529 on Claude's repair: the free model of the document's role repairs Claude's read, and the hand-off says why", async () => {
  const api = anthropic(message('not json'), anthropicAnswer('overloaded'));
  const { run, calls, free } = worker(api);
  expect(await run(digital)).toMatchObject({ step: 'repair', model: 'groq-text/groq-text-model', claudeHandoff: '5xx' });
  expect(trail(calls)).toEqual(['text first_pass anthropic invalid', 'text repair anthropic error', 'text repair groq-text valid']);
  // It repairs what Claude read, seeing the exact problems.
  expect(free.text.prompts[0]).toContain('Your previous reply was:\nnot json');
});

test('the third pass never asks a model that already replied: after Claude read, the free fallback gives the second opinion', async () => {
  const api = anthropic(message('not json'), anthropicAnswer('overloaded'));
  const { run, calls } = worker(api, memoryStore(), { free: { text: ['not json'] } });
  expect(await run(digital)).toMatchObject({ step: 'fallback', model: 'groq/groq-model', fallbackReason: 'invalid_output' });
  expect(trail(calls)).toEqual(['text first_pass anthropic invalid', 'text repair anthropic error', 'text repair groq-text invalid', 'fallback fallback groq valid']);
  expect(api.bodies).toHaveLength(2);
});

test('Claude takes the third pass when only free models have replied, ahead of the free fallback', async () => {
  const api = anthropic(anthropicAnswer('overloaded'), anthropicAnswer('overloaded'), message(valid));
  const { run, calls, free } = worker(api, memoryStore(), { free: { text: ['not json'] } });
  expect(await run(digital)).toMatchObject({ step: 'fallback', model: 'anthropic/claude-haiku-5-5', fallbackReason: 'invalid_output', claudeHandoff: null });
  expect(trail(calls)).toEqual([
    'text first_pass anthropic error',
    'text first_pass groq-text invalid',
    'text repair anthropic error',
    'text repair groq-text invalid',
    'fallback fallback anthropic valid',
  ]);
  expect(free.fallback.calls).toBe(0);
});

test("Claude's repair still invalid: the free fallback reads, then needs_review", async () => {
  const api = anthropic(message('not json'), message('not json'));
  const read = worker(api);
  // Claude took both of its passes, so its output, not a hand-off, sent the invoice on.
  expect(await read.run(digital)).toMatchObject({ step: 'fallback', model: 'groq/groq-model', fallbackReason: 'invalid_output', claudeHandoff: null });
  expect(trail(read.calls)).toEqual(['text first_pass anthropic invalid', 'text repair anthropic invalid', 'fallback fallback groq valid']);
  const none = worker(anthropic(message('not json')), memoryStore(), { free: { fallback: ['not json'] } });
  expect(await none.run(digital)).toMatchObject({ step: 'needs_review' });
});

test('a rate-limited Claude and a rate-limited free model: the free fallback reads, as it does without Claude', async () => {
  const api = anthropic(anthropicAnswer('rate_limited'));
  const { run, calls } = worker(api, memoryStore(), { free: { primary: [new RateLimitError('gemini HTTP 429', { status: 429 })] } });
  expect(await run(scan)).toMatchObject({ step: 'first_pass', model: 'groq/groq-model', fallbackReason: 'rate_limited', claudeHandoff: '429' });
  expect(trail(calls)).toEqual(['primary first_pass anthropic rate_limited', 'primary first_pass gemini rate_limited', 'fallback first_pass groq valid']);
});

test('the end date: Claude reads first through 2026-11-10 23:59:59 UTC, and from 2026-11-11 00:00 UTC never again', async () => {
  const api = anthropic(message(valid));
  expect(await worker(api, memoryStore(), { now: Date.parse('2026-11-10T23:59:59Z') }).run(digital)).toMatchObject({ model: 'anthropic/claude-haiku-5-5' });
  const after = worker(api, memoryStore(), { now: Date.parse('2026-11-11T00:00:00Z') });
  // Its window is over, so the free chain reading is no hand-off.
  expect(await after.run(digital)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: null });
  expect(api.bodies).toHaveLength(1);
});

test.each([
  ['a 429', 'rate_limited', RateLimitError],
  ['a 529', 'overloaded', TransientError],
  ['a 400 about the request', 'invalid_request', PermanentError],
] as const)('an eval run pins its chain: %s from Claude is not passed on, and the job retries Claude', async (_case, name, type) => {
  const { run, free } = worker(anthropic(anthropicAnswer(name)));
  await expect(run(digital, false)).rejects.toBeInstanceOf(type);
  expect(free.text.calls).toBe(0);
});

test('the input cap: a prompt estimated over 7,100 tokens never reaches Anthropic, and the free chain reads it, in an eval run too', async () => {
  const api = anthropic(message(valid));
  const long: Part[] = [{ page: 1, text: 'LINEHAUL 1,240.00 '.repeat(500) }];
  expect(firstPassEstimate(long)).toBeGreaterThan(CLAUDE_INPUT_CAP);
  expect(await worker(api).run(long)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: 'input_cap' });
  expect(await worker(api).run(long, false)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: 'input_cap' });
  expect(api.bodies).toHaveLength(0);
  expect(CLAUDE_INPUT_CAP).toBe(7_100);
});

test('the 100,000-token ceiling binds whatever input cap a gate is given, so no prompt reaches the 5x price', async () => {
  const api = anthropic(message(valid));
  const huge: Part[] = [{ page: 1, text: 'X'.repeat(160_000) }];
  expect(firstPassEstimate(huge)).toBeGreaterThan(CLAUDE_PROMPT_CEILING);
  expect(await worker(api, memoryStore(), { inputCap: 1_000_000 }).run(huge)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: 'input_cap' });
  expect(api.bodies).toHaveLength(0);
});

test('the per-invoice cap: a Claude repair that would take the invoice past 8,500 tokens goes to the free model of its role instead', async () => {
  const api = anthropic(message('not json', 7_000, 500));
  const { run, calls } = worker(api);
  expect(await run(digital)).toMatchObject({ step: 'repair', model: 'groq-text/groq-text-model', claudeHandoff: 'extraction_cap' });
  expect(trail(calls)).toEqual(['text first_pass anthropic invalid', 'text repair groq-text valid']);
  expect(api.bodies).toHaveLength(1);
  expect(CLAUDE_EXTRACTION_CAP).toBe(8_500);
});

test("Claude's daily budget: a call is reserved before it is sent, settled to real use after, and refused once the day would pass it; a full day is a pause, not a stop", async () => {
  const api = anthropic(message(valid, 900, 300));
  const store = memoryStore(3_000);
  const { run } = worker(api, store);
  expect(await run(digital)).toMatchObject({ model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(store.state.spent).toBe(1_200);
  // 1,200 spent: the next reservation (its estimate plus 560) would pass 3,000, so the free chain reads.
  expect(await run(digital)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: 'daily_budget' });
  expect(api.bodies).toHaveLength(1);
  expect(store.state.off).toBeUndefined();
});

test("the spend cap: each call reserves its worst case at Haiku's prices and settles to its bill; a call that would pass the cap switches Claude off for good, with one alert", async () => {
  const price = (inputTokens: number, outputTokens: number) => callCost('anthropic', 'claude-haiku-5-5', { inputTokens, outputTokens });
  const worst = price(firstPassEstimate(digital), 560);
  const billed = price(900, 300);
  // Haiku 5.5 at $0.10 in and $0.50 out per million tokens: 900 in and 300 out bill 240 micro-dollars.
  expect(billed).toBe(240n);
  // Room for one call's worst case, but not for a second one after the first one's bill.
  const store = memoryStore(1_400_000, billed + worst - 1n);
  const api = anthropic(message(valid, 900, 300));
  const { run, logs } = worker(api, store);
  expect(await run(digital)).toMatchObject({ model: 'anthropic/claude-haiku-5-5', claudeHandoff: null });
  expect(store.state.micro).toBe(billed);
  expect(await run(digital)).toMatchObject({ model: 'groq-text/groq-text-model', claudeHandoff: 'spend_cap' });
  expect(await run(scan)).toMatchObject({ model: 'gemini/gemini-model', claudeHandoff: 'switched_off' });
  expect(store.state).toMatchObject({ off: 'spend_cap', micro: billed });
  expect(api.bodies).toHaveLength(1);
  expect(logs).toEqual([{ alert: 'claude_switched_off', reason: 'spend_cap' }]);
});
