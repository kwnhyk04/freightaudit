import type { InvoiceBriefQuery } from '@freightaudit/contracts/graphql';
import { MAX_PDF_PAGES, MAX_UPLOAD_LABEL, type UploadCheck } from '@freightaudit/contracts/limits';

// The upload page's words and rules for the files a reviewer picks, before and while they are sent. Pure, so the browser
// and the tests load it alike.

// A size as people read it: 312 KB, 1.2 MB.
export const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Why the api would refuse a picked file: the checks it runs (`checkUpload`), its page count once read, and on the demo
// the golden set's digests, in the api's own words; undefined while nothing says so.
export function pickProblem(check: UploadCheck, size: number, pages: number | undefined, digest: string | undefined, allowlist: readonly string[] | null) {
  if (!check.ok) {
    if (check.detail.startsWith('file is larger')) return `The file is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_LABEL}.`;
    if (check.detail.startsWith('file must be')) return "It isn't a PDF, PNG or JPG.";
    return `${check.detail.charAt(0).toUpperCase()}${check.detail.slice(1)}.`;
  }
  if (pages !== undefined && pages > MAX_PDF_PAGES) return `It has ${pages} pages; the limit is ${MAX_PDF_PAGES}.`;
  if (allowlist && digest && !allowlist.includes(digest)) return 'This demo accepts only the sample invoices of the golden set.';
  return undefined;
}

// The upload button's words: how many files it sends, or how far it is while sending.
export const uploadLabel = (count: number) => `Upload ${count} invoice${count === 1 ? '' : 's'}`;
export const progressLabel = (at: number, of: number) => `Uploading ${at} of ${of}…`;

// The toast after a batch, counting the new uploads.
export const uploadedToast = (count: number) => `${count} invoice${count === 1 ? '' : 's'} uploaded. Reading now.`;

// The codes of an upload that may work if sent again: the api busy (503), its rate limit (429), or no answer.
export const RETRYABLE = new Set(['BUSY', 'RATE_LIMITED', 'UNAVAILABLE']);
export const retryCode = (status: number) => (status === 429 ? 'RATE_LIMITED' : status === 503 ? 'BUSY' : undefined);

// A file the reviewer picked: listed until removed, cleared or uploaded, and sent only by Upload. checked says this
// browser has read it; problem is why the api would refuse it, and such a file is never sent.
export type Picked = {
  id: string;
  file: File;
  checked: boolean;
  pages?: number;
  thumb?: string;
  problem?: string;
  state: 'ready' | 'queued' | 'sending' | 'existing' | 'failed';
  reason?: string;
  retry?: boolean;
  existing?: NonNullable<InvoiceBriefQuery['invoice']>;
};

// The list once a sent file answers. A new invoice takes the file off, since Recent uploads shows it; an exact duplicate
// stays with the invoice it already is, and a refusal with its reason. A refusal worth retrying ends the batch, so the
// files it had not sent yet go back to waiting, listed and counted.
export function answered(list: Picked[], id: string, answer: { error?: string; code?: string; existing?: Picked['existing'] }, unsent: readonly string[]): Picked[] {
  if (!answer.existing && !answer.error) return list.filter((each) => each.id !== id);
  const stop = !answer.existing && RETRYABLE.has(answer.code ?? '');
  return list.map((each): Picked => {
    if (each.id !== id) return stop && unsent.includes(each.id) ? { ...each, state: 'ready' } : each;
    return answer.existing ? { ...each, state: 'existing', existing: answer.existing } : { ...each, state: 'failed', reason: answer.error, retry: stop };
  });
}
