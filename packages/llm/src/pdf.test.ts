import { createCanvas } from '@napi-rs/canvas';
import { PermanentError } from './errors.ts';
import { imageToPdf, readPdf } from './pdf.ts';

// A 300 x 150 image, twice as wide as it is tall.
const canvas = createCanvas(300, 150);
const png = await canvas.encode('png');
const jpeg = await canvas.encode('jpeg');

test('an image becomes a one-page PDF, the same bytes every time', async () => {
  for (const [bytes, type] of [[png, 'png'], [jpeg, 'jpeg']] as const) {
    const first = await imageToPdf(bytes, type);
    expect(Buffer.from(await imageToPdf(bytes, type)).equals(Buffer.from(first))).toBe(true);
    const doc = await readPdf(first);
    expect(doc.getPageCount()).toBe(1);
    // Letter width, with the image's aspect ratio.
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 306 });
  }
});

test('bytes that are not the image they claim to be are a permanent failure', async () => {
  await expect(imageToPdf(jpeg, 'png')).rejects.toThrow(PermanentError);
  await expect(imageToPdf(Buffer.from('not an image'), 'jpeg')).rejects.toThrow('file is not a readable JPG');
});
