import { faker } from '@faker-js/faker';
import { CHARGE_CODES } from '@freightaudit/db';
import { billShipment, buildSeed, type Overcharge } from '@freightaudit/db/scripts/seed';
import { createCipheriv, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { figure, type InvoiceFixture, TEMPLATES } from './templates.ts';

// Renders synthetic invoices to digital PDFs plus scanned variants, each beside its ground-truth JSON.
// Usage: pnpm fixtures [--count=60] [--seed=42] [--out=<dir>]; output defaults to evals/fixtures/out (git-ignored).
// The same seed gives byte-identical files on one machine and Chromium build; other fonts or builds render differently.
// Each invoice bills a shipment the small seed leaves unbilled, under its rate cards, so it reconciles against a
// database seeded with --scale=small, and the ground truth gives what that reconciliation must find.

// Letter at 96 CSS px per inch; device scale 2 rasterizes scans at 192 dpi.
const VIEWPORT = { width: 816, height: 1056 };
const SCAN = { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 };
// Share of invoices with one planted overcharge.
const PLANTED = 0.4;

export type Seeded = ReturnType<typeof buildSeed>;
export type Template = keyof typeof TEMPLATES;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as Template[];

export const day = (date: Date) => date.toISOString().slice(0, 10);
export const party = () => ({
  name: faker.company.name(),
  address: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state({ abbreviated: true })} ${faker.location.zipCode('#####')}`,
});

// An invoice for a shipment, billed under the version in force on its ship date, with one planted overcharge when
// `plant` says so (of that type when it names one).
export function makeInvoice(
  seeded: Seeded,
  shipment: Seeded['shipments'][number],
  { plant = faker.datatype.boolean(PLANTED), extras = 3 }: { plant?: boolean | Overcharge['type']; extras?: number } = {},
): InvoiceFixture {
  const { items, overcharges } = billShipment(seeded.cards.get(shipment.carrierId)!, shipment, extras, plant);
  const issued = new Date(Date.parse(shipment.shippedOn) + faker.number.int({ min: 1, max: 10 }) * 86_400_000);
  const lineItems = items.map((item, i) => ({
    line_number: i + 1,
    description: CHARGE_CODES[item.code],
    charge_code: item.code,
    amount_cents: Number(item.billed),
    expected_cents: Number(item.expected),
  }));
  return {
    carrier: seeded.carriers.find((carrier) => carrier.id === shipment.carrierId)!.name,
    invoice_number: faker.string.numeric(8),
    invoice_date: day(issued),
    due_date: day(new Date(issued.getTime() + 30 * 86_400_000)),
    pro_number: shipment.proNumber,
    currency: 'USD',
    bill_to: party(),
    shipper: party(),
    consignee: party(),
    weight_lb: shipment.weightLb,
    line_items: lineItems,
    total_cents: lineItems.reduce((sum, item) => sum + item.amount_cents, 0),
    overcharges: overcharges.map((found) => ({
      line_number: found.lineNumber,
      type: found.type,
      expected_cents: Number(found.expectedCents),
      billed_cents: Number(found.billedCents),
    })),
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

// Ground truth is only fair if the page prints it: the identifiers and every amount must be visible.
export async function assertPrinted(page: Page, invoice: InvoiceFixture, label: string) {
  const text = (await page.innerText('body')).toUpperCase();
  const printed = [
    invoice.carrier,
    invoice.invoice_number,
    ...(invoice.pro_number === null ? [] : [invoice.pro_number]),
    // Without the sign, which a credit memo prints before the currency symbol (-$2,130.76).
    figure(invoice, Math.abs(invoice.total_cents)),
    ...invoice.line_items.map((l) => figure(invoice, Math.abs(l.amount_cents))),
  ];
  const missing = printed.find((value) => !text.includes(value.toUpperCase()));
  if (missing) throw new Error(`${label} does not show ${missing}`);
}

// A digital PDF of one HTML page, its dates pinned to the invoice date; the page keeps the content for checks.
export async function printPdf(page: Page, html: string, isoDay: string) {
  await page.setContent(html);
  return pinDates(await page.pdf({ format: 'Letter', printBackground: true }), isoDay);
}

// HTML pages scanned one by one, each with its own tilt and speckle, bound into one image-only PDF.
export async function scanPdf(page: Page, htmls: string[], isoDay: string) {
  const images: Buffer[] = [];
  const rotations: number[] = [];
  for (const html of htmls) {
    await page.setContent(html);
    const degrees = faker.number.float({ min: -2, max: 2, fractionDigits: 2 });
    rotations.push(degrees);
    images.push(await scan(await page.screenshot(), degrees, faker.number.int({ max: 0xffff_ffff })));
  }
  await page.setContent(
    `<style>@page { size: Letter; margin: 0 } body { margin: 0 } img { display: block; width: 8.5in; height: 11in }</style>
         ${images.map((image) => `<img src="data:image/jpeg;base64,${image.toString('base64')}">`).join('')}`,
  );
  return { pdf: pinDates(await page.pdf({ format: 'Letter' }), isoDay), rotations };
}

// One Chromium page sized for Letter, with the scan's device scale, for the renders above.
export async function withPage<T>(work: (page: Page) => Promise<T>) {
  const browser = await chromium.launch();
  try {
    return await work(await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 }));
  } finally {
    await browser.close();
  }
}

export async function generateInvoices({ count, out, seed = 42 }: { count: number; out: string; seed?: number }) {
  await mkdir(out, { recursive: true });
  const seeded = buildSeed('small');
  if (count > seeded.unbilled.length) throw new RangeError(`count must be at most ${seeded.unbilled.length}, the shipments the small seed leaves unbilled`);
  faker.seed(seed);
  const shipments = faker.helpers.arrayElements(seeded.unbilled, count);
  await withPage(async (page) => {
    for (let n = 1; n <= count; n++) {
      const invoice = makeInvoice(seeded, shipments[n - 1]!);
      const template = TEMPLATE_NAMES[(n - 1) % TEMPLATE_NAMES.length]!;
      const stem = join(out, `invoice-${String(n).padStart(4, '0')}`);
      const html = TEMPLATES[template](invoice);
      const pdf = await printPdf(page, html, invoice.invoice_date);
      await assertPrinted(page, invoice, `Template ${template}`);
      await writeFile(`${stem}.pdf`, pdf);
      await writeFile(`${stem}.json`, `${JSON.stringify({ ...invoice, template, variant: 'digital' }, null, 2)}\n`);
      const { pdf: scanned, rotations } = await scanPdf(page, [html], invoice.invoice_date);
      await writeFile(`${stem}-scanned.pdf`, scanned);
      await writeFile(`${stem}-scanned.json`, `${JSON.stringify({ ...invoice, template, variant: 'scanned', rotation_deg: rotations[0] }, null, 2)}\n`);
    }
  });
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
