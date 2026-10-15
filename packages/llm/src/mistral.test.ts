import { ProviderConfigError, RateLimitError } from './errors.ts';
import { EXTRACTION_JSON_SCHEMA, type GenerateInput } from './extract.ts';
import type { Limits } from './limits.ts';
import { createModels } from './models.ts';
import { createOpenAiProvider } from './openai.ts';

// Mistral is no configured role (its account allowed no requests), but switching back is configuration only, so its
// adapter stays covered: the OpenAI-compatible client against hand-written replies in the shapes Mistral documents.
const mistral = createOpenAiProvider({ name: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-2603', apiKey: 'test-key' });
const input: GenerateInput = { prompt: 'read it', parts: [{ page: 1, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }], schema: EXTRACTION_JSON_SCHEMA };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
// Answers every request with `body` and keeps what was sent; no socket is opened.
function answer(status: number, body: object) {
  const sent: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return sent;
}

test('sends a scanned page as Mistral takes it and reads a chat completion in the shape Mistral documents', async () => {
  const sent = answer(200, {
    id: 'cmpl-e5cc70bb28c444948073e77776eb30ef',
    object: 'chat.completion',
    model: 'mistral-small-2603',
    usage: { prompt_tokens: 1_210, completion_tokens: 96, total_tokens: 1_306 },
    created: 1_760_500_000,
    choices: [{ index: 0, message: { role: 'assistant', content: '{"invoices":[]}', tool_calls: null, prefix: false }, finish_reason: 'stop' }],
  });
  expect(await mistral.generate(input)).toMatchObject({ text: '{"invoices":[]}', usage: { inputTokens: 1_210, outputTokens: 96 }, servedModel: 'mistral-small-2603' });
  expect(sent[0]!.url).toBe('https://api.mistral.ai/v1/chat/completions');
  expect(new Headers(sent[0]!.init.headers).get('authorization')).toBe('Bearer test-key');
  expect(JSON.parse(String(sent[0]!.init.body))).toEqual({
    model: 'mistral-small-2603',
    temperature: 0,
    messages: [
      { role: 'system', content: 'read it' },
      { role: 'user', content: [{ type: 'text', text: 'Page 1:' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4A==' } }] },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'invoices', strict: true, schema: EXTRACTION_JSON_SCHEMA } },
  });
});

// Error bodies as Mistral sends them: a 429 carries its code at the top level, a 401 only a detail.
test.each([
  { status: 429, body: { object: 'error', message: 'Rate limit exceeded', type: 'rate_limited', param: null, code: '1300' }, error: RateLimitError, message: 'mistral HTTP 429 1300' },
  { status: 401, body: { detail: 'Invalid API Key' }, error: ProviderConfigError, message: 'mistral HTTP 401' },
])('a Mistral $status maps onto the taxonomy', async ({ status, body, error, message }) => {
  answer(status, body);
  const err = await mistral.generate(input).catch((caught: unknown) => caught);
  expect(err).toBeInstanceOf(error);
  expect(err).toMatchObject({ message });
});

test('a Mistral fallback takes at most 8 page images a request, a Groq one 3', () => {
  const role = (provider: string) => ({ provider, model: `${provider}-model`, baseUrl: 'http://127.0.0.1:9', apiKey: 'k' });
  const limits = {} as Limits;
  expect(createModels({ primary: role('gemini'), text: role('groq'), fallback: role('mistral') }, limits).fallback.maxImages).toBe(8);
  expect(createModels({ primary: role('gemini'), text: role('groq'), fallback: role('groq') }, limits).fallback.maxImages).toBe(3);
});
