import sharp from 'sharp';
import { withPage } from './generate-invoices.ts';
import { PROFILES, type ScanSpec, scanPage } from './scan-v2.ts';
import { type InvoiceV2, pagesOf, withOverlays } from './templates-v2.ts';

const invoice: InvoiceV2 = {
  carrier: 'Nimbus Road Lines',
  invoice_number: '30417762',
  invoice_date: '2025-08-04',
  due_date: '2025-09-03',
  pro_number: '1048213377',
  currency: 'USD',
  bill_to: { name: 'Hartmann Group', address: '12 Mill Lane, Easton, PA 18042' },
  shipper: { name: 'Okuneva and Sons', address: '88 Dock Road, Akron, OH 44301' },
  consignee: { name: 'Ritchie LLC', address: '5 Elm Court, Joliet, IL 60431' },
  weight_lb: 2210,
  line_items: [
    { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 88_200, expected_cents: 88_200 },
    { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 21_168, expected_cents: 21_168 },
  ],
  total_cents: 109_368,
  subtotal_cents: null,
  tax_cents: null,
  overcharges: [],
  refs: { bol: '2209184467', po: 'PO-40112', shipped_on: '2025-07-30', delivered_on: '2025-08-01' },
};
const spec = (profile: ScanSpec['profile'], over: Partial<ScanSpec> = {}): ScanSpec => ({ profile, degrees: 1, noise: 7, sideways: false, flip: false, ...over });

test('each scan profile renders the same bytes twice, and does what it says', async () => {
  await withPage(async (page) => {
    const html = pagesOf('remit', invoice)[0]!;
    for (const profile of PROFILES) {
      const each = spec(profile, profile === 'skew' ? { degrees: -4.5 } : {});
      const [first, second] = [await scanPage(page, html, each), await scanPage(page, html, each)];
      expect({ profile, same: first.image.equals(second.image) }).toEqual({ profile, same: true });
    }
    // Low resolution: a Letter page at 96 dpi.
    expect(await sharp((await scanPage(page, html, spec('low_res'))).image).metadata()).toMatchObject({ format: 'jpeg', width: 816, height: 1056 });
    // Fax: two tones and nothing between.
    const fax = await scanPage(page, html, spec('fax'));
    expect(fax.mime).toBe('image/png');
    expect([...new Set((await sharp(fax.image).raw().toBuffer()).values())].sort((a, b) => a - b)).toEqual([0, 255]);
    // Low contrast: the darkest ink is faded grey.
    expect((await sharp((await scanPage(page, html, spec('low_contrast'))).image).stats()).channels[0]!.min).toBeGreaterThanOrEqual(80);
    // Stamp: a colour scan where the red ink shows.
    const stamped = withOverlays(html, [{ mark: 'stamp', word: 'PAID', date: '2025-08-09', color: 'red' }]);
    const { data, info } = await sharp((await scanPage(page, stamped, spec('stamp'))).image).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    let reddest = 0;
    for (let i = 0; i < data.length; i += 3) reddest = Math.max(reddest, data[i]! - data[i + 1]!);
    expect(reddest).toBeGreaterThan(60);
    // A landscape page fed sideways comes out portrait, as does a page fed upside down.
    for (const [layout, over] of [['landscape', { sideways: true }], ['remit', { flip: true }]] as const) {
      const meta = await sharp((await scanPage(page, pagesOf(layout, invoice)[0]!, spec('skew', { degrees: 3, ...over }))).image).metadata();
      expect({ layout, portrait: meta.height! > meta.width! }).toEqual({ layout, portrait: true });
    }
  });
}, 180_000);
