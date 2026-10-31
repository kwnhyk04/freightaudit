import { createClaudeProvider } from './claude.ts';
import { CLAUDE_FIRST_MAX_TOKENS, gateClaude } from './claude-first.ts';
import { type Call, extractInvoices, type Models, type Part, type Provider } from './extract.ts';
import { memoryClaudeStore } from './testing.ts';

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

// The Messages API on a fake fetch that answers every request with one message, keeping each body.
function anthropic(json: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const body = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: json }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 300 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

// A model that always answers the same; `calls` counts its requests.
function always(name: string, reply: string) {
  const provider = { name, model: `${name}-model`, calls: 0 } as Provider & { calls: number };
  provider.generate = async () => {
    provider.calls++;
    return { text: reply, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, servedModel: undefined };
  };
  return provider;
}

function chain(json: string) {
  const api = anthropic(json);
  const client = createClaudeProvider({ apiKey: KEY, model: 'claude-haiku-5-5', baseUrl: 'http://claude.test', fetch: api.fetch });
  const claude = gateClaude(client, memoryClaudeStore(), { until: '2099-12-31' });
  const free = always('groq', valid);
  const models: Models = { primary: always('gemini', 'not json'), text: always('groq-text', 'not json'), fallback: free, claude };
  return { api, free, models };
}

test('Claude reads with thinking off, at most 560 output tokens, no temperature, the schema as its output format, scans as JPEG', async () => {
  const { api, models } = chain(valid);
  const scan: Part[] = [{ page: 1, text: 'Page one' }, { page: 2, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }];
  expect(await extractInvoices(models, { parts: scan, pageCount: 2 })).toMatchObject({ step: 'first_pass', model: 'anthropic/claude-haiku-5-5' });
  const [body] = api.bodies;
  expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: CLAUDE_FIRST_MAX_TOKENS, thinking: { type: 'disabled' }, output_config: { format: { type: 'json_schema' } } });
  expect(CLAUDE_FIRST_MAX_TOKENS).toBe(560);
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

test('without LLM_CLAUDE_MODEL the chain is the free one: main model, its repair, then the free fallback', async () => {
  const { models, free } = chain(valid);
  const calls: Call[] = [];
  await extractInvoices({ ...models, claude: undefined }, { parts: text, pageCount: 1 }, { onCall: (call) => void calls.push(call) });
  expect(calls.map(({ provider }) => provider)).toEqual(['groq-text', 'groq-text', 'groq']);
  expect(free.calls).toBe(1);
});
