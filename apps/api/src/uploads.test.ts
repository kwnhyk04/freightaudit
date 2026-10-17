import type { MultipartFile } from '@fastify/multipart';
import { createMemoryStorage } from '@freightaudit/pipeline';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import { createOnFile, manifestDigests, uploadsOf } from './uploads.ts';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Pages of different sizes, so each count gives other bytes.
async function pdf(pages: number) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let page = 0; page < pages; page++) doc.addPage([200 + page, 200]);
  return doc.save();
}
const part = (bytes: Uint8Array) =>
  ({ fieldname: 'file', filename: 'invoice.pdf', file: Object.assign(Readable.from([Buffer.from(bytes)]), { truncated: false }) }) as unknown as MultipartFile;

test('with an allowlist only a listed file is stored, and any other is refused with 403 before it is stored', async () => {
  const [listed, other] = [await pdf(1), await pdf(2)];
  const storage = createMemoryStorage();
  const onFile = createOnFile(storage, new Set([sha256(listed)]));
  const req = {} as FastifyRequest;
  await onFile.call(req, part(listed));
  await onFile.call(req, part(other));

  const [accepted, refused] = uploadsOf(req, 'file');
  expect(accepted).toMatchObject({ sha256: sha256(listed), rejection: undefined });
  expect(refused?.rejection).toEqual({ status: 403, detail: expect.stringContaining('golden set') });
  expect(await storage.get(sha256(listed))).toBeDefined();
  expect(await storage.get(sha256(other))).toBeUndefined();
});

test("the allowlist takes a manifest's sha256 digests and refuses a manifest that lists none", () => {
  const digest = 'a'.repeat(64);
  const manifest = { cases: [{ id: 'g001', sha256: digest }, { id: 'g002', sha256: 'not a digest' }, { id: 'g003' }] };
  expect(manifestDigests(JSON.stringify(manifest))).toEqual(new Set([digest]));
  expect(() => manifestDigests(JSON.stringify({ cases: [] }))).toThrow('no sha256');
});
