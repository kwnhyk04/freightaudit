import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

export type Upload = { fieldname: string; filename: string; sha256: string; isPdf: boolean };

const uploads = new WeakMap<FastifyRequest, Upload[]>();

// Streams a file part once: hashes it and sniffs the PDF header without buffering the file.
export async function onFile(this: FastifyRequest, part: MultipartFile) {
  const hash = createHash('sha256');
  let head = '';
  for await (const chunk of part.file) {
    if (head.length < 5) head += chunk.subarray(0, 5 - head.length).toString('latin1');
    hash.update(chunk);
  }
  const upload = { fieldname: part.fieldname, filename: part.filename, sha256: hash.digest('hex'), isPdf: head === '%PDF-' };
  uploads.set(this, [...(uploads.get(this) ?? []), upload]);
  // Schema validation sees the digest string in place of the file bytes.
  Object.assign(part, { value: upload.sha256 });
}

export const uploadsOf = (req: FastifyRequest, field: string) =>
  (uploads.get(req) ?? []).filter((upload) => upload.fieldname === field);
