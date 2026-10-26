// Golden set v2's scans. Each page renders as v1's do (Chromium at 192 dpi), then its profile feeds, tilts, resamples
// and inks it: skew, faded print, low resolution, fax, or a colour scan that keeps a stamp's ink. Native code
// throughout, and the same spec always gives the same bytes.
import { createCipheriv, createHash } from 'node:crypto';
import type { Page } from 'playwright';
import sharp from 'sharp';
import { pinDates } from './generate-invoices.ts';

export const PROFILES = ['skew', 'low_contrast', 'low_res', 'fax', 'stamp'] as const;
export type Profile = (typeof PROFILES)[number];
// One scanned page: its profile, tilt in degrees, noise seed, and whether a landscape page was fed portrait (sideways)
// or the page was fed upside down (flip).
export type ScanSpec = { profile: Profile; degrees: number; noise: number; sideways: boolean; flip: boolean };
export type Scan = { image: Buffer; mime: 'image/jpeg' | 'image/png' };

// Letter at 96 CSS px per inch; withPage renders at device scale 2.
const PORTRAIT = { width: 816, height: 1056 };
const LANDSCAPE = { width: 1056, height: 816 };
// Each profile's resolution, its blur and its JPEG quality; the fax is two-tone PNG instead.
const TONE: Record<Profile, { dpi: number; blur: number; quality: number }> = {
  skew: { dpi: 150, blur: 0.6, quality: 65 },
  low_contrast: { dpi: 150, blur: 1, quality: 45 },
  low_res: { dpi: 96, blur: 0.4, quality: 60 },
  fax: { dpi: 200, blur: 0, quality: 0 },
  stamp: { dpi: 150, blur: 0.5, quality: 70 },
};
// Standard-resolution fax: 1,728 dots a line at 98 lines an inch, each line printed twice.
const FAX = { width: 1_728, rows: 1_078 };

// Paper speckle as v1 draws it: an AES-CTR keystream keyed by the seed, lightened to 200..255.
async function speckle(seed: number, width: number, height: number, channels: 1 | 3) {
  const key = createHash('sha256').update(`speckle:v2:${seed}`).digest().subarray(0, 16);
  const noise = createCipheriv('aes-128-ctr', key, Buffer.alloc(16)).update(Buffer.alloc(width * height));
  const light = sharp(noise, { raw: { width, height, channels: 1 } }).linear(55 / 255, 200);
  return (channels === 3 ? light.toColourspace('srgb') : light).raw().toBuffer({ resolveWithObject: true });
}

export async function scanPage(page: Page, html: string, spec: ScanSpec): Promise<Scan> {
  await page.setViewportSize(spec.sideways ? LANDSCAPE : PORTRAIT);
  await page.setContent(html);
  const shot = await page.screenshot();
  await page.setViewportSize(PORTRAIT);
  const tone = TONE[spec.profile];
  const width = Math.round(8.5 * tone.dpi);
  const height = Math.round(11 * tone.dpi);
  // Fed portrait, so a landscape page lies sideways; then resampled to the profile's resolution.
  const fed = await sharp(await sharp(shot).rotate(spec.sideways ? 90 : 0).toBuffer()).resize(width, height, { fit: 'fill' }).toBuffer();
  const tilted = await sharp(fed).rotate((spec.flip ? 180 : 0) + spec.degrees, { background: '#ffffff' }).toBuffer({ resolveWithObject: true });
  const area = { left: Math.floor((tilted.info.width - width) / 2), top: Math.floor((tilted.info.height - height) / 2), width, height };
  const cropped = await sharp(tilted.data).extract(area).toBuffer();
  if (spec.profile === 'fax') {
    const lines = await sharp(cropped).grayscale().resize(FAX.width, FAX.rows, { fit: 'fill' }).toBuffer();
    const image = await sharp(lines).resize(FAX.width, FAX.rows * 2, { fit: 'fill', kernel: 'nearest' }).threshold(160).toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer();
    return { image, mime: 'image/png' };
  }
  // Multiplying light noise in gives the paper speckle and keeps dark ink dark; only the stamp profile keeps colour.
  const colour = spec.profile === 'stamp';
  const noise = await speckle(spec.noise, width, height, colour ? 3 : 1);
  const inked = await sharp(cropped)
    .composite([{ input: noise.data, raw: { width, height, channels: noise.info.channels }, blend: 'multiply' }])
    .toBuffer();
  let toned = colour ? sharp(inked).removeAlpha() : sharp(inked).grayscale();
  // Faded print: the darkest ink lifted to grey.
  if (spec.profile === 'low_contrast') toned = sharp(await toned.toBuffer()).linear(0.5, 120);
  const image = await toned.blur(tone.blur).jpeg({ quality: tone.quality }).toBuffer();
  return { image, mime: 'image/jpeg' };
}

// Scanned pages bound into one image-only PDF, its dates pinned to the invoice date.
export async function bindScans(page: Page, scans: Scan[], isoDay: string) {
  await page.setContent(
    `<style>@page { size: Letter; margin: 0 } body { margin: 0 } img { display: block; width: 8.5in; height: 11in }</style>
     ${scans.map(({ image, mime }) => `<img src="data:${mime};base64,${image.toString('base64')}">`).join('')}`,
  );
  return pinDates(await page.pdf({ format: 'Letter' }), isoDay);
}
