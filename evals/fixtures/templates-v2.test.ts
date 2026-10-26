import { CARRIERS, CHARGE_CODES } from '@freightaudit/db';
import { figure } from './templates.ts';
import { earlyPay, type InvoiceV2, LAYOUTS_V2, pagesOf, stampDate, TITLE_LINE, withOverlays, WORDING } from './templates-v2.ts';

// One invoice with a credit line, and the extras v2's layouts print beside it.
const invoice: InvoiceV2 = {
  carrier: 'Quarry Lane Transport',
  invoice_number: '81691949',
  invoice_date: '2025-06-19',
  due_date: '2025-07-19',
  pro_number: '1029387409',
  currency: 'USD',
  bill_to: { name: 'Gutmann Group', address: '61 High Road, Parkerfurt, IN 04858' },
  shipper: { name: 'Senger and Sons', address: '4510 E Walnut Street, Yuma, AZ 85364' },
  consignee: { name: 'Pacocha LLC', address: '464 Weber Views, Port Arvel, VA 23270' },
  weight_lb: 3713,
  line_items: [
    { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 103_400, expected_cents: 103_400 },
    { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 31_134, expected_cents: 31_134 },
    { line_number: 3, description: 'Inside delivery', charge_code: 'INSIDE_DELIVERY', amount_cents: 15_554, expected_cents: 15_554 },
    { line_number: 4, description: 'Fuel surcharge adjustment (credit)', charge_code: 'FUEL', amount_cents: -3_113, expected_cents: -3_113 },
  ],
  total_cents: 146_975,
  subtotal_cents: 146_975,
  tax_cents: 0,
  overcharges: [],
  refs: { bol: '4471020093', po: 'PO-88213', shipped_on: '2025-06-12', delivered_on: '2025-06-14' },
  factor: { name: 'Lindgren Capital Funding', address: 'P.O. Box 50121, Dayton, OH 45401' },
};
// What a page shows, without its markup.
const ENTITIES: Record<string, string> = { mdash: '—', middot: '·', nbsp: ' ' };
const text = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&(\w+);/g, (_, name: string) => ENTITIES[name] ?? `&${name};`)
    .replace(/\s+/g, ' ')
    .trim();
const heading = (html: string) => text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '');

test('every v2 layout prints the carrier, the numbers, each line amount and the total', () => {
  for (const layout of Object.keys(LAYOUTS_V2)) {
    const shown = pagesOf(layout, invoice).map(text).join(' ').toUpperCase();
    const printed = [invoice.carrier, invoice.invoice_number, invoice.pro_number!, figure(invoice, invoice.total_cents), ...invoice.line_items.map((line) => figure(invoice, Math.abs(line.amount_cents)))];
    expect(printed.filter((value) => !shown.includes(value.toUpperCase())).map((value) => `${layout}: ${value}`)).toEqual([]);
  }
});

test('each title line is one heading: the carrier and the document title together, as in remit and ledger', () => {
  expect(heading(pagesOf('two_column', invoice)[0]!)).toBe('Quarry Lane Transport | Freight Invoice');
  expect(heading(pagesOf('landscape', invoice)[0]!)).toBe('QUARRY LANE TRANSPORT — FREIGHT BILL');
  expect(heading(pagesOf('carrier_form', invoice)[0]!)).toBe('Freight Bill: Quarry Lane Transport');
  expect(heading(pagesOf('continued', invoice)[0]!)).toBe('Quarry Lane Transport · Invoice · Original');
  expect(heading(pagesOf('two_column', { ...invoice, kind: 'credit_memo' })[0]!)).toBe('Quarry Lane Transport | Credit Memo');
  expect(['remit', 'ledger', ...Object.keys(LAYOUTS_V2)].filter((layout) => !TITLE_LINE.has(layout))).toEqual([]);
  expect(['classic', 'modern', 'compact', 'boxed'].filter((layout) => TITLE_LINE.has(layout))).toEqual([]);
});

test('two columns hold the charges in two tables under a factor named as payee; the landscape page is landscape', () => {
  const two = pagesOf('two_column', invoice)[0]!;
  expect(two.match(/<table class="charges"/g)).toHaveLength(2);
  expect(text(two)).toContain('Remit payment to Lindgren Capital Funding');
  expect(pagesOf('landscape', invoice)[0]).toContain('size: Letter landscape');
  // v1's layouts come through as one page each, unchanged.
  expect(pagesOf('remit', invoice)).toHaveLength(1);
});

test('each carrier words every charge its own way, and no wording names two charges', () => {
  const codeOf = new Map<string, string>();
  for (const carrier of CARRIERS) {
    expect(Object.keys(WORDING[carrier]!).sort()).toEqual(Object.keys(CHARGE_CODES).sort());
    for (const [code, words] of Object.entries(WORDING[carrier]!)) {
      expect({ words, code: codeOf.get(words) ?? code }).toEqual({ words, code });
      codeOf.set(words, code);
    }
  }
});

test('the carrier form prints credits in parentheses, and an early-payment amount that is never the total', () => {
  const form = text(pagesOf('carrier_form', invoice)[0]!);
  expect(form).toContain('(31.13)');
  expect(form).not.toContain('-31.13');
  const early = earlyPay(invoice.total_cents);
  expect(early).toBe(144_035);
  expect(form).toContain(`Pay $${figure(invoice, early)} if paid by`);
});

test('a continued invoice runs onto page 2, which alone carries the subtotal, tax and total', () => {
  const pages = pagesOf('continued', invoice).map(text);
  expect(pages).toHaveLength(2);
  expect(pages[0]).toContain('Continued on page 2');
  expect(pages[0]).not.toMatch(/Total|Subtotal/);
  expect(pages[1]).toContain(`Total due (USD) $${figure(invoice, invoice.total_cents)}`);
  expect(pages[1]).toContain('Tax $0.00');
});

test('stamps, fax headers, copy labels, revision notices and notes go on top of the page', () => {
  const html = pagesOf('two_column', invoice)[0]!;
  const marked = text(
    withOverlays(html, [
      { mark: 'stamp', word: 'RECEIVED', date: '2025-06-24', color: 'red' },
      { mark: 'fax', date: '2025-06-21', time: '14:22', from: '555-0142', page: 1, of: 2 },
      { mark: 'copy', label: 'REMITTANCE COPY' },
      { mark: 'revised', old: '55512345' },
      { mark: 'note', text: 'Paid 10/14 ck 4471' },
    ]),
  );
  expect(stampDate('2025-06-24')).toBe('JUN 24 2025');
  for (const shown of ['RECEIVED JUN 24 2025', 'JUN 21 2025 14:22 FROM: 555-0142 P.1/2', 'REMITTANCE COPY', 'REVISED INVOICE: replaces invoice 55512345, which is void', 'Paid 10/14 ck 4471'])
    expect(marked).toContain(shown);
  // The page itself is unchanged underneath.
  expect(marked.startsWith(text(html))).toBe(true);
});
