// Shared by the api integration tests: a throwaway database with one tenant, a Redis key prefix, test PDFs.
import { tenants } from '@freightaudit/db';
import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { createMemoryStorage, createQueues } from '@freightaudit/pipeline';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
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

// A 2 x 1 grayscale PNG built with zlib, or a header-only JPEG: pdf-lib embeds JPEG bytes as they are, so a frame header
// is enough to wrap one. width and height set what the headers claim.
export function image(type: 'png' | 'jpeg', width = 2, height = 1) {
  if (type === 'jpeg') {
    const size = Buffer.alloc(4);
    size.writeUInt16BE(height, 0);
    size.writeUInt16BE(width, 2);
    const frame = Buffer.concat([Buffer.from('ffc0001108', 'hex'), size, Buffer.from('03012200021101031101', 'hex')]);
    return new Blob([Buffer.concat([Buffer.from('ffd8', 'hex'), frame, Buffer.from('ffd9', 'hex')])], { type: 'image/jpeg' });
  }
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits a pixel, grayscale
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.alloc(1 + width, 0x80)));
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const bytes = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return new Blob([bytes], { type: 'image/png' });
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
  // Uploads and the document route must share it, so tests pass it to buildApp too.
  const storage = createMemoryStorage();
  return {
    db,
    redis,
    prefix,
    queues,
    tenantId,
    storage,
    databaseUrl: database.url,
    service: createService({ db, queues, tenantId, storage }),
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
