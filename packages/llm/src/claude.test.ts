import { CLAUDE_MAX_TOKENS, createClaudeProvider } from './claude.ts';
import { RateLimitError } from './errors.ts';
import { type Call, extractInvoices, type Models, type Part, type Provider } from './extract.ts';

const valid = JSON.stringify({
  invoices: [
    {
      first_page: 1,
      carrier: 'Halcyon Ridge Freight',
      invoice_number: '10000001',
      invoice_date: '2026-09-01',
      pro_number: '1000000000',
      currency: 'USD',
      line_items: [
        { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 125_000 },
        { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 18_750 },
      ],
      subtotal_cents: null,
      tax_cents: null,
      total_cents: 143_750,
    },
  ],
});
const text: Part[] = [{ page: 1, text: 'INVOICE' }];
const KEY = 'sk-ant-test-0123456789abcdefghijklmnop';

// The Messages API on a fake fetch: each request answers with the next scripted response, and every body is kept.
function anthropic(...responses: { status: number; body: object; headers?: Record<string, string> | undefined }[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses[bodies.length - 1] ?? responses.at(-1)!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json', ...next.headers } });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}
const message = (json: string) => ({
  status: 200,
  body: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: json }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 300 } },
});
const apiError = (status: number, type: string, text: string, headers?: Record<string, string>) => ({ status, body: { type: 'error', error: { type, message: text } }, headers });

// A model that always answers the same; `calls` counts its requests.
function always(name: string, reply: string | Error) {
  const provider = { name, model: `${name}-model`, calls: 0 } as Provider & { calls: number };
  provider.generate = async () => {
    provider.calls++;
    if (reply instanceof Error) throw reply;
    return { text: reply, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, servedModel: undefined };
  };
  return provider;
}

function chain(responses: Parameters<typeof anthropic>, main: string | Error = 'not json') {
  const api = anthropic(...responses);
  const logs: object[] = [];
  const claude = createClaudeProvider({ apiKey: KEY, model: 'claude-haiku-5-5', baseUrl: 'http://claude.test', fetch: api.fetch, log: (fields) => void logs.push(fields) });
  const free = always('groq', valid);
  const models: Models = { primary: always('gemini', main), text: always('groq-text', main), fallback: free, claude };
  return { api, logs, claude, free, models };
}

test('Claude reads with thinking off, the main readers output ceiling, no temperature, the schema as its output format, scans as JPEG', async () => {
  const { api, models } = chain([message(valid)]);
  const scan: Part[] = [{ page: 1, text: 'Page one' }, { page: 2, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }];
  const result = await extractInvoices(models, { parts: scan, pageCount: 2 });
  expect(result).toMatchObject({ step: 'fallback', model: 'anthropic/claude-haiku-5-5' });
  const [body] = api.bodies;
  expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: CLAUDE_MAX_TOKENS, thinking: { type: 'disabled' }, output_config: { format: { type: 'json_schema' } } });
  expect(CLAUDE_MAX_TOKENS).toBe(65_536);
  expect(body).not.toHaveProperty('temperature');
  expect(body!.messages).toEqual([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Page 1:\nPage one' },
        { type: 'text', text: 'Page 2:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') } },
      ],
    },
  ]);
});

test('Claude comes after the main model and its repair, and before the free fallback, which it spares when it reads the invoice', async () => {
  const { models, free } = chain([message(valid)]);
  const calls: Call[] = [];
  const result = await extractInvoices(models, { parts: text, pageCount: 1 }, { onCall: (call) => void calls.push(call) });
  expect(calls.map(({ provider, step, outcome }) => `${provider} ${step} ${outcome}`)).toEqual(['groq-text first_pass invalid', 'groq-text repair invalid', 'anthropic fallback valid']);
  expect(result).toMatchObject({ step: 'fallback', fallbackReason: 'invalid_output' });
  expect(free.calls).toBe(0);
});

test.each([
  ['a 402 billing_error', apiError(402, 'billing_error', 'Your account has a billing problem.'), 'billing_error'],
  ['a 400 about the credit balance', apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), 'credit_balance'],
  ['a 400 about a spend limit', apiError(400, 'invalid_request_error', 'You have reached your specified API usage limits.'), 'spend_limit'],
  ['a 429 without retry-after', apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your daily rate limit.'), 'rate_limit_without_retry_after'],
] as const)('%s makes Claude unavailable: the free fallback takes over for the rest of the process, logged once', async (_case, response, reason) => {
  const { api, logs, claude, free, models } = chain([response]);
  const first = await extractInvoices(models, { parts: text, pageCount: 1 });
  expect(first).toMatchObject({ step: 'fallback', model: 'groq/groq-model' });
  expect(claude.available()).toBe(false);
  // The next invoice goes straight from its main model to the free fallback.
  await extractInvoices(models, { parts: text, pageCount: 1 });
  expect(api.bodies).toHaveLength(1);
  expect(free.calls).toBe(2);
  // The reason and status, once: never the key or the provider's message.
  expect(logs).toEqual([{ alert: 'claude_unavailable', reason, status: response.status }]);
  expect(JSON.stringify(logs)).not.toMatch(/sk-ant|credit balance|usage limits|billing problem|daily rate/);
});

test('a 429 with retry-after is a normal rate limit: it waits and retries as today, and Claude stays in the chain', async () => {
  const { logs, claude, free, models } = chain([apiError(429, 'rate_limit_error', 'Slow down.', { 'retry-after': '7' })]);
  const err = await extractInvoices(models, { parts: text, pageCount: 1 }).catch((thrown: unknown) => thrown);
  expect(err).toBeInstanceOf(RateLimitError);
  expect(err).toMatchObject({ retryAfterMs: 7_000, status: 429, message: 'anthropic HTTP 429 rate_limit_error' });
  expect(claude.available()).toBe(true);
  expect(free.calls).toBe(0);
  expect(logs).toEqual([]);
});

test('a rate-limited main model hands its first pass to Claude, and with Claude out of credit to the free fallback', async () => {
  const limited = new RateLimitError('gemini HTTP 429', { status: 429 });
  const withClaude = chain([message(valid)], limited);
  expect(await extractInvoices(withClaude.models, { parts: [{ page: 1, jpeg: new Uint8Array() }], pageCount: 1 })).toMatchObject({
    step: 'first_pass',
    fallbackReason: 'rate_limited',
    model: 'anthropic/claude-haiku-5-5',
  });
  const spent = chain([apiError(402, 'billing_error', 'No credit.')], limited);
  expect(await extractInvoices(spent.models, { parts: text, pageCount: 1 })).toMatchObject({ step: 'first_pass', model: 'groq/groq-model' });
});

test('without LLM_CLAUDE_MODEL the chain is the free one: main model, its repair, then the free fallback', async () => {
  const { models, free } = chain([message(valid)]);
  const calls: Call[] = [];
  await extractInvoices({ ...models, claude: undefined }, { parts: text, pageCount: 1 }, { onCall: (call) => void calls.push(call) });
  expect(calls.map(({ provider }) => provider)).toEqual(['groq-text', 'groq-text', 'groq']);
  expect(free.calls).toBe(1);
});
