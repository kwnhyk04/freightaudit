// Golden set v2's four layouts, each with the carrier and a document title on one line (6b's remit misread), plus the
// marks a real invoice picks up on its way in: stamps, fax headers, copy labels, revision notices and notes.
import { CHARGE_CODES, type ChargeCode } from '@freightaudit/db';
import { dmyDate, esc, figure, handwriting, type InvoiceFixture, longDate, money, page, type Party, party, pro, TEMPLATES, title, usDate } from './templates.ts';

// Numbers and dates v2's layouts print beside the PRO and the invoice date.
export type Refs = { bol: string; po: string; shipped_on: string; delivered_on: string };
// A v2 invoice: v1's fixture, with subtotal and tax as printed (null when not), and what the v2 layouts print besides.
export type InvoiceV2 = InvoiceFixture & { subtotal_cents: number | null; tax_cents: number | null; refs?: Refs; factor?: Party; revised_from?: string };
export type Overlay =
  | { mark: 'stamp'; word: string; date: string; color: 'red' | 'blue' }
  | { mark: 'fax'; date: string; time: string; from: string; page: number; of: number }
  | { mark: 'copy'; label: string }
  | { mark: 'revised'; old: string }
  | { mark: 'note'; text: string };

// Each fictional carrier's own words for the charges; no wording names two charges (templates-v2.test.ts).
export const WORDING: Record<string, Record<ChargeCode, string>> = {
  'Halcyon Ridge Freight': { LINEHAUL: 'Line haul', FUEL: 'FSC', LIFTGATE: 'Lift gate', RESIDENTIAL: 'Residential delivery fee', INSIDE_DELIVERY: 'Inside del.', LIMITED_ACCESS: 'Limited access', APPOINTMENT: 'Appointment fee', DETENTION: 'Detention' },
  'Copperline Haulage': { LINEHAUL: 'Transportation', FUEL: 'Fuel adjustment', LIFTGATE: 'Liftgate delivery', RESIDENTIAL: 'Resi delivery', INSIDE_DELIVERY: 'Inside delivery', LIMITED_ACCESS: 'Ltd access delivery', APPOINTMENT: 'Delivery appt.', DETENTION: 'Waiting time' },
  'Bramblewood Express': { LINEHAUL: 'Freight charges', FUEL: 'Fuel surcharge (FSC)', LIFTGATE: 'Power liftgate', RESIDENTIAL: 'Residential surcharge', INSIDE_DELIVERY: 'Inside delivery fee', LIMITED_ACCESS: 'Restricted access', APPOINTMENT: 'Scheduled appointment', DETENTION: 'Driver detention' },
  'Tern & Tide Carriers': { LINEHAUL: 'Linehaul transportation', FUEL: 'Fuel', LIFTGATE: 'Liftgate fee', RESIDENTIAL: 'Residential', INSIDE_DELIVERY: 'Inside service', LIMITED_ACCESS: 'Limited access fee', APPOINTMENT: 'Appt. delivery', DETENTION: 'Detention (waiting time)' },
  'Quarry Lane Transport': { LINEHAUL: 'Base freight', FUEL: 'Fuel adj. (FSC)', LIFTGATE: 'Lift gate service', RESIDENTIAL: 'Non-commercial delivery', INSIDE_DELIVERY: 'Delivery inside', LIMITED_ACCESS: 'Ltd. access', APPOINTMENT: 'Call for appointment', DETENTION: 'Truck detention' },
  'Nimbus Road Lines': { LINEHAUL: 'Line haul freight', FUEL: 'Diesel fuel surcharge', LIFTGATE: 'Liftgate', RESIDENTIAL: 'Home delivery', INSIDE_DELIVERY: 'Inside delivery charge', LIMITED_ACCESS: 'Limited access location', APPOINTMENT: 'Notify / appointment', DETENTION: 'Detention time' },
};
// A line's wording on the carrier form, with a credit or adjustment named after its charge.
export const carrierWording = (carrier: string, code: ChargeCode, plain: string) => plain.replace(CHARGE_CODES[code], WORDING[carrier]![code]);

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
// What the carrier asks if paid within 10 days: 2 % off, in whole cents.
export const earlyPay = (total: number) => Number((BigInt(total) * 98n) / 100n);
// Accounting style for the carrier form: the figure alone, and a credit in parentheses.
const acct = (inv: InvoiceFixture, cents: number) => (cents < 0 ? `(${figure(inv, -cents)})` : figure(inv, cents));
// A landscape Letter page that has the same size on screen and in print.
const landscapePage = (css: string, body: string) =>
  page(`@page { size: Letter landscape } body { width: 11in; height: 8.5in } ${css}`, body).replace('@page { size: Letter; margin: 0 }', '@page { margin: 0 }');

// Transport charges left, accessorials right, under a factoring company named as payee.
const twoColumn = (inv: InvoiceV2) => {
  const transport = (code: string) => code === 'LINEHAUL' || code === 'FUEL';
  const rows = (lines: InvoiceV2['line_items']) =>
    lines.length === 0 ? '<tr><td>None</td><td></td></tr>' : lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`).join('');
  return [
    page(
      `body { font: 11px Helvetica, Arial, sans-serif } header { display: flex; justify-content: space-between; gap: 0.4in; border-bottom: 2px solid #1d1d1d; padding-bottom: 8px }
       h1 { font-size: 20px; margin: 0 0 6px } .remit { width: 2.6in; border: 1px solid #555; padding: 6px; font-size: 12px }
       .cols { display: flex; gap: 0.3in; margin-top: 14px } .cols > * { flex: 1 } h3 { margin: 8px 0 2px; font-size: 11px; text-transform: uppercase; color: #555 }
       caption { text-align: left; font-weight: bold; padding-bottom: 4px } .charges td { padding: 4px 0; border-bottom: 1px solid #ccc }
       .total { margin-top: 16px; text-align: right; font-size: 15px; font-weight: bold }`,
      `<header><div><h1>${esc(inv.carrier)} | ${title(inv, 'Freight Invoice', 'Credit Memo')}</h1>
       Invoice No. ${esc(inv.invoice_number)} &middot; Date ${longDate(inv.invoice_date)} &middot; Due ${longDate(inv.due_date)}${pro(inv, ' &middot; PRO ')}</div>
       <div class="remit"><b>Remit payment to</b><br>${party(inv.factor!)}</div></header>
       <section class="cols"><div><h3>Bill to</h3>${party(inv.bill_to)}<h3>Shipper</h3>${party(inv.shipper)}</div>
       <div><h3>Consignee</h3>${party(inv.consignee)}<h3>Weight</h3>${inv.weight_lb.toLocaleString('en-US')} lb</div></section>
       <section class="cols"><table class="charges"><caption>Transportation</caption>${rows(inv.line_items.filter((l) => transport(l.charge_code)))}</table>
       <table class="charges"><caption>Accessorial charges</caption>${rows(inv.line_items.filter((l) => !transport(l.charge_code)))}</table></section>
       <p class="total">Total due (${inv.currency}) ${money(inv, inv.total_cents)}</p>`,
    ),
  ];
};

// A wide LTL freight bill: BOL and PO numbers beside the PRO, ship and delivery dates beside the bill date.
const landscape = (inv: InvoiceV2) => {
  const refs = inv.refs!;
  const row = (l: InvoiceV2['line_items'][number], i: number) =>
    i === 0
      ? `<tr><td>4 PLT</td><td>${esc(l.description)}</td><td>70</td><td class="r">${inv.weight_lb.toLocaleString('en-US')} lb</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`
      : `<tr><td></td><td>${esc(l.description)}</td><td></td><td></td><td class="r">${money(inv, l.amount_cents)}</td></tr>`;
  return [
    landscapePage(
      `body { font: 11px Arial, sans-serif; padding: 0.5in } h1 { margin: 0 0 10px; font-size: 20px; letter-spacing: 1px }
       th, td { border: 1px solid #555; padding: 4px 6px; text-align: left } table { margin-bottom: 10px } .total td { font-weight: bold }`,
      `<h1>${esc(inv.carrier.toUpperCase())} &mdash; ${title(inv, 'FREIGHT BILL', 'CREDIT MEMO')}</h1>
       <table><tr><th>Freight bill</th><th>Bill date</th><th>Due date</th><th>Ship date</th><th>Delivery date</th><th>PRO</th><th>BOL</th><th>PO</th></tr>
       <tr><td>${esc(inv.invoice_number)}</td><td>${usDate(inv.invoice_date)}</td><td>${usDate(inv.due_date)}</td><td>${usDate(refs.shipped_on)}</td><td>${usDate(refs.delivered_on)}</td>
       <td>${pro(inv, '')}</td><td>${esc(refs.bol)}</td><td>${esc(refs.po)}</td></tr></table>
       <table><tr><th>Shipper</th><th>Consignee</th><th>Bill to</th></tr><tr><td>${party(inv.shipper)}</td><td>${party(inv.consignee)}</td><td>${party(inv.bill_to)}</td></tr></table>
       <table><tr><th>Pcs</th><th>Description</th><th>Class</th><th class="r">Weight</th><th class="r">Charges</th></tr>${inv.line_items.map(row).join('')}
       <tr class="total"><td colspan="4">Total charges (${inv.currency})</td><td class="r">${money(inv, inv.total_cents)}</td></tr></table>`,
    ),
  ];
};

// The carrier's own form: its words for the charges, figures in accounting style, and an early-payment offer.
const carrierForm = (inv: InvoiceV2) => [
  page(
    `body { font: 12px 'Trebuchet MS', Arial, sans-serif } h1 { font-size: 20px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 4px solid #6b7c88 }
     .kv td { padding: 3px 10px 3px 0 } .kv td:nth-child(odd) { color: #555 } .charges { margin-top: 12px } .charges th { text-align: left; border-bottom: 2px solid #1d1d1d }
     .charges td { padding: 4px 0; border-bottom: 1px dotted #999 } .total td { font-weight: bold; border-top: 2px solid #1d1d1d } .early { margin-top: 14px; font-style: italic }`,
    `<h1>${title(inv, 'Freight Bill', 'Credit Memo')}: ${esc(inv.carrier)}</h1>
     <table class="kv"><tr><td>Freight Bill No.</td><td>${esc(inv.invoice_number)}</td><td>Bill Date</td><td>${dmyDate(inv.invoice_date)}</td></tr>
     <tr><td>Pro No.</td><td>${pro(inv, '')}</td><td>Terms</td><td>2% 10, net 30</td></tr></table>
     <p><b>Customer</b><br>${party(inv.bill_to)}</p>
     <p>Origin: ${esc(inv.shipper.address)}<br>Destination: ${esc(inv.consignee.address)}<br>Weight: ${inv.weight_lb} lb</p>
     <table class="charges"><tr><th>Description</th><th class="r">Amount (${inv.currency})</th></tr>
     ${inv.line_items.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${acct(inv, l.amount_cents)}</td></tr>`).join('')}
     <tr class="total"><td>Net amount due</td><td class="r">${acct(inv, inv.total_cents)}</td></tr></table>
     ${inv.total_cents > 0 ? `<p class="early">Pay ${money(inv, earlyPay(inv.total_cents))} if paid by ${longDate(addDays(inv.invoice_date, 10))}; otherwise ${money(inv, inv.total_cents)} by ${longDate(inv.due_date)}.</p>` : ''}`,
  ),
];

// Two pages: the lines run onto page 2, which alone carries the subtotal, tax and total.
const TERMS = 'Charges are due 30 days from the invoice date. Claims for loss or damage must be filed in writing within nine months of delivery. Accessorial charges follow the rate card in force on the ship date.';
const continued = (inv: InvoiceV2) => {
  const refs = inv.refs!;
  const split = Math.ceil(inv.line_items.length / 2);
  const css = `body { font: 12px Cambria, Georgia, serif } h1 { font-size: 19px; margin: 0 0 10px } h2 { font-size: 16px }
    .meta td { padding: 3px 12px 3px 0 } .meta td:nth-child(odd) { color: #555 } .parties { display: flex; gap: 0.3in; margin: 12px 0 } .parties > div { flex: 1 }
    .charges th, .sum td { text-align: left; border-bottom: 1px solid #999; padding: 4px 0 } .charges td { padding: 4px 0; border-bottom: 1px solid #ddd }
    .terms { font-size: 10px; color: #444 } .cont { margin-top: 10px; font-style: italic } .foot { position: absolute; bottom: 0.5in; right: 0.6in }
    .sum { width: 3.4in; margin: 14px 0 0 auto } .sum .total td { font-weight: bold } .stub { margin-top: 0.5in; border-top: 2px dashed #777; padding-top: 0.15in }`;
  const head = '<tr><th>Line</th><th>Description</th><th class="r">Amount</th></tr>';
  const rows = (lines: InvoiceV2['line_items']) => lines.map((l) => `<tr><td>${l.line_number}</td><td>${esc(l.description)}</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`).join('');
  return [
    page(
      css,
      `<h1>${esc(inv.carrier)} &middot; ${title(inv, 'Invoice', 'Credit Memo')} &middot; Original</h1>
       <table class="meta"><tr><td>Invoice</td><td>${esc(inv.invoice_number)}</td><td>Invoice date</td><td>${longDate(inv.invoice_date)}</td><td>Due</td><td>${longDate(inv.due_date)}</td></tr>
       <tr><td>PRO</td><td>${pro(inv, '')}</td><td>BOL</td><td>${esc(refs.bol)}</td><td>PO</td><td>${esc(refs.po)}</td></tr>
       <tr><td>Shipped</td><td>${longDate(refs.shipped_on)}</td><td>Delivered</td><td>${longDate(refs.delivered_on)}</td><td>Weight</td><td>${inv.weight_lb.toLocaleString('en-US')} lb</td></tr></table>
       <div class="parties"><div><b>Bill to</b><br>${party(inv.bill_to)}</div><div><b>Shipper</b><br>${party(inv.shipper)}</div><div><b>Consignee</b><br>${party(inv.consignee)}</div></div>
       <p class="terms">${TERMS}</p>
       <table class="charges">${head}${rows(inv.line_items.slice(0, split))}</table>
       <p class="cont">Continued on page 2</p><p class="foot">Page 1 of 2</p>`,
    ),
    page(
      css,
      `<h2>Invoice ${esc(inv.invoice_number)} (continued)</h2>
       <table class="charges">${head}${rows(inv.line_items.slice(split))}</table>
       <table class="sum"><tr><td>Subtotal</td><td class="r">${money(inv, inv.subtotal_cents ?? inv.total_cents)}</td></tr><tr><td>Tax</td><td class="r">${money(inv, inv.tax_cents ?? 0)}</td></tr>
       <tr class="total"><td>Total due (${inv.currency})</td><td class="r">${money(inv, inv.total_cents)}</td></tr></table>
       <div class="stub"><b>Remittance</b>: invoice ${esc(inv.invoice_number)}${pro(inv, ' &middot; PRO ')} &middot; Amount due ${money(inv, inv.total_cents)}</div>
       <p class="foot">Page 2 of 2</p>`,
    ),
  ];
};

export const LAYOUTS_V2 = { two_column: twoColumn, landscape, carrier_form: carrierForm, continued };
export type Layout = keyof typeof TEMPLATES | keyof typeof LAYOUTS_V2;
// Layouts that print the carrier and a document title on one line.
export const TITLE_LINE: ReadonlySet<string> = new Set(['remit', 'ledger', 'two_column', 'landscape', 'carrier_form', 'continued']);
// An invoice's pages in a layout: v1's templates are one page each.
export const pagesOf = (layout: string, inv: InvoiceV2): string[] => (layout in LAYOUTS_V2 ? LAYOUTS_V2[layout as keyof typeof LAYOUTS_V2](inv) : [TEMPLATES[layout as keyof typeof TEMPLATES](inv)]);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// A date as a rubber stamp or a fax machine prints it: JUN 24 2025.
export const stampDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)} ${iso.slice(0, 4)}`;
const INK = { red: '#c0262d', blue: '#1f4fa8' };
const on = (html: string, fragment: string) => html.replace('</body>', `${fragment}</body>`);
const mark = (overlay: Overlay, html: string) => {
  switch (overlay.mark) {
    case 'stamp':
      return on(
        html,
        `<div style="position:absolute;top:3.6in;right:1.2in;transform:rotate(-11deg);border:3px solid ${INK[overlay.color]};color:${INK[overlay.color]};padding:6px 14px;font:bold 22px 'Courier New',monospace;letter-spacing:2px;text-align:center;opacity:0.82">${esc(overlay.word)}<br>${stampDate(overlay.date)}</div>`,
      );
    case 'fax':
      return on(
        html,
        `<div style="position:absolute;top:0.12in;left:0.4in;right:0.4in;display:flex;justify-content:space-between;font:12px 'Courier New',monospace;background:#fff"><span>${stampDate(overlay.date)} ${esc(overlay.time)}</span><span>FROM: ${esc(overlay.from)}</span><span>P.${overlay.page}/${overlay.of}</span></div>`,
      );
    case 'copy':
      return on(html, `<div style="position:absolute;top:0.2in;right:0.6in;border:2px solid #1d1d1d;padding:2px 8px;font:bold 13px Arial,sans-serif;letter-spacing:3px;background:#fff">${esc(overlay.label)}</div>`);
    case 'revised':
      return on(html, `<div style="position:absolute;top:0.2in;left:0;right:0;text-align:center"><span style="background:#fff;padding:2px 8px;font:bold 13px Arial,sans-serif;color:#b42318">REVISED INVOICE: replaces invoice ${esc(overlay.old)}, which is void</span></div>`);
    case 'note':
      return handwriting(html, overlay.text);
  }
};
// The page with each mark laid on top, in order; the page itself is unchanged underneath.
export const withOverlays = (html: string, overlays: Overlay[]) => overlays.reduce((marked, overlay) => mark(overlay, marked), html);
