import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { classify, parseRetryAfter, PermanentError, TransientError } from './errors.ts';
import { createGeminiProvider } from './gemini.ts';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler = () => {};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  handler(req, body, res);
});
let baseUrl = '';
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const input = { pdf: new TextEncoder().encode('%PDF'), pageCount: 1, prompt: 'read it' };
const provider = (timeoutMs?: number) => createGeminiProvider({ apiKey: 'secret-key', model: 'flash-test', baseUrl, timeoutMs });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (err: unknown) => err,
  );

test('sends the PDF inline with the key in a header, and reads the text and token usage', async () => {
  let seen: { url?: string; key?: unknown; body?: { contents: { parts: unknown[] }[]; generationConfig: object } } = {};
  handler = (req, body, res) => {
    seen = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) };
    const reply = {
      candidates: [{ content: { parts: [{ text: '{"invoices":' }, { text: '[]}' }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40, thoughtsTokenCount: 60 },
    };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  };
  expect(await provider().generate(input)).toEqual({ text: '{"invoices":[]}', usage: { inputTokens: 300, outputTokens: 100 } });
  expect(seen.url).toBe('/v1beta/models/flash-test:generateContent');
  expect(seen.key).toBe('secret-key');
  expect(seen.body?.contents[0]?.parts).toEqual([{ inline_data: { mime_type: 'application/pdf', data: 'JVBERg==' } }, { text: 'read it' }]);
  expect(seen.body?.generationConfig).toEqual({ response_mime_type: 'application/json', temperature: 0 });
});

test("429 and 5xx are transient and carry the server's wait; other 4xx are permanent", async () => {
  handler = (_req, _body, res) => res.writeHead(429, { 'retry-after': '7' }).end();
  expect(await failure(provider().generate(input))).toMatchObject({ name: 'TransientError', retryAfterMs: 7_000 });
  const retryInfo = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.5s' }] } };
  handler = (_req, _body, res) => res.writeHead(429).end(JSON.stringify(retryInfo));
  expect(await failure(provider().generate(input))).toMatchObject({ name: 'TransientError', retryAfterMs: 1_500 });
  handler = (_req, _body, res) => res.writeHead(503).end();
  expect(await failure(provider().generate(input))).toBeInstanceOf(TransientError);
  handler = (_req, _body, res) => res.writeHead(400).end();
  expect(await failure(provider().generate(input))).toBeInstanceOf(PermanentError);
});

test('timeouts and dropped or refused connections are transient', async () => {
  handler = () => {};
  expect(await failure(provider(50).generate(input))).toMatchObject({ name: 'TransientError', message: 'request timed out' });
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
