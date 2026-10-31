// Test helpers for code that calls models: fixture invoices, recorded provider replies, a fake model server and a
// record/replay stand-in for a provider. Nothing here reaches a real provider unless LLM_RECORD=1.
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

const FIXTURES = new URL('../fixtures/', import.meta.url);

// A fixture file: digital.pdf and scanned.pdf, each with its ground truth beside it (digital.json, scanned.json).
export const fixture = (name: string) => readFileSync(new URL(name, FIXTURES));

// One request and the response it got, as recorded. The request is kept as its method, path, size and a digest of its
// body with image data masked, so a replay can tell that the same request was sent; never its headers, which hold the key.
type Exchange = { method: string; path: string; body_sha256: string; body_bytes?: number; status: number; headers: Record<string, string>; body: unknown };
type Cassette = { recorded_at: string; note?: string; exchanges: Exchange[] };

export const cassette = (name: string) => JSON.parse(readFileSync(new URL(`recorded/${name}.json`, FIXTURES), 'utf8')) as Cassette;

async function readBody(req: IncomingMessage) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// Renders differ by platform, so page images are masked before the request body is digested.
function digest(body: string) {
  const masked = body
    .replace(/"data":"[A-Za-z0-9+/=]{1000,}"/g, '"data":"<image>"')
    .replace(/data:image\/(\w+);base64,[A-Za-z0-9+/=]+/g, 'data:image/$1;base64,<image>');
  return createHash('sha256').update(masked).digest('hex');
}

async function listen(server: ReturnType<typeof createServer>, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// A provider stand-in at a local base URL. By default it answers each request from the cassette, in order, after
// checking that it is the request that was recorded; a changed request gets a 418 cassette_mismatch. With LLM_RECORD=1
// it forwards each request to `upstream`, the real base URL, and rewrites the cassette when closed.
export async function cassetteServer(name: string, upstream: string) {
  const recording = process.env.LLM_RECORD === '1';
  const recorded = recording ? [] : cassette(name).exchanges;
  const exchanges: Exchange[] = [];
  const sizes: number[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    sizes.push(Buffer.byteLength(body));
    const request = { method: req.method ?? '', path: req.url ?? '', body_sha256: digest(body) };
    if (!recording) {
      const next = recorded[exchanges.length];
      const same = next && next.method === request.method && next.path === request.path && next.body_sha256 === request.body_sha256;
      exchanges.push(next ?? { ...request, status: 418, headers: {}, body: null });
      if (!same) {
        res.writeHead(418, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'cassette_mismatch' } }));
        return;
      }
      res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers }).end(JSON.stringify(next.body));
      return;
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    for (const name of ['authorization', 'x-goog-api-key']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const response = await fetch(`${upstream.replace(/\/+$/, '')}${req.url ?? ''}`, { method: req.method ?? 'POST', headers, body });
    const text = await response.text();
    const kept = Object.fromEntries(['retry-after'].flatMap((h) => (response.headers.has(h) ? [[h, response.headers.get(h)!]] : [])));
    exchanges.push({ ...request, body_bytes: Buffer.byteLength(body), status: response.status, headers: kept, body: JSON.parse(text) as unknown });
    res.writeHead(response.status, { 'content-type': 'application/json', ...kept }).end(text);
  });
  const { url, close } = await listen(server);
  return {
    url,
    recording,
    // Requests a replay answered with cassette_mismatch: the request changed since it was recorded.
    mismatches: () => (recording ? [] : exchanges.filter((exchange, i) => recorded[i] !== exchange)),
    // Bytes of each request body it received, in order.
    sizes: () => sizes,
    async close() {
      await close();
      if (!recording) return;
      const file = new URL(`recorded/${name}.json`, FIXTURES);
      const recordedAt = new Date().toISOString().slice(0, 10);
      writeFileSync(file, `${JSON.stringify({ recorded_at: recordedAt, exchanges } satisfies Cassette, null, 2)}\n`);
    },
  };
}

// A reply from a recorded success of each protocol with its text swapped, so fakes answer in the providers' real shapes:
// Gemini generateContent, or an OpenAI-compatible chat completion. Without a text it is the recorded reply itself:
// Gemini's reading of fixtures/scanned.pdf, or Groq's of fixtures/digital.pdf.
export function replyWith(protocol: 'gemini' | 'openai', text?: string) {
  const [exchange] = cassette(protocol === 'gemini' ? 'gemini-scanned' : 'groq-digital').exchanges;
  const body = structuredClone(exchange!.body) as {
    candidates?: { content: { parts: { text: string }[] } }[];
    choices?: { message: { content: string } }[];
  };
  if (text === undefined) return { status: 200, body };
  if (protocol === 'gemini') body.candidates![0]!.content.parts = [{ text }];
  else body.choices![0]!.message.content = text;
  return { status: 200, body };
}

export type FakeCall = {
  n: number;
  protocol: 'gemini' | 'openai';
  model: string;
  pages: number;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
};
export type FakeReply = { status: number; headers?: Record<string, string>; body?: unknown } | 'hang';

// A local model server for both protocols, on a random port unless one is given. `reply` answers each call, numbered
// from 0; 'hang' never answers. The call says which protocol and model it is for and how many pages it carries. GET
// requests get an empty TMS page, for workers that run the TMS sync.
export async function fakeModels(reply: (call: FakeCall) => FakeReply | Promise<FakeReply>, port = 0) {
  let calls = 0;
  const server = createServer(async (req, res) => {
    const text = await readBody(req);
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [], next_cursor: null, has_more: false }));
      return;
    }
    const url = req.url ?? '';
    const gemini = /\/models\/([^/:]+):generateContent/.exec(url);
    const body = JSON.parse(text) as { model?: string };
    const call: FakeCall = {
      n: calls++,
      protocol: gemini ? 'gemini' : 'openai',
      model: gemini ? decodeURIComponent(gemini[1]!) : (body.model ?? ''),
      pages: text.match(/Page \d+:/g)?.length ?? 0,
      url,
      headers: req.headers,
      body,
    };
    const answer = await reply(call);
    if (answer === 'hang') return;
    res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers }).end(JSON.stringify(answer.body ?? {}));
  });
  const { url, close } = await listen(server, port);
  return { url, calls: () => calls, close };
}

// Claude's switch, day and spend cap as Redis keeps them (Limits), in memory; two gates on one store are two worker
// processes. `spent` counts the day's tokens, `micro` the total cost in micro-dollars.
export function memoryClaudeStore(budget = 1_400_000, cap = 2n ** 62n) {
  const state = { off: undefined as string | undefined, spent: 0, micro: 0n };
  return {
    state,
    claudeOff: async () => state.off,
    switchClaudeOff: async (reason: string) => (state.off ? false : ((state.off = reason), true)),
    reserveClaude: async (tokens: number, micro: bigint) => {
      if (state.micro + micro > cap) return 'cap' as const;
      if (state.spent + tokens > budget) return 'day' as const;
      state.spent += tokens;
      state.micro += micro;
      return 'ok' as const;
    },
    settleClaude: async (reserved: { tokens: number; micro: bigint }, used: { inputTokens: number; outputTokens: number }, usedMicro: bigint) => {
      state.spent += used.inputTokens + used.outputTokens - reserved.tokens;
      state.micro += usedMicro - reserved.micro;
    },
  };
}

// Anthropic's error answers: bad-key as recorded, the rest as Anthropic documents them (fixtures/anthropic).
export type AnthropicAnswer = { status: number; headers: Record<string, string>; body: object };
export function anthropicAnswer(name: string): AnthropicAnswer {
  const { answers } = JSON.parse(readFileSync(new URL('anthropic/documented.json', FIXTURES), 'utf8')) as { answers: Record<string, AnthropicAnswer> };
  if (Object.hasOwn(answers, name)) return answers[name]!;
  const { status, headers, body } = JSON.parse(readFileSync(new URL(`anthropic/${name}.json`, FIXTURES), 'utf8')) as AnthropicAnswer;
  return { status, headers, body };
}
