import type { MultipartFile } from '@fastify/multipart';
import { checkUpload, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@freightaudit/contracts/limits';
import { imageToPdf, MAX_PAGES, PermanentError, readPdf } from '@freightaudit/llm';
import type { Storage } from '@freightaudit/pipeline';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

// Why a file was refused; handlers answer it as a 403, 413 or 415 Problem.
export type Rejection = { status: 403 | 413 | 415; detail: string };
export type Upload = { fieldname: string; filename: string; sha256: string; rejection?: Rejection };

const uploads = new WeakMap<FastifyRequest, Upload[]>();

// The PDF to store for a file: the file itself, or a one-page PDF around a PNG or JPEG. The web upload form runs the
// same checkUpload first, so both refuse the same files.
async function toPdf(bytes: Buffer, truncated: boolean): Promise<Uint8Array | Rejection> {
  const checked = checkUpload(bytes, truncated ? MAX_UPLOAD_BYTES + 1 : bytes.length);
  if (!checked.ok) return { status: checked.status, detail: checked.detail };
  try {
    const pdf = checked.type === 'pdf' ? bytes : await imageToPdf(bytes, checked.type);
    // The web serves documents through a function whose response Vercel caps at 4.5 MB, so the stored PDF must fit.
    if (pdf.byteLength > MAX_UPLOAD_BYTES) {
      return { status: 413, detail: `file is larger than ${MAX_UPLOAD_LABEL} once stored as a PDF; send it as JPG or PDF` };
    }
    const pages = (await readPdf(pdf)).getPageCount();
    if (pages > MAX_PAGES) return { status: 413, detail: `file has ${pages} pages; the limit is ${MAX_PAGES}` };
    return pdf;
  } catch (err) {
    if (err instanceof PermanentError) return { status: 415, detail: checked.type === 'pdf' ? 'file is not a readable PDF' : err.message };
    throw err;
  }
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// The digests a manifest lists (evals/golden/v1/manifest.json: cases[].sha256), for UPLOAD_ALLOWLIST.
export function manifestDigests(json: string) {
  const { cases } = JSON.parse(json) as { cases?: { sha256?: unknown }[] };
  const digests = new Set((cases ?? []).flatMap(({ sha256 }) => (typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256) ? [sha256] : [])));
  if (digests.size === 0) throw new Error('the manifest lists no sha256 digests');
  return digests;
}
const notAllowed: Rejection = { status: 403, detail: 'this demo accepts only the sample invoices of the golden set' };

// Reads one file part (multipart stops it at MAX_UPLOAD_BYTES), checks it and stores the accepted PDF under its content
// hash. Only metadata stays in memory, so a 500-file batch holds at most one file at a time. With `allowed` (the public
// demo), a whole file whose digest is not in it is refused before it is parsed or stored.
export const createOnFile = (storage: Storage, allowed?: ReadonlySet<string>) =>
  async function onFile(this: FastifyRequest, part: MultipartFile) {
    const chunks: Buffer[] = [];
    for await (const chunk of part.file) chunks.push(chunk);
    const sent = Buffer.concat(chunks);
    const refused = allowed && !part.file.truncated && !allowed.has(sha256Of(sent));
    const stored = refused ? notAllowed : await toPdf(sent, part.file.truncated);
    const rejection = stored instanceof Uint8Array ? undefined : stored;
    // The stored PDF's digest identifies the invoice, so an image and its PDF wrapper are one upload.
    const bytes = stored instanceof Uint8Array ? stored : sent;
    const sha256 = sha256Of(bytes);
    if (!rejection) await storage.put(sha256, bytes);
    uploads.set(this, [...(uploads.get(this) ?? []), { fieldname: part.fieldname, filename: part.filename, sha256, rejection }]);
    // Schema validation sees the digest string in place of the file bytes.
    Object.assign(part, { value: sha256 });
  };

export const uploadsOf = (req: FastifyRequest, field: string) =>
  (uploads.get(req) ?? []).filter((upload) => upload.fieldname === field);
