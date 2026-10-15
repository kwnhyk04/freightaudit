import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Loading the worker module runs pdf.js on this thread, with no worker file to find at run time.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { PermanentError } from './errors.ts';
import type { Part } from './extract.ts';

// Page images are about this wide: printed amounts stay legible, and a page costs one image's tokens.
const PAGE_WIDTH_PX = 1_000;
// A scanned page is 0.29 MB as JPEG at this quality against 1.54 MB as PNG, so 20 pages fit one 20 MB Gemini request.
const JPEG_QUALITY = 80;

// Each page as the model will read it: its text layer when that has at least minChars non-space characters (a digital
// page), else a JPEG render (a scan).
export async function readPages(pdf: Uint8Array, minChars: number): Promise<Part[]> {
  // pdf.js takes over the buffer it is given and refuses a Buffer, so it gets a plain copy.
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const doc = await task.promise;
    const parts: Part[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const pdfPage = await doc.getPage(page);
      const { items } = await pdfPage.getTextContent();
      const text = items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      if (text.replace(/\s/g, '').length >= minChars) {
        parts.push({ page, text });
        continue;
      }
      const viewport = pdfPage.getViewport({ scale: PAGE_WIDTH_PX / pdfPage.getViewport({ scale: 1 }).width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await pdfPage.render({ canvas, viewport }).promise;
      parts.push({ page, jpeg: await canvas.encode('jpeg', JPEG_QUALITY) });
    }
    return parts;
  } catch (err) {
    throw new PermanentError('PDF pages could not be read', { cause: err });
  } finally {
    await task.destroy();
  }
}
