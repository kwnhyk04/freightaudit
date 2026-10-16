import { checkUpload, imageSize, MAX_UPLOAD_BYTES, uploadTypeOf } from './limits.ts';

const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const png = (width: number, height: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
// SOI, an APP0 segment (as JFIF files start), then a baseline SOF0 frame header.
const jpeg = (width: number, height: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...u16(16), ...new Array(14).fill(0), 0xff, 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3]);
const pdf = new TextEncoder().encode('%PDF-1.7\n');

test('the type comes from the first bytes', () => {
  expect(uploadTypeOf(pdf)).toBe('pdf');
  expect(uploadTypeOf(png(10, 10))).toBe('png');
  expect(uploadTypeOf(jpeg(10, 10))).toBe('jpeg');
  expect(uploadTypeOf(new TextEncoder().encode('GIF89a'))).toBeUndefined();
  expect(uploadTypeOf(new Uint8Array())).toBeUndefined();
});

test('image size is read from the PNG and JPEG headers, and a cut-off header gives none', () => {
  expect(imageSize(png(2550, 3300), 'png')).toEqual({ width: 2550, height: 3300 });
  expect(imageSize(jpeg(4032, 3024), 'jpeg')).toEqual({ width: 4032, height: 3024 });
  expect(imageSize(png(10, 10).subarray(0, 20), 'png')).toBeUndefined();
  expect(imageSize(jpeg(10, 10).subarray(0, 22), 'jpeg')).toBeUndefined();
});

test('checkUpload refuses what the api refuses, with its status and detail', () => {
  expect(checkUpload(pdf)).toEqual({ ok: true, type: 'pdf' });
  expect(checkUpload(jpeg(4000, 3000))).toEqual({ ok: true, type: 'jpeg' });
  expect(checkUpload(pdf, MAX_UPLOAD_BYTES + 1)).toEqual({ ok: false, status: 413, detail: 'file is larger than 4 MB' });
  expect(checkUpload(new TextEncoder().encode('GIF89a'))).toMatchObject({ ok: false, status: 415 });
  expect(checkUpload(png(0, 10))).toEqual({ ok: false, status: 415, detail: 'file is not a readable PNG' });
  expect(checkUpload(png(10_001, 10))).toMatchObject({ ok: false, status: 413 });
  // 6,000 x 5,000 is 30 megapixels: each side is allowed, the area is not.
  expect(checkUpload(png(6000, 5000))).toEqual({
    ok: false,
    status: 413,
    detail: 'image is larger than 10,000 pixels a side or 25 megapixels',
  });
});
