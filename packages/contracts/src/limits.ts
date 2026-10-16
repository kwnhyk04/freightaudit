// Upload limits that the api enforces and the web upload form checks first, so both refuse the same files. No Node
// imports: the browser loads this module.

// 4 MiB: under Vercel's 4.5 MB cap on a function's request and response body, which uploads and documents pass through.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '4 MB';
// Most pages one uploaded PDF may have.
export const MAX_PDF_PAGES = 20;
// pdf-lib decodes a PNG in memory, and pdf.js decodes a JPEG when the worker renders it, so image size is capped too.
export const MAX_IMAGE_SIDE = 10_000;
export const MAX_IMAGE_PIXELS = 25_000_000;

export type UploadType = 'pdf' | 'png' | 'jpeg';
export type UploadCheck = { ok: true; type: UploadType } | { ok: false; status: 413 | 415; detail: string };

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((byte, i) => bytes[i] === byte);

// The type a file's first bytes declare, whatever its name or Content-Type says.
export function uploadTypeOf(bytes: Uint8Array): UploadType | undefined {
  if (startsWith(bytes, PDF)) return 'pdf';
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpeg';
  return undefined;
}

// Width and height from a PNG's IHDR chunk or a JPEG's start-of-frame segment, without decoding a pixel; undefined when
// the header is missing or cut off.
export function imageSize(bytes: Uint8Array, type: 'png' | 'jpeg'): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'png') {
    // Signature (8 bytes), the IHDR chunk's length (4) and name (4), then width and height, big-endian.
    const ihdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
    return bytes.length >= 24 && ihdr ? { width: view.getUint32(16), height: view.getUint32(20) } : undefined;
  }
  // JPEG: walk the segments after SOI to the first SOFn marker (C0 to CF except C4, C8 and CC, which are tables).
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // a fill byte before the marker
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

// Whether a file may be uploaded, from its bytes and size alone. The api also counts a PDF's pages and checks the size
// of an image's PDF wrapper, which need a PDF library.
export function checkUpload(bytes: Uint8Array, size = bytes.length): UploadCheck {
  if (size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, detail: `file is larger than ${MAX_UPLOAD_LABEL}` };
  const type = uploadTypeOf(bytes);
  if (!type) return { ok: false, status: 415, detail: 'file must be a PDF, PNG or JPG' };
  if (type === 'pdf') return { ok: true, type };
  const dimensions = imageSize(bytes, type);
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    return { ok: false, status: 415, detail: `file is not a readable ${type === 'png' ? 'PNG' : 'JPG'}` };
  }
  const { width, height } = dimensions;
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    const side = MAX_IMAGE_SIDE.toLocaleString('en-US');
    return { ok: false, status: 413, detail: `image is larger than ${side} pixels a side or ${MAX_IMAGE_PIXELS / 1e6} megapixels` };
  }
  return { ok: true, type };
}
