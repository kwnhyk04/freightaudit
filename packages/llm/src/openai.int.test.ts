import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PermanentError, ProviderConfigError, RateLimitError, TransientError } from './errors.ts';
import { EXTRACTION_JSON_SCHEMA, type GenerateInput } from './extract.ts';
import { createOpenAiProvider } from './openai.ts';
import { cassette, cassetteServer, type FakeCall, fakeModels, replyWith } from './testing.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const mixed: GenerateInput = { prompt: 'read it', parts: [{ page: 1, text: 'INVOICE 1' }, { page: 2, jpeg }], schema: EXTRACTION_JSON_SCHEMA };
const textOnly: GenerateInput = { ...mixed, parts: [{ page: 1, text: 'INVOICE 1' }] };
let fake: Awaited<ReturnType<typeof fakeModels>> | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});
const provider = (apiKey?: string, timeoutMs?: number) => createOpenAiProvider({ name: 'groq', baseUrl: `${fake!.url}/openai/v1/`, model: 'model-test', apiKey, timeoutMs });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (err: unknown) => err,
  );

test('sends a strict JSON schema at temperature 0 with page text and JPEG data URLs, and reads text, tokens and model', async () => {
  const seen: FakeCall[] = [];
  const reply = replyWith('openai', '{"invoices":[]}');
  Object.assign(reply.body, { usage: { prompt_tokens: 300, completion_tokens: 100 } });
  fake = await fakeModels((call) => (seen.push(call), reply));
  expect(await provider('test-key').generate(mixed)).toMatchObject({
    text: '{"invoices":[]}',
    usage: { inputTokens: 300, outputTokens: 100 },
    servedModel: 'openai/gpt-oss-120b',
    latencyMs: expect.any(Number),
  });
  expect(seen[0]?.url).toBe('/openai/v1/chat/completions');
  expect(seen[0]?.headers.authorization).toBe('Bearer test-key');
  expect(seen[0]?.body).toEqual({
    model: 'model-test',
    temperature: 0,
    messages: [
      { role: 'system', content: 'read it' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Page 1:\nINVOICE 1' },
          { type: 'text', text: 'Page 2:' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4A==' } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'invoices', strict: true, schema: EXTRACTION_JSON_SCHEMA } },
  });

  // Text alone is one string, which every model takes; Ollama gets no key.
  await provider().generate(textOnly);
  expect((seen[1]?.body as { messages: { content: unknown }[] }).messages[1]?.content).toBe('Page 1:\nINVOICE 1');
  expect(seen[1]?.headers.authorization).toBeUndefined();
});

// Error bodies in the shapes Groq and Mistral send; a 429 cannot be recorded on demand. Groq's json_validate_failed
// carries the model's output, line items included, in failed_generation.
const groqError = (code: string, extra = {}) => ({ error: { message: 'Something went wrong for Halcyon Ridge Freight', type: 'invalid_request_error', code, ...extra } });
test.each([
  { status: 429, headers: { 'retry-after': '11' }, body: groqError('rate_limit_exceeded'), error: RateLimitError, message: 'groq HTTP 429 rate_limit_exceeded', retryAfterMs: 11_000 },
  {
    status: 429,
    headers: { 'retry-after': '563' },
    body: groqError('rate_limit_exceeded', { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` on tokens per day (TPD): Limit 200000, Used 199000, Requested 1806. Please try again in 9m23s.', type: 'tokens' }),
    error: RateLimitError,
    message: 'groq HTTP 429 rate_limit_exceeded TPD',
    retryAfterMs: 563_000,
  },
  { status: 401, body: groqError('invalid_api_key'), error: ProviderConfigError, message: 'groq HTTP 401 invalid_api_key' },
  { status: 403, body: groqError('permission_denied'), error: ProviderConfigError, message: 'groq HTTP 403 permission_denied' },
  { status: 404, body: groqError('model_not_found'), error: ProviderConfigError, message: 'groq HTTP 404 model_not_found' },
  {
    status: 400,
    body: groqError('json_validate_failed', { failed_generation: '{"invoices":[{"carrier":"Halcyon Ridge Freight","total_cents":143750}]}' }),
    error: PermanentError,
    message: 'groq HTTP 400 json_validate_failed',
  },
  { status: 400, body: { object: 'error', message: 'Halcyon', type: 'invalid_request_error', code: null }, error: PermanentError, message: 'groq HTTP 400 invalid_request_error' },
  { status: 503, body: {}, error: TransientError, message: 'groq HTTP 503' },
])('HTTP $status $message maps onto the taxonomy and keeps no message text', async ({ status, headers, body, error, message, retryAfterMs }) => {
  fake = await fakeModels(() => ({ status, headers, body }));
  const err = (await failure(provider('k').generate(textOnly))) as Error & { retryAfterMs?: number };
  expect(err).toBeInstanceOf(error);
  expect(err.message).toBe(message);
  if (error === PermanentError) expect(err).not.toBeInstanceOf(ProviderConfigError);
  expect(err.retryAfterMs).toBe(retryAfterMs);
});

test('a real Mistral 429, recorded, is a RateLimitError with no wait to honour', async () => {
  const [exchange] = cassette('mistral-rate-limited').exchanges;
  fake = await fakeModels(() => ({ status: exchange!.status, body: exchange!.body }));
  const mistral = createOpenAiProvider({ name: 'mistral', baseUrl: fake.url, model: 'mistral-small-2603', apiKey: 'k' });
  const err = await failure(mistral.generate(textOnly));
  expect(err).toBeInstanceOf(RateLimitError);
  expect(err).toMatchObject({ message: 'mistral HTTP 429 1300', retryAfterMs: undefined });
});

test('a timeout is transient', async () => {
  fake = await fakeModels(() => 'hang');
  expect(await failure(provider('k', 100).generate(textOnly))).toMatchObject({ name: 'TransientError', message: 'request timed out' });
});

// Real rejections recorded with LLM_RECORD=1: a made-up key, and a model id that does not exist (with the real key).
const recording = process.env.LLM_RECORD === '1';
const keys: Record<string, string | undefined> = recording ? parseEnv(readFileSync(new URL('../../../.env', import.meta.url), 'utf8')) : {};
test.each([
  { name: 'groq-bad-key', upstream: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', key: undefined },
  { name: 'groq-unknown-model', upstream: 'https://api.groq.com/openai/v1', model: 'unknown/model-0', key: 'GROQ_API_KEY' },
  { name: 'mistral-bad-key', upstream: 'https://api.mistral.ai/v1', model: 'mistral-small-2603', key: undefined },
])('$name: the recorded rejection pauses work as a ProviderConfigError', async ({ name, upstream, model, key }) => {
  const server = await cassetteServer(name, upstream);
  try {
    const apiKey = recording && key ? (keys[key] ?? '') : 'made-up-key-0000';
    const err = await failure(createOpenAiProvider({ name: name.split('-')[0]!, baseUrl: server.url, model, apiKey }).generate(textOnly));
    expect(err).toBeInstanceOf(ProviderConfigError);
    expect(server.mismatches()).toEqual([]);
  } finally {
    await server.close();
  }
});
