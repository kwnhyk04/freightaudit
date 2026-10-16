import { MAX_PDF_PAGES } from '@freightaudit/contracts/limits';
import { PDFDocument } from 'pdf-lib';
import { PermanentError } from './errors.ts';

// Most pages one uploaded invoice PDF may have; the api and the web upload form share the number.
export const MAX_PAGES = MAX_PDF_PAGES;
// Width of a wrapped image's page: US Letter, 8.5 in at 72 points an inch. The height keeps the image's aspect ratio.
const PAGE_WIDTH = 612;

// Wraps a PNG or JPEG into a one-page PDF, so the pipeline reads every upload as a PDF. No dates are written, so the
// same image always gives the same bytes and content hash. pdf-lib decodes a PNG in memory, so callers check its
// dimensions first (checkUpload in @freightaudit/contracts/limits).
export async function imageToPdf(bytes: Uint8Array, type: 'png' | 'jpeg') {
  const doc = await PDFDocument.create({ updateMetadata: false });
  // A plain copy: pdf-lib reads a JPEG from offset 0 of the underlying buffer, and a small Buffer is a slice of a shared
  // pool, so it would find no start-of-image marker.
  const own = new Uint8Array(bytes);
  let image;
  try {
    image = type === 'png' ? await doc.embedPng(own) : await doc.embedJpg(own);
  } catch (err) {
    throw new PermanentError(`file is not a readable ${type === 'png' ? 'PNG' : 'JPG'}`, { cause: err });
  }
  const height = (PAGE_WIDTH * image.height) / image.width;
  doc.addPage([PAGE_WIDTH, height]).drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height });
  return doc.save();
}

// Parses a PDF and walks its page tree; unreadable, encrypted or empty files are permanent failures.
export async function readPdf(bytes: Uint8Array) {
  let doc: PDFDocument;
  let pages: number;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // Loading is lazy: a file with a header but no catalog only fails here.
    pages = doc.getPageCount();
  } catch (err) {
    throw new PermanentError('file is not a readable PDF', { cause: err });
  }
  if (pages === 0) throw new PermanentError('PDF has no pages');
  return doc;
}

// One PDF per 1-based inclusive page range. No dates are written, so splitting a file again gives the same bytes.
export function splitPdf(source: PDFDocument, ranges: [from: number, to: number][]) {
  return Promise.all(
    ranges.map(async ([from, to]) => {
      const part = await PDFDocument.create({ updateMetadata: false });
      const pages = await part.copyPages(source, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
      for (const page of pages) part.addPage(page);
      return part.save();
    }),
  );
}
