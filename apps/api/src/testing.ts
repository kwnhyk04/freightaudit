// Shared by the api integration tests: a throwaway database with one tenant, a Redis key prefix, test PDFs.
import { tenants } from '@freightaudit/db';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createQueues } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { createService } from './service.ts';

export const apiKey = 'k'.repeat(40);

// A valid PDF; the label goes into its metadata, so each label gives different bytes and a different hash.
export async function pdf(label: string = randomUUID(), pages = 1) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(label);
  for (let i = 0; i < pages; i++) doc.addPage();
  return new Blob([Buffer.from(await doc.save())], { type: 'application/pdf' });
}

export function formData(field: string, files: Blob[]) {
  const body = new FormData();
  files.forEach((file, index) => body.append(field, file, `invoice-${index}.pdf`));
  return body;
}

export async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

export async function createTestEnv() {
  const database = await createTestDatabase();
  const pool = new pg.Pool({ connectionString: database.url });
  const db = drizzle(pool);
  const tenantId = randomUUID();
  await db.insert(tenants).values({ id: tenantId, name: 'Test tenant' });
  const redis = new Redis(testEnv('REDIS_URL'), { maxRetriesPerRequest: 1 });
  const prefix = `test-${randomBytes(4).toString('hex')}`;
  const queues = createQueues(redis, prefix);
  return {
    db,
    redis,
    prefix,
    queues,
    tenantId,
    databaseUrl: database.url,
    service: createService({ db, queues, tenantId }),
    async close() {
      await queues.close();
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      await pool.end();
      await database.drop();
    },
  };
}
