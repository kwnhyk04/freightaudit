import { extractions, invoices } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { createStorage } from '@freightaudit/pipeline';
import { eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createTestEnv, extraction, fakeGemini, makePdf, waitFor } from './testing.ts';

// The real worker process, killed with SIGKILL while the model call is in flight.
const main = fileURLToPath(new URL('main.ts', import.meta.url));
const bucket = 'freightaudit-test';

test('a job whose worker is killed mid-job is recovered by another worker without duplicate rows', async () => {
  let markHung!: () => void;
  const hung = new Promise<void>((resolve) => (markHung = resolve));
  const gemini = await fakeGemini(({ n }) => {
    if (n > 0) return { status: 200, text: extraction() };
    markHung();
    return 'hang';
  });
  const storage = createStorage({ endpoint: testEnv('S3_ENDPOINT'), accessKey: testEnv('S3_ACCESS_KEY'), secretKey: testEnv('S3_SECRET_KEY'), bucket });
  const env = await createTestEnv(storage);
  try {
    const child = spawn(process.execPath, [main], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        WORKER_PORT: '0',
        LOG_LEVEL: 'warn',
        DATABASE_URL: env.databaseUrl,
        REDIS_PREFIX: env.prefix,
        S3_BUCKET: bucket,
        TENANT_ID: env.tenantId,
        AI_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'fake',
        GEMINI_BASE_URL: gemini.url,
        MOCK_TMS_URL: gemini.url,
        JOB_LOCK_MS: '2000',
      },
    });
    const invoice = await env.upload(await makePdf());
    await hung;
    expect((await env.db.select().from(invoices).where(eq(invoices.id, invoice.id)))[0]?.status).toBe('extracting');

    child.kill('SIGKILL');
    await once(child, 'exit');
    // Another worker finds the lock expired, moves the job back to wait and runs it again.
    env.runWorkers({ geminiUrl: gemini.url });
    // The state first, then the job: a job read before its last attempt ends would show that attempt as not yet made.
    const extract = env.queues.queue('extract');
    const job = await waitFor(async () => (await extract.getJobState(invoice.contentSha256)) === 'completed' && extract.getJob(invoice.contentSha256));
    // The killed attempt never finished, so it is not counted: one stall, one finished attempt.
    expect(job.stalledCounter).toBe(1);
    expect(job.attemptsMade).toBe(1);
    expect(gemini.calls()).toBe(2);
    expect(await env.db.select().from(extractions).where(eq(extractions.invoiceId, invoice.id))).toHaveLength(1);
  } finally {
    await env.close();
    await gemini.close();
  }
});
