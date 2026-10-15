import { loadImage } from '@napi-rs/canvas';
import { PermanentError } from './errors.ts';
import { readPages } from './pages.ts';
import { fixture } from './testing.ts';

test('a digital page goes as its text layer, a scanned one as a JPEG render about 1,000 px wide', async () => {
  const [digital] = await readPages(fixture('digital.pdf'), 100);
  expect(digital).toMatchObject({ page: 1, text: expect.stringContaining('98211354') });

  const [scanned] = await readPages(fixture('scanned.pdf'), 100);
  if (!scanned || !('jpeg' in scanned)) throw new Error('expected a rendered page');
  expect([...scanned.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const image = await loadImage(Buffer.from(scanned.jpeg));
  expect({ width: image.width, height: image.height }).toEqual({ width: 1_000, height: 1_294 });

  // The threshold decides: above the digital page's character count, it is rendered too.
  const [forced] = await readPages(fixture('digital.pdf'), 10_000);
  expect(forced && 'jpeg' in forced).toBe(true);
});

test('a file pdf.js cannot read is a permanent failure', async () => {
  await expect(readPages(new TextEncoder().encode('%PDF-1.7 no objects'), 100)).rejects.toBeInstanceOf(PermanentError);
});
