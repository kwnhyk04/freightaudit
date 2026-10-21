import { checkUpload } from '@freightaudit/contracts/limits';
import { pickProblem, progressLabel, RETRYABLE, retryCode, sizeLabel, uploadedToast, uploadLabel } from './uploads.ts';

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

test('a picked file shows its size as people read it', () => {
  expect(sizeLabel(312 * 1024)).toBe('312 KB');
  expect(sizeLabel(1_258_291)).toBe('1.2 MB');
  expect(sizeLabel(10)).toBe('1 KB');
});

test('a picked file says why the api would refuse it, by its type, size, pages or the golden set, and else nothing', () => {
  const ok = checkUpload(pdf, 5);
  expect(pickProblem(ok, 5, 1, undefined, null)).toBeUndefined();
  expect(pickProblem(checkUpload(new Uint8Array([1, 2, 3]), 3), 3, undefined, undefined, null)).toBe("It isn't a PDF, PNG or JPG.");
  const big = Math.round(6.2 * 1024 * 1024);
  expect(pickProblem(checkUpload(pdf, big), big, undefined, undefined, null)).toBe('The file is 6.2 MB; the limit is 4 MB.');
  expect(pickProblem(ok, 5, 21, undefined, null)).toBe('It has 21 pages; the limit is 20.');
  expect(pickProblem(ok, 5, 20, undefined, null)).toBeUndefined();
  // On the demo the api accepts only the golden set's files, by digest, and says so in these words.
  const golden = ['b'.repeat(64)];
  expect(pickProblem(ok, 5, 1, 'a'.repeat(64), golden)).toBe('This demo accepts only the sample invoices of the golden set.');
  expect(pickProblem(ok, 5, 1, 'b'.repeat(64), golden)).toBeUndefined();
  // Until its digest is read, nothing is said of the golden set; without an allowlist any file may go.
  expect(pickProblem(ok, 5, 1, undefined, golden)).toBeUndefined();
  expect(pickProblem(ok, 5, 1, 'a'.repeat(64), null)).toBeUndefined();
});

test('the upload button counts the files it sends, and says how far it is while sending', () => {
  expect(uploadLabel(1)).toBe('Upload 1 invoice');
  expect(uploadLabel(3)).toBe('Upload 3 invoices');
  expect(progressLabel(2, 3)).toBe('Uploading 2 of 3…');
});

test('after a batch a toast counts the new uploads; only a busy api, a rate limit or no answer offers Retry', () => {
  expect(uploadedToast(3)).toBe('3 invoices uploaded. Reading now.');
  expect(uploadedToast(1)).toBe('1 invoice uploaded. Reading now.');
  expect(retryCode(429)).toBe('RATE_LIMITED');
  expect(retryCode(503)).toBe('BUSY');
  for (const status of [400, 403, 413, 415, 500]) expect(retryCode(status)).toBeUndefined();
  expect([...RETRYABLE].sort()).toEqual(['BUSY', 'RATE_LIMITED', 'UNAVAILABLE']);
});
