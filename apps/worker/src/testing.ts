// Shared by the worker integration tests: a throwaway database and Redis prefix, test PDFs, and a fake model server.
import { carriers, invoices, tenants } from '@freightaudit/db';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createLimits, createModels } from '@freightaudit/llm';
import { createMemoryStorage, createQueues, type Storage } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { type Deps, startWorkers, type WorkerOptions } from './workers.ts';

// The fake model server answers in the providers' recorded shapes.
export { type FakeCall, fakeModels, replyWith } from '@freightaudit/llm/testing';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const quiet = { warn: () => {}, error: () => {} };

// A valid PDF; the label goes into its metadata, so each label gives different bytes and a different hash. Its pages
// are blank, so each one goes to the model as an image.
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
      subtotal_cents: null,
      tax_cents: null,
      total_cents: 143_750,
    })),
  });

// The three model roles on one fake server, told apart by model id: Gemini's protocol for the primary, the
// OpenAI-compatible one for the text model and the fallback.
export const MODEL_IDS = { primary: 'fake-primary', text: 'fake-text', fallback: 'fake-fallback' } as const;
export const testRoles = (url: string) => {
  const role = (provider: string, model: string) => ({ provider, model, baseUrl: url, apiKey: 'test-key', rpm: 100_000, tpm: 1e9 });
  return { primary: role('gemini', MODEL_IDS.primary), text: role('groq', MODEL_IDS.text), fallback: role('groq', MODEL_IDS.fallback) };
};

type RunOptions = WorkerOptions & {
  modelsUrl?: string;
  tmsUrl?: string;
  limits?: { enabled?: boolean; dailyTokenBudget?: number };
  log?: Deps['log'];
};

// A migrated throwaway database with one tenant and carrier, and a Redis key prefix of its own.
export async function createTestEnv(storage: Storage = createMemoryStorage()) {
  const database = await createTestDatabase();
  const pool = new pg.Pool({ connectionString: database.url });
  const db = drizzle(pool);
  const tenantId = randomUUID();
  await db.insert(tenants).values({ id: tenantId, name: 'Test tenant' });
  await db.insert(carriers).values({ tenantId, name: 'Halcyon Ridge Freight' });
  const redis = new Redis(testEnv('REDIS_URL'), { maxRetriesPerRequest: null });
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
    // In-process workers with fast retries and generous AI limits unless overridden; without a models URL, AI is off.
    runWorkers({ modelsUrl, tmsUrl = modelsUrl ?? '', limits: overrides, log = quiet, ...options }: RunOptions = {}) {
      const roles = testRoles(modelsUrl ?? '');
      const limits = createLimits(redis, { prefix, enabled: true, dailyTokenBudget: 1e9, roles, ...overrides });
      const models = modelsUrl ? createModels(roles, limits) : undefined;
      const workers = startWorkers(
        { db, redis, queues, storage, limits, models, textMinChars: 100, tmsUrl, log },
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
