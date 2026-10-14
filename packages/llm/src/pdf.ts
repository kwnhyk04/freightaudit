import { PDFDocument } from 'pdf-lib';
import { PermanentError } from './errors.ts';

// Most pages one uploaded invoice PDF may have.
export const MAX_PAGES = 20;

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
