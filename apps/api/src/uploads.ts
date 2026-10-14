import type { MultipartFile } from '@fastify/multipart';
import { MAX_PAGES, PermanentError, readPdf } from '@freightaudit/llm';
import type { Storage } from '@freightaudit/pipeline';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Why a file was refused; handlers answer it as a 413 or 415 Problem.
export type Rejection = { status: 413 | 415; detail: string };
export type Upload = { fieldname: string; filename: string; sha256: string; rejection?: Rejection };

const uploads = new WeakMap<FastifyRequest, Upload[]>();

async function check(bytes: Buffer, truncated: boolean): Promise<Rejection | undefined> {
  if (truncated) return { status: 413, detail: 'file is larger than 10 MiB' };
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 415, detail: 'file must be a PDF' };
  let pages: number;
  try {
    pages = (await readPdf(bytes)).getPageCount();
  } catch (err) {
    if (err instanceof PermanentError) return { status: 415, detail: 'file is not a readable PDF' };
    throw err;
  }
  if (pages > MAX_PAGES) return { status: 413, detail: `file has ${pages} pages; the limit is ${MAX_PAGES}` };
}

// Reads one file part (multipart stops it at MAX_FILE_BYTES), checks it and stores an accepted PDF under its content
// hash. Only metadata stays in memory, so a 500-file batch holds at most one file at a time.
export const createOnFile = (storage: Storage) =>
  async function onFile(this: FastifyRequest, part: MultipartFile) {
    const chunks: Buffer[] = [];
    for await (const chunk of part.file) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const rejection = await check(bytes, part.file.truncated);
    if (!rejection) await storage.put(sha256, bytes);
    uploads.set(this, [...(uploads.get(this) ?? []), { fieldname: part.fieldname, filename: part.filename, sha256, rejection }]);
    // Schema validation sees the digest string in place of the file bytes.
    Object.assign(part, { value: sha256 });
  };

export const uploadsOf = (req: FastifyRequest, field: string) =>
  (uploads.get(req) ?? []).filter((upload) => upload.fieldname === field);
