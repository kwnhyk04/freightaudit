// Shared by the worker integration tests: a throwaway database and Redis prefix, test PDFs, and a fake Gemini.
import { carriers, invoices, tenants } from '@freightaudit/db';
import { createTestDatabase } from '@freightaudit/db/testing';
import { createGeminiProvider, createLimits, metered } from '@freightaudit/llm';
import { createMemoryStorage, createQueues, type Storage } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { startWorkers, type WorkerOptions } from './workers.ts';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const quiet = { warn: () => {}, error: () => {} };

// A valid PDF; the label goes into its metadata, so each label gives different bytes and a different hash.
export async function makePdf(pages = 1, label: string = randomUUID()) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(label);
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

// Polls until `check` returns something truthy.
export async function waitFor<T>(check: () => Promise<T>, timeoutMs = 20_000): Promise<Exclude<T, false | null | undefined | 0 | ''>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as Exclude<T, false | null | undefined | 0 | ''>;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await setTimeout(50);
  }
}

// A valid model reply: one invoice per first page, lines adding up to the total.
export const extraction = (...firstPages: number[]) =>
  JSON.stringify({
    invoices: (firstPages.length > 0 ? firstPages : [1]).map((first_page, i) => ({
      first_page,
      carrier: 'Halcyon Ridge Freight',
      invoice_number: `1000000${i}`,
      invoice_date: '2026-09-01',
      pro_number: `100000000${i}`,
      currency: 'USD',
      line_items: [
        { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 125_000 },
        { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 18_750 },
      ],
      total_cents: 143_750,
    })),
  });

export type Reply = { status: number; headers?: Record<string, string>; text?: string } | 'hang';

// Fake Gemini generateContent. `reply` gets the call number (from 0) and the page count of the PDF it was sent;
// 'hang' never answers. GET requests get an empty TMS page, for workers that run the TMS sync.
export async function fakeGemini(reply: (call: { n: number; pages: number }) => Reply) {
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [], next_cursor: null, has_more: false }));
      return;
    }
    const pdf = Buffer.from(JSON.parse(body).contents[0].parts[0].inline_data.data, 'base64');
    const answer = reply({ n: calls++, pages: (await PDFDocument.load(pdf)).getPageCount() });
    if (answer === 'hang') return;
    const json =
      answer.status === 200
        ? { candidates: [{ content: { parts: [{ text: answer.text }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80 } }
        : { error: { code: answer.status, message: 'fake error' } };
    res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers }).end(JSON.stringify(json));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls: () => calls,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

type RunOptions = WorkerOptions & {
  geminiUrl?: string;
  tmsUrl?: string;
  limits?: { enabled?: boolean; tokensPerMinute?: number; dailyTokenBudget?: number };
};

// A migrated throwaway database with one tenant and carrier, and a Redis key prefix of its own.
export async function createTestEnv(storage: Storage = createMemoryStorage()) {
  const database = await createTestDatabase();
  const pool = new pg.Pool({ connectionString: database.url });
  const db = drizzle(pool);
  const tenantId = randomUUID();
  await db.insert(tenants).values({ id: tenantId, name: 'Test tenant' });
  await db.insert(carriers).values({ tenantId, name: 'Halcyon Ridge Freight' });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  const queues = createQueues(redis, prefix);
  const stops: (() => Promise<void>)[] = [];
  return {
    db,
    redis,
    prefix,
    queues,
    storage,
    tenantId,
    databaseUrl: database.url,
    // In-process workers with fast retries and generous AI limits unless overridden.
    runWorkers({ geminiUrl, tmsUrl = geminiUrl ?? '', limits: overrides, ...options }: RunOptions = {}) {
      const limits = createLimits(redis, { prefix, enabled: true, tokensPerMinute: 1_000_000, dailyTokenBudget: 1e9, ...overrides });
      const gemini = geminiUrl && createGeminiProvider({ apiKey: 'test-key', model: 'fake', baseUrl: geminiUrl });
      const provider = gemini ? metered(gemini, limits) : undefined;
      const workers = startWorkers(
        { db, redis, queues, storage, limits, provider, tmsUrl, log: quiet },
        { lockDuration: 2_000, stalledInterval: 500, backoff: { baseMs: 50, capMs: 200 }, ...options },
      );
      stops.push(workers.close);
      return workers;
    },
    // What the api does on upload: store the PDF, add the invoice row, queue extract with jobId = content hash.
    async upload(pdf: Uint8Array) {
      const contentSha256 = sha256(pdf);
      await storage.put(contentSha256, pdf);
      const [invoice] = await db.insert(invoices).values({ tenantId, filename: 'invoice.pdf', contentSha256 }).returning();
      await queues.queue('extract').add('extract', { tenantId, invoiceId: invoice!.id }, { jobId: contentSha256 });
      return invoice!;
    },
    async close() {
      for (const stop of stops) await stop();
      await queues.close();
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      await pool.end();
      await database.drop();
    },
  };
}
