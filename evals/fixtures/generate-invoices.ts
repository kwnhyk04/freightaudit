import { faker } from '@faker-js/faker';
import { CARRIERS, CHARGE_CODES, type ChargeCode } from '@freightaudit/db';
import { createCipheriv, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { amount, TEMPLATES, type InvoiceFixture } from './templates.ts';

// Renders synthetic invoices to digital PDFs plus scanned variants, each beside its ground-truth JSON.
// Usage: pnpm fixtures [--count=60] [--seed=42] [--out=<dir>]; output defaults to evals/fixtures/out (git-ignored).
// The same seed gives byte-identical files on one machine and Chromium build; other fonts or builds render differently.

// Letter at 96 CSS px per inch; device scale 2 rasterizes scans at 192 dpi.
const VIEWPORT = { width: 816, height: 1056 };
const SCAN = { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 };
const ACCESSORIALS = (Object.keys(CHARGE_CODES) as ChargeCode[]).filter((code) => code !== 'LINEHAUL' && code !== 'FUEL');

const day = (date: Date) => date.toISOString().slice(0, 10);
const party = () => ({
  name: faker.company.name(),
  address: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state({ abbreviated: true })} ${faker.location.zipCode('#####')}`,
});

function makeInvoice(): InvoiceFixture {
  const issued = faker.date.between({ from: '2025-01-01T00:00:00Z', to: '2026-09-30T00:00:00Z' });
  const codes: ChargeCode[] = ['LINEHAUL', 'FUEL', ...faker.helpers.arrayElements(ACCESSORIALS, { min: 0, max: 3 })];
  const lineItems = codes.map((code, i) => ({
    line_number: i + 1,
    description: CHARGE_CODES[code],
    charge_code: code,
    amount_cents: faker.number.int(code === 'LINEHAUL' ? { min: 45_000, max: 180_000 } : { min: 2_500, max: 25_000 }),
  }));
  return {
    carrier: faker.helpers.arrayElement(CARRIERS),
    invoice_number: faker.string.numeric(8),
    invoice_date: day(issued),
    due_date: day(new Date(issued.getTime() + 30 * 86_400_000)),
    pro_number: faker.string.numeric(10),
    currency: 'USD',
    bill_to: party(),
    shipper: party(),
    consignee: party(),
    weight_lb: faker.number.int({ min: 150, max: 12_000 }),
    line_items: lineItems,
    total_cents: lineItems.reduce((sum, item) => sum + item.amount_cents, 0),
  };
}

// Seeded gray speckle, one byte per pixel: an AES-CTR keystream keyed by the seed is uniform noise, which libvips
// lightens to 200..255. Native code throughout; a JavaScript pixel loop runs about 100 times slower under Jest.
function speckle(seed: number) {
  const key = createHash('sha256').update(`speckle:${seed}`).digest().subarray(0, 16);
  const noise = createCipheriv('aes-128-ctr', key, Buffer.alloc(16)).update(Buffer.alloc(SCAN.width * SCAN.height));
  return sharp(noise, { raw: { ...SCAN, channels: 1 } })
    .linear(55 / 255, 200)
    .raw({ depth: 'uchar' })
    .toBuffer();
}

// A tilted, speckled, grayscale JPEG of the rendered page, cropped back to the page size.
async function scan(png: Buffer, degrees: number, noiseSeed: number) {
  const rotated = await sharp(png).rotate(degrees, { background: '#ffffff' }).toBuffer({ resolveWithObject: true });
  const left = Math.floor((rotated.info.width - SCAN.width) / 2);
  const top = Math.floor((rotated.info.height - SCAN.height) / 2);
  // Multiplying light noise in gives the paper speckle and keeps dark text dark.
  return sharp(rotated.data)
    .extract({ left, top, ...SCAN })
    .composite([{ input: await speckle(noiseSeed), raw: { ...SCAN, channels: 1 }, blend: 'multiply' }])
    .grayscale()
    .blur(0.6)
    .jpeg({ quality: 70 })
    .toBuffer();
}

// Chromium stamps the render time into /CreationDate and /ModDate; pin both to the invoice date.
// The replacement has the same length, so the cross-reference offsets stay valid.
const pinDates = (pdf: Buffer, isoDay: string) =>
  Buffer.from(
    pdf.toString('latin1').replace(/\/(CreationDate|ModDate) \(D:\d{14}/g, (_, key: string) => `/${key} (D:${isoDay.replaceAll('-', '')}000000`),
    'latin1',
  );

export async function generateInvoices({ count, out, seed = 42 }: { count: number; out: string; seed?: number }) {
  await mkdir(out, { recursive: true });
  faker.seed(seed);
  const names = Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    for (let n = 1; n <= count; n++) {
      const invoice = makeInvoice();
      const template = names[(n - 1) % names.length]!;
      const stem = join(out, `invoice-${String(n).padStart(4, '0')}`);
      await page.setContent(TEMPLATES[template](invoice));
      // Ground truth is only fair if the page prints it: the identifiers and every amount must be visible.
      const text = (await page.innerText('body')).toUpperCase();
      const printed = [invoice.carrier, invoice.invoice_number, invoice.pro_number, amount(invoice.total_cents), ...invoice.line_items.map((l) => amount(l.amount_cents))];
      const missing = printed.find((value) => !text.includes(value.toUpperCase()));
      if (missing) throw new Error(`Template ${template} does not show ${missing}`);
      await writeFile(`${stem}.pdf`, pinDates(await page.pdf({ format: 'Letter', printBackground: true }), invoice.invoice_date));
      await writeFile(`${stem}.json`, `${JSON.stringify({ ...invoice, template, variant: 'digital' }, null, 2)}\n`);

      const degrees = faker.number.float({ min: -2, max: 2, fractionDigits: 2 });
      const image = await scan(await page.screenshot(), degrees, faker.number.int({ max: 0xffff_ffff }));
      await page.setContent(
        `<style>@page { size: Letter; margin: 0 } body { margin: 0 } img { display: block; width: 8.5in; height: 11in }</style>
         <img src="data:image/jpeg;base64,${image.toString('base64')}">`,
      );
      await writeFile(`${stem}-scanned.pdf`, pinDates(await page.pdf({ format: 'Letter' }), invoice.invoice_date));
      await writeFile(`${stem}-scanned.json`, `${JSON.stringify({ ...invoice, template, variant: 'scanned', rotation_deg: degrees }, null, 2)}\n`);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '60' },
      seed: { type: 'string', default: '42' },
      out: { type: 'string', default: fileURLToPath(new URL('out', import.meta.url)) },
    },
  });
  const [count, seed] = [Number(values.count), Number(values.seed)];
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  await generateInvoices({ count, out: values.out, seed });
  console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'fixtures written', count, seed, out: values.out }));
}
