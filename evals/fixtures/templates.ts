// Six invoice layouts with different labels, date formats and structure, so extraction is scored on varied documents,
// plus the supporting pages (bill of lading, delivery receipt, terms) that come with an invoice in a scanned packet.

export type Party = { name: string; address: string };
// expected_cents is ground truth that no template prints: what the rate card version in force contracts for the line.
export type LineItem = { line_number: number; description: string; charge_code: string; amount_cents: number; expected_cents: number };
export type Overcharge = { line_number: number; type: string; expected_cents: number; billed_cents: number };
export type InvoiceFixture = {
  carrier: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  // null when the invoice prints no PRO number.
  pro_number: string | null;
  // ISO code: USD, CAD and EUR print with their own symbol, and EUR in the European number format.
  currency: string;
  // A credit memo prints negative lines and a negative total.
  kind?: 'credit_memo';
  bill_to: Party;
  shipper: Party;
  consignee: Party;
  weight_lb: number;
  line_items: LineItem[];
  total_cents: number;
  // Ground truth, never printed: every overcharge planted on the invoice.
  overcharges: Overcharge[];
};

const esc = (value: string | number) => String(value).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
// Integer cents to text without floats: 123456 becomes 1,234.56 and -123456 becomes -1,234.56.
export const amount = (cents: number) =>
  `${cents < 0 ? '-' : ''}${Math.trunc(Math.abs(cents) / 100).toLocaleString('en-US')}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
// A figure as the invoice prints it: EUR in the European format (1.234,56), every other currency as amount does.
export const figure = (inv: Pick<InvoiceFixture, 'currency'>, cents: number) =>
  inv.currency === 'EUR' ? amount(cents).replace(/[,.]/g, (mark) => (mark === ',' ? '.' : ',')) : amount(cents);
// With the currency's symbol: $1,234.56, C$1,234.56 or 1.234,56 €.
const money = (inv: InvoiceFixture, cents: number) =>
  inv.currency === 'EUR' ? `${figure(inv, cents)} €` : `${cents < 0 ? '-' : ''}${inv.currency === 'CAD' ? 'C$' : '$'}${figure(inv, Math.abs(cents))}`;
// The PRO number between two labels, or nothing when the invoice has none.
const pro = (inv: InvoiceFixture, before: string, after = '') => (inv.pro_number === null ? '' : `${before}${esc(inv.pro_number)}${after}`);
const title = (inv: InvoiceFixture, invoice: string, memo: string) => (inv.kind === 'credit_memo' ? memo : invoice);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return { year, month, day, mon: MONTHS[Number(month) - 1]! };
};
const usDate = (iso: string) => `${ymd(iso).month}/${ymd(iso).day}/${ymd(iso).year}`;
const longDate = (iso: string) => `${ymd(iso).mon} ${Number(ymd(iso).day)}, ${ymd(iso).year}`;
const dmyDate = (iso: string) => `${ymd(iso).day}-${ymd(iso).mon.toUpperCase()}-${ymd(iso).year}`;
const party = (p: Party) => `${esc(p.name)}<br>${esc(p.address)}`;

// A Letter page that has the same size on screen and in print, so the scan raster matches the PDF.
const page = (css: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; width: 8.5in; height: 11in; padding: 0.6in; color: #1d1d1d }
table { width: 100%; border-collapse: collapse }
.r { text-align: right }
${css}</style></head><body>${body}</body></html>`;

const classic = (inv: InvoiceFixture) =>
  page(
    `body { font: 12px Arial, sans-serif } h1 { margin: 0; font-size: 28px; letter-spacing: 2px }
     th { background: #eee; text-align: left } th, td { padding: 6px; border-bottom: 1px solid #ccc }
     .total td { font-weight: bold; border-top: 2px solid #1d1d1d }`,
    `<table><tr><td><h2>${esc(inv.carrier)}</h2></td><td class="r"><h1>${title(inv, 'INVOICE', 'CREDIT MEMO')}</h1>
     Invoice No.: ${esc(inv.invoice_number)}<br>Invoice Date: ${usDate(inv.invoice_date)}<br>
     Due Date: ${usDate(inv.due_date)}${pro(inv, '<br>PRO: ')}</td></tr></table>
     <p><b>Bill To</b><br>${party(inv.bill_to)}</p>
     <table><tr><th>#</th><th>Description</th><th>Code</th><th class="r">Amount</th></tr>
     ${inv.line_items.map((l) => `<tr><td>${l.line_number}</td><td>${esc(l.description)}</td><td>${l.charge_code}</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`).join('')}
     <tr class="total"><td colspan="3">Total Due (${inv.currency})</td><td class="r">${money(inv, inv.total_cents)}</td></tr></table>
     <p>Shipper: ${esc(inv.shipper.name)} &middot; Consignee: ${esc(inv.consignee.name)} &middot; Weight: ${inv.weight_lb.toLocaleString('en-US')} lb</p>`,
  );

// Dot-matrix freight bill: fixed-width text, ISO dates, amounts without a currency sign.
const ledger = (inv: InvoiceFixture) => {
  const row = (left: string, right: string) => left.padEnd(64 - right.length) + right;
  const rule = '-'.repeat(64);
  const text = [
    row(inv.carrier.toUpperCase(), title(inv, 'FREIGHT BILL', 'CREDIT MEMO')),
    '',
    row(`BILL NO   ${inv.invoice_number}`, inv.pro_number === null ? '' : `PRO NO  ${inv.pro_number}`),
    row(`BILL DATE ${inv.invoice_date}`, `DUE     ${inv.due_date}`),
    '',
    `BILL TO   ${inv.bill_to.name.toUpperCase()}`,
    `          ${inv.bill_to.address.toUpperCase()}`,
    `SHIPPER   ${inv.shipper.name.toUpperCase()}`,
    `CONSIGNEE ${inv.consignee.name.toUpperCase()}`,
    `WEIGHT    ${inv.weight_lb} LBS`,
    '',
    row('LN  DESCRIPTION', 'AMOUNT'),
    rule,
    ...inv.line_items.map((l) => row(`${String(l.line_number).padStart(2, '0')}  ${l.description.toUpperCase()}`, figure(inv, l.amount_cents))),
    rule,
    row('', `TOTAL ${inv.currency} ${figure(inv, inv.total_cents)}`),
  ].join('\n');
  return page(`body { font: 13px 'Courier New', monospace; background: #fbfbf4 } pre { font: inherit; margin: 0 }`, `<pre>${esc(text)}</pre>`);
};

const modern = (inv: InvoiceFixture) =>
  page(
    `body { font: 12px 'Segoe UI', Helvetica, sans-serif; padding: 0 }
     header { background: #23485f; color: #fff; padding: 0.4in 0.6in } header h1 { margin: 0; font-weight: 300 }
     main { padding: 0.4in 0.6in } .meta, .cards { display: flex; gap: 0.3in; margin-bottom: 0.3in } .meta > div, .cards > div { flex: 1 }
     .cards > div { border: 1px solid #d4dde3; border-radius: 6px; padding: 10px }
     .label { color: #6b7c88; font-size: 10px; text-transform: uppercase } td { padding: 8px 0; border-bottom: 1px solid #e6ecef }
     .due { margin-top: 0.3in; font-size: 22px; text-align: right }`,
    `<header><h1>${esc(inv.carrier)}</h1>${title(inv, 'Freight invoice', 'Credit memo')}</header><main>
     <div class="meta"><div><div class="label">Invoice</div>${esc(inv.invoice_number)}</div>
     <div><div class="label">Issued</div>${longDate(inv.invoice_date)}</div>
     <div><div class="label">Payment due</div>${longDate(inv.due_date)}</div>
     ${pro(inv, '<div><div class="label">Pro #</div>', '</div>')}</div>
     <div class="cards"><div><div class="label">Bill to</div>${party(inv.bill_to)}</div>
     <div><div class="label">From</div>${party(inv.shipper)}</div><div><div class="label">To</div>${party(inv.consignee)}</div></div>
     <table>${inv.line_items.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`).join('')}</table>
     <div class="due"><span class="label">Amount due</span> ${money(inv, inv.total_cents)}</div></main>`,
  );

// Freight bill with a tear-off remittance stub that repeats the bill number and total.
const remit = (inv: InvoiceFixture) =>
  page(
    `body { font: 12px Georgia, serif } h1 { font-size: 22px; border-bottom: 3px double #1d1d1d }
     th, td { padding: 5px; border: 1px solid #999 } th { text-align: left }
     .stub { margin-top: 0.5in; border-top: 2px dashed #777; padding-top: 0.2in; line-height: 1.8 }`,
    `<h1>${esc(inv.carrier)} &mdash; ${title(inv, 'Freight Bill', 'Credit Memo')}</h1>
     <table><tr><th>Freight Bill #</th><th>Bill Date</th><th>Pro Number</th><th>Terms</th></tr>
     <tr><td>${esc(inv.invoice_number)}</td><td>${dmyDate(inv.invoice_date)}</td><td>${pro(inv, '')}</td><td>Net 30</td></tr></table>
     <p><b>Remit to account of:</b><br>${party(inv.bill_to)}</p>
     <table><tr><th>Line</th><th>Charge</th><th class="r">Charges</th></tr>
     ${inv.line_items.map((l) => `<tr><td>${l.line_number}</td><td>${esc(l.description)}</td><td class="r">${money(inv, l.amount_cents)}</td></tr>`).join('')}
     <tr><td></td><td><b>Total Charges</b></td><td class="r"><b>${money(inv, inv.total_cents)}</b></td></tr></table>
     <div class="stub"><b>REMITTANCE STUB</b> &mdash; detach and return with payment<br>
     Freight Bill #: ${esc(inv.invoice_number)} &nbsp; ${pro(inv, 'Pro: ', ' &nbsp; ')}Amount Due: ${money(inv, inv.total_cents)}<br>
     Amount Enclosed: ____________</div>`,
  );

// Dense key-value header and dot-leader charge lines.
const compact = (inv: InvoiceFixture) =>
  page(
    `body { font: 10px Verdana, sans-serif } h2 { margin: 0 0 8px }
     .kv { display: grid; grid-template-columns: 1in 2.6in 1in 2.6in; gap: 3px 6px; margin-bottom: 12px } .kv b { color: #555 }
     .line { display: flex; gap: 4px; margin: 3px 0 } .dots { flex: 1; border-bottom: 1px dotted #999; margin-bottom: 3px }
     .balance { margin-top: 10px; font-size: 13px; font-weight: bold }`,
    `<h2>${esc(inv.carrier)}</h2>${title(inv, '', '<p><b>CREDIT MEMO</b></p>')}
     <div class="kv"><b>Invoice</b><span>${esc(inv.invoice_number)}</span><b>Date</b><span>${usDate(inv.invoice_date)}</span>
     ${pro(inv, '<b>PRO</b><span>', '</span>')}<b>Due</b><span>${usDate(inv.due_date)}</span>
     <b>Customer</b><span>${esc(inv.bill_to.name)}</span><b>Weight</b><span>${inv.weight_lb} lb</span>
     <b>Origin</b><span>${esc(inv.shipper.address)}</span><b>Destination</b><span>${esc(inv.consignee.address)}</span></div>
     ${inv.line_items.map((l) => `<div class="line"><span>${esc(l.description)}</span><span class="dots"></span><span>${money(inv, l.amount_cents)}</span></div>`).join('')}
     <div class="line balance"><span>Balance Due</span><span class="dots"></span><span>${money(inv, inv.total_cents)}</span></div>`,
  );

// Boxed header grid and a Qty x Rate table, so every amount appears twice as a distractor.
const boxed = (inv: InvoiceFixture) =>
  page(
    `body { font: 12px 'Times New Roman', serif } h1 { text-align: center; font-variant: small-caps }
     .grid { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: 12px }
     .grid div { border: 1px solid #1d1d1d; padding: 6px; min-height: 0.5in } .grid small { display: block; font-size: 9px; text-transform: uppercase }
     th, td { border: 1px solid #1d1d1d; padding: 5px }`,
    `<h1>${esc(inv.carrier)}</h1>${title(inv, '', '<p class="r"><b>CREDIT MEMO</b></p>')}
     <div class="grid"><div><small>Invoice number</small>${esc(inv.invoice_number)}</div>
     <div><small>Invoice date</small>${longDate(inv.invoice_date)}</div><div><small>PRO / tracking</small>${pro(inv, '')}</div>
     <div><small>Bill to</small>${party(inv.bill_to)}</div><div><small>Shipper</small>${party(inv.shipper)}</div>
     <div><small>Consignee</small>${party(inv.consignee)}</div></div>
     <table><tr><th>Qty</th><th>Description</th><th class="r">Rate</th><th class="r">Amount</th></tr>
     ${inv.line_items.map((l) => `<tr><td>1</td><td>${esc(l.description)}</td><td class="r">${figure(inv, l.amount_cents)}</td><td class="r">${figure(inv, l.amount_cents)}</td></tr>`).join('')}
     <tr><td colspan="3" class="r"><b>TOTAL CHARGES (${inv.currency})</b></td><td class="r"><b>${figure(inv, inv.total_cents)}</b></td></tr></table>
     <p>Weight: ${inv.weight_lb.toLocaleString('en-US')} lb. Payment due ${longDate(inv.due_date)}.</p>`,
  );

export const TEMPLATES = { classic, ledger, modern, remit, compact, boxed };

// Supporting pages of a scanned packet: they name the shipment but bill nothing, so the invoice stays on page 1.
const footer = (n: number, of: number) => `<p style="position:absolute;bottom:0.5in;right:0.6in">Page ${n} of ${of}</p>`;
const signature = (who: string) => `<p style="margin-top:0.4in">${who}: ______________________ &nbsp; Date: ____________</p>`;
export const SUPPORTING = {
  bill_of_lading: (inv: InvoiceFixture, n: number, of: number) =>
    page(
      `body { font: 12px Arial, sans-serif } td, th { border: 1px solid #555; padding: 6px; text-align: left }`,
      `<h2>Straight Bill of Lading &mdash; Not Negotiable</h2><p>Carrier: ${esc(inv.carrier)}${pro(inv, ' &middot; PRO ')}</p>
       <table><tr><th>Shipper</th><th>Consignee</th></tr><tr><td>${party(inv.shipper)}</td><td>${party(inv.consignee)}</td></tr></table>
       <table style="margin-top:12px"><tr><th>Handling units</th><th>Description of articles</th><th>Weight (lb)</th><th>Class</th></tr>
       <tr><td>4 PLT</td><td>General merchandise, palletized</td><td>${inv.weight_lb.toLocaleString('en-US')}</td><td>70</td></tr></table>
       ${signature('Shipper')}${signature('Carrier')}${footer(n, of)}`,
    ),
  delivery_receipt: (inv: InvoiceFixture, n: number, of: number) =>
    page(
      `body { font: 12px Georgia, serif } td { border-bottom: 1px solid #999; padding: 8px }`,
      `<h2>Delivery Receipt</h2><table><tr><td>Carrier</td><td>${esc(inv.carrier)}</td></tr>${pro(inv, '<tr><td>PRO</td><td>', '</td></tr>')}
       <tr><td>Delivered to</td><td>${party(inv.consignee)}</td></tr><tr><td>Pieces</td><td>4 pallets, received in good order</td></tr>
       <tr><td>Exceptions</td><td>None noted</td></tr></table>${signature('Received by')}${footer(n, of)}`,
    ),
  terms: (inv: InvoiceFixture, n: number, of: number, sections: string[]) =>
    page(
      `body { font: 10px 'Times New Roman', serif; line-height: 1.5 } h3 { margin: 10px 0 4px }`,
      `<h2>${esc(inv.carrier)} &mdash; Terms and Conditions of Carriage</h2>${sections.map((text, i) => `<h3>Section ${(n - 3) * sections.length + i + 1}</h3><p>${esc(text)}</p>`).join('')}${footer(n, of)}`,
    ),
};

// A handwritten note in blue ink, laid over a page before it is scanned.
export const handwriting = (html: string, note: string) =>
  html.replace(
    '</body>',
    `<div style="position:absolute;top:3.1in;right:0.7in;transform:rotate(-8deg);font:28px 'Segoe Script','Bradley Hand','Comic Sans MS',cursive;color:#1c3f9e">${esc(note)}</div></body>`,
  );
