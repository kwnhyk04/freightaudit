import { invoices } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { createStorage } from '@freightaudit/pipeline';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { buildApp } from './app.ts';
import { apiKey, createTestEnv, formData, listen, pdf } from './testing.ts';

type Result = { index: number; status: string; invoice_id?: string; error?: Record<string, unknown> };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer());

let env: Awaited<ReturnType<typeof createTestEnv>>;
let app: ReturnType<typeof buildApp>;
let storage: ReturnType<typeof createStorage>;
let baseUrl = '';
beforeAll(async () => {
  env = await createTestEnv();
  // The run's MinIO, in a bucket of this test's own, so every object in it came from this batch.
  const options = { endpoint: testEnv('S3_ENDPOINT'), accessKey: testEnv('S3_ACCESS_KEY'), secretKey: testEnv('S3_SECRET_KEY') };
  storage = createStorage({ ...options, bucket: `batch-${randomBytes(4).toString('hex')}` });
  app = buildApp({}, { apiKeys: [apiKey], storage, service: env.service });
  baseUrl = await listen(app);
});
afterAll(async () => {
  await app?.close();
  await env?.close();
});

test('a batch of 50 files with 5 corrupt accepts 45, rejects 5 with Problem Details, and writes nothing half-way', async () => {
  const whole = await bytesOf(await pdf('cut in half'));
  const corrupt = new Map<number, Blob>([
    [3, new Blob([])],
    [11, new Blob(['Invoice 10001042, total 1,437.50 USD'])],
    [24, new Blob([Uint8Array.from({ length: 2_048 }, (_, i) => (i * 31) % 256)])],
    [37, new Blob(['%PDF-1.7\n%%EOF\n'])],
    [49, new Blob([whole.subarray(0, whole.length / 2)])],
  ]);
  const files = await Promise.all(Array.from({ length: 50 }, (_, i) => corrupt.get(i) ?? pdf(`batch file ${i}`)));
  const hashes = await Promise.all(files.map(async (file) => sha256(await bytesOf(file))));

  // pdf-lib warns about every object it cannot parse in the cut file.
  const warn = import.meta.jest.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await fetch(`${baseUrl}/v1/invoice-batches`, { method: 'POST', headers: { 'X-API-Key': apiKey }, body: formData('files', files) });
  warn.mockRestore();
  expect(response.status).toBe(202);
  const { results } = (await response.json()) as { results: Result[] };

  expect(results.map((result) => result.index)).toEqual(files.map((_, i) => i));
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(rejected.map((result) => result.index)).toEqual([...corrupt.keys()]);
  for (const { error } of rejected) {
    expect(error).toEqual({ type: 'about:blank', title: 'Unsupported Media Type', status: 415, detail: expect.any(String) });
  }
  const accepted = results.filter((result) => result.status === 'accepted');
  expect(accepted).toHaveLength(45);

  // Every accepted file has its invoice row, its stored bytes and its extract job; a rejected one has none of them.
  const rows = await env.db.select({ id: invoices.id, hash: invoices.contentSha256 }).from(invoices).where(eq(invoices.tenantId, env.tenantId));
  const jobs = await env.queues.queue('extract').getJobs(['waiting']);
  for (const [i, hash] of hashes.entries()) {
    const stored = await storage.get(hash);
    if (corrupt.has(i)) {
      expect([stored, rows.find((row) => row.hash === hash), jobs.find((job) => job.id === hash)]).toEqual([undefined, undefined, undefined]);
    } else {
      expect(stored && sha256(stored)).toBe(hash);
      expect(rows.find((row) => row.hash === hash)?.id).toBe(results[i]?.invoice_id);
      expect(jobs.find((job) => job.id === hash)?.data).toEqual({ tenantId: env.tenantId, invoiceId: results[i]?.invoice_id });
    }
  }
  expect([rows.length, jobs.length]).toEqual([45, 45]);
});
