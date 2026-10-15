import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseEnv } from 'node:util';
import { classify, parseRetryAfter, PermanentError, ProviderConfigError, RateLimitError, TransientError } from './errors.ts';
import { EXTRACTION_JSON_SCHEMA, type GenerateInput } from './extract.ts';
import { createGeminiProvider } from './gemini.ts';
import { cassetteServer, type FakeCall, fakeModels, replyWith } from './testing.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const input: GenerateInput = { prompt: 'read it', parts: [{ page: 1, text: 'INVOICE 1' }, { page: 2, jpeg }], schema: EXTRACTION_JSON_SCHEMA };
let fake: Awaited<ReturnType<typeof fakeModels>> | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});
const provider = (apiKey = 'test-key', timeoutMs?: number) => createGeminiProvider({ apiKey, model: 'flash-test', baseUrl: fake!.url, timeoutMs });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (err: unknown) => err,
  );

test('sends the pages, the schema and temperature 0, with the key only in x-goog-api-key, which GOOGLE_API_KEY cannot replace', async () => {
  let seen: FakeCall | undefined;
  const reply = replyWith('gemini', '{"invoices":[]}');
  Object.assign((reply.body as { usageMetadata: object }).usageMetadata, { promptTokenCount: 300, candidatesTokenCount: 40, thoughtsTokenCount: 60 });
  fake = await fakeModels((call) => ((seen = call), reply));
  process.env.GOOGLE_API_KEY = 'environment-key';
  try {
    // Thinking tokens are billed as output.
    expect(await provider('configured-key').generate(input)).toMatchObject({
      text: '{"invoices":[]}',
      usage: { inputTokens: 300, outputTokens: 100 },
      servedModel: 'gemini-3.5-flash-lite',
      latencyMs: expect.any(Number),
    });
  } finally {
    delete process.env.GOOGLE_API_KEY;
  }
  expect(seen?.url).toBe('/v1beta/models/flash-test:generateContent');
  expect(seen?.headers['x-goog-api-key']).toBe('configured-key');
  expect(seen?.body).toMatchObject({
    contents: [
      {
        role: 'user',
        parts: [{ text: 'read it' }, { text: 'Page 1:\nINVOICE 1' }, { text: 'Page 2:' }, { inlineData: { mimeType: 'image/jpeg', data: '/9j/4A==' } }],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: EXTRACTION_JSON_SCHEMA },
  });
});

// Error bodies in the shape the Gemini API documents; a 429 cannot be recorded on demand.
const quota = {
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '500' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
    ],
  },
};
const rejected = (status: number, grpc: string, reason?: string) => ({
  error: { code: status, message: 'API key not valid. Please pass a valid API key.', status: grpc, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] },
});

test.each([
  { status: 429, body: quota, error: RateLimitError, message: 'gemini HTTP 429 RESOURCE_EXHAUSTED', retryAfterMs: 37_000 },
  { status: 401, body: rejected(401, 'UNAUTHENTICATED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED'), error: ProviderConfigError, message: 'gemini HTTP 401 UNAUTHENTICATED ACCESS_TOKEN_TYPE_UNSUPPORTED' },
  { status: 403, body: rejected(403, 'PERMISSION_DENIED'), error: ProviderConfigError, message: 'gemini HTTP 403 PERMISSION_DENIED' },
  { status: 404, body: rejected(404, 'NOT_FOUND'), error: ProviderConfigError, message: 'gemini HTTP 404 NOT_FOUND' },
  { status: 400, body: rejected(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'), error: ProviderConfigError, message: 'gemini HTTP 400 INVALID_ARGUMENT API_KEY_INVALID' },
  { status: 400, body: rejected(400, 'INVALID_ARGUMENT'), error: PermanentError, message: 'gemini HTTP 400 INVALID_ARGUMENT' },
  { status: 503, body: rejected(503, 'UNAVAILABLE'), error: TransientError, message: 'gemini HTTP 503 UNAVAILABLE' },
])('HTTP $status $message maps onto the taxonomy and keeps no message text', async ({ status, body, error, message, retryAfterMs }) => {
  fake = await fakeModels(() => ({ status, body }));
  const err = (await failure(provider().generate(input))) as Error & { retryAfterMs?: number };
  expect(err).toBeInstanceOf(error);
  expect(err.message).toBe(message);
  if (error === PermanentError) expect(err).not.toBeInstanceOf(ProviderConfigError);
  expect(err.retryAfterMs).toBe(retryAfterMs);
});

test('timeouts and refused connections are transient', async () => {
  fake = await fakeModels(() => 'hang');
  expect(await failure(provider('k', 100).generate(input))).toMatchObject({ name: 'TransientError', message: 'request timed out' });
  // A port that was just free, so nothing listens on it.
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  const closed = createGeminiProvider({ apiKey: 'k', model: 'm', baseUrl: `http://127.0.0.1:${port}` });
  expect(await failure(closed.generate(input))).toMatchObject({ name: 'TransientError', message: 'connection failed: ECONNREFUSED' });
  expect(classify(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBeInstanceOf(TransientError);
  const unknown = new Error('bug');
  expect(classify(unknown)).toBe(unknown);
});

test('Retry-After is read as seconds or as an HTTP date', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  expect(parseRetryAfter('120', now)).toBe(120_000);
  expect(parseRetryAfter('Wed, 14 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
  expect(parseRetryAfter('Wed, 14 Oct 2026 11:00:00 GMT', now)).toBe(0);
  expect(parseRetryAfter('soon', now)).toBeUndefined();
  expect(parseRetryAfter(null, now)).toBeUndefined();
});

// Real rejections recorded with LLM_RECORD=1: a made-up key, and a model id that does not exist (with the real key).
const recording = process.env.LLM_RECORD === '1';
const keys: Record<string, string | undefined> = recording ? parseEnv(readFileSync(new URL('../../../.env', import.meta.url), 'utf8')) : {};
test.each([
  { name: 'gemini-bad-key', model: 'gemini-3.5-flash-lite', realKey: false },
  { name: 'gemini-unknown-model', model: 'gemini-0.0-unknown', realKey: true },
])('$name: the recorded rejection pauses work as a ProviderConfigError', async ({ name, model, realKey }) => {
  const server = await cassetteServer(name, 'https://generativelanguage.googleapis.com');
  try {
    const apiKey = recording && realKey ? (keys.GEMINI_API_KEY ?? '') : 'made-up-key-0000';
    const err = await failure(createGeminiProvider({ apiKey, model, baseUrl: server.url }).generate({ ...input, parts: [{ page: 1, text: 'INVOICE 1' }] }));
    expect(err).toBeInstanceOf(ProviderConfigError);
    expect(server.mismatches()).toEqual([]);
  } finally {
    await server.close();
  }
});
