// Builds golden set v2 (evals/golden/v2): 98 cases harder than v1's, from the same generator and small seed, with seed 43
// and no shipment that golden v1 or comparison v1 bills. The plan draws every random choice (shipments, numbers, layouts,
// tilt, noise, stamps), so the render is a pure function of it and a test can check the committed set against it.
// Usage: pnpm golden --version v2
import { faker } from '@faker-js/faker';
import { CHARGE_CODES, type ChargeCode } from '@freightaudit/db';
import { buildSeed, type Overcharge } from '@freightaudit/db/scripts/seed';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright';
import { day, makeInvoice, party as someone, pinDates, type Seeded, withPage } from '../fixtures/generate-invoices.ts';
import { bindScans, PROFILES, type Profile, type ScanSpec, scanPage } from '../fixtures/scan-v2.ts';
import { figure, type InvoiceFixture, SUPPORTING } from '../fixtures/templates.ts';
import { carrierWording, type InvoiceV2, type Layout, type Overlay, pagesOf, TITLE_LINE, withOverlays } from '../fixtures/templates-v2.ts';
import type { Expected, GoldenCase, Manifest } from './build.ts';

export { PROFILES } from '../fixtures/scan-v2.ts';
// The api's limits on one upload (packages/contracts/src/limits.ts), so every v2 case could be uploaded.
export const LIMITS = { bytes: 4 * 1024 * 1024, pages: 20 };

type Kind =
  | 'clean'
  | 'overcharge'
  | 'duplicate_invoice'
  | 'repeated_page'
  | 'multi_invoice'
  | 'packet'
  | 'partial_credit'
  | 'credit_memo'
  | 'revised_invoice'
  | 'tricky_number'
  | 'handwritten'
  | 'upside_down'
  | 'missing_pro'
  | 'non_usd';
type Path = 'digital' | 'scanned';
// A group of cases of one kind and path; its first `dev` cases form the dev split, the next `ci` the ci subset.
type Group = { kind: Kind; path: Path; count: number; dev?: number; ci?: number };
export type TruthInvoiceV2 = InvoiceV2 & { first_page: number; expected: Expected };
export type CaseV2 = Omit<GoldenCase, 'invoices' | 'traits'> & { traits: string[]; scans: (ScanSpec | null)[]; invoices: TruthInvoiceV2[] };
// Where a page comes from: one page of an invoice in its layout, or a supporting page of a packet.
export type PageSource = { invoice: number; layout: Layout; part: number } | { support: 'bill_of_lading' | 'delivery_receipt' | 'terms'; n: number; of: number; sections?: string[] };
export type PagePlan = { source: PageSource; overlays: Overlay[]; scan: ScanSpec | null };
export type CasePlan = { case: Omit<CaseV2, 'sha256' | 'bytes'>; pages: PagePlan[] };

export const GROUPS_V2: Group[] = [
  { kind: 'clean', path: 'digital', count: 16, dev: 4, ci: 3 },
  { kind: 'clean', path: 'scanned', count: 16, dev: 4, ci: 2 },
  { kind: 'overcharge', path: 'digital', count: 12, dev: 3, ci: 3 },
  { kind: 'overcharge', path: 'scanned', count: 8, dev: 2, ci: 2 },
  { kind: 'duplicate_invoice', path: 'digital', count: 3, dev: 1, ci: 1 },
  { kind: 'duplicate_invoice', path: 'scanned', count: 2, dev: 1 },
  { kind: 'repeated_page', path: 'digital', count: 4, dev: 2, ci: 1 },
  { kind: 'repeated_page', path: 'scanned', count: 8, dev: 4, ci: 1 },
  { kind: 'multi_invoice', path: 'digital', count: 3, dev: 1, ci: 1 },
  { kind: 'multi_invoice', path: 'scanned', count: 2, dev: 1, ci: 1 },
  { kind: 'packet', path: 'scanned', count: 4, dev: 2, ci: 1 },
  { kind: 'partial_credit', path: 'digital', count: 2, dev: 1 },
  { kind: 'partial_credit', path: 'scanned', count: 1 },
  { kind: 'credit_memo', path: 'digital', count: 1, dev: 1 },
  { kind: 'credit_memo', path: 'scanned', count: 1 },
  { kind: 'revised_invoice', path: 'digital', count: 2, dev: 1 },
  { kind: 'revised_invoice', path: 'scanned', count: 1 },
  { kind: 'tricky_number', path: 'digital', count: 2, dev: 1, ci: 1 },
  { kind: 'tricky_number', path: 'scanned', count: 2, dev: 1 },
  { kind: 'handwritten', path: 'scanned', count: 2, dev: 1, ci: 1 },
  { kind: 'upside_down', path: 'scanned', count: 2, dev: 1 },
  { kind: 'missing_pro', path: 'digital', count: 1, dev: 1 },
  { kind: 'missing_pro', path: 'scanned', count: 1, ci: 1 },
  { kind: 'non_usd', path: 'digital', count: 2, dev: 1, ci: 1 },
];
const ADVERSARIAL = new Set<Kind>(['repeated_page', 'multi_invoice', 'partial_credit', 'credit_memo', 'revised_invoice', 'tricky_number', 'handwritten', 'upside_down', 'missing_pro', 'non_usd']);
// Digital cases take the layouts with a title line beside the carrier, in turn; scans take all ten.
const DIGITAL: Layout[] = ['two_column', 'landscape', 'carrier_form', 'continued', 'remit'];
const SCANNED: Layout[] = ['classic', 'ledger', 'modern', 'remit', 'compact', 'boxed', 'two_column', 'landscape', 'carrier_form', 'continued'];
// What makes a layout hard, besides its title line.
const LAYOUT_TRAITS: Partial<Record<Layout, string[]>> = {
  two_column: ['multi_column', 'factoring_remit'],
  landscape: ['landscape', 'reference_numbers'],
  carrier_form: ['carrier_wording', 'early_pay_discount'],
  continued: ['continued_page', 'reference_numbers', 'subtotal_tax'],
};
const TYPES: Overcharge['type'][] = ['rate_mismatch', 'uncontracted_charge', 'duplicate_charge'];
const RATES = { CAD: 137n, EUR: 92n };
const NOTES = ['Paid 10/14 ck 4471', 'hold - disputed $125.00?'];
const STAMPS = ['RECEIVED', 'PAID', 'ENTERED'];

const sum = (items: { amount_cents: number }[]) => items.reduce((total, item) => total + item.amount_cents, 0);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const addDays = (iso: string, days: number) => day(new Date(Date.parse(iso) + days * 86_400_000));
const initials = (name: string) => name.split(' ').filter((word) => /^[A-Za-z]/.test(word)).map((word) => word[0]).join('').toUpperCase();

// Shipments that golden v1 and comparison v1 bill, read from their manifests.
export async function takenShipments() {
  const taken = new Set<string>();
  for (const set of ['golden', 'comparison']) {
    const manifest = JSON.parse(await readFile(new URL(`../${set}/v1/manifest.json`, import.meta.url), 'utf8')) as Manifest;
    for (const entry of manifest.cases) for (const pro of entry.shipments) taken.add(pro);
  }
  return taken;
}

export function planV2(seeded: Seeded, taken: ReadonlySet<string>): CasePlan[] {
  faker.seed(43);
  const shipmentById = new Map(seeded.shipments.map((shipment) => [shipment.id, shipment]));
  const carrierOf = (shipment: Seeded['shipments'][number]) => seeded.carriers.find((carrier) => carrier.id === shipment.carrierId)!.name;
  const unbilled = faker.helpers.shuffle(seeded.unbilled.filter((shipment) => !taken.has(shipment.proNumber)));
  // Invoices the seed reconciled, whose shipments a duplicate or a credit memo bills again.
  const billed = faker.helpers.shuffle(
    seeded.invoices.filter((invoice) => (invoice.status === 'reconciled' || invoice.status === 'approved') && invoice.shipmentId && !taken.has(shipmentById.get(invoice.shipmentId)!.proNumber)),
  );
  // Every invoice number the set prints, and the seed's, so none repeats and none looks like a seeded invoice billed again.
  const numbers = new Set<string>(seeded.invoices.flatMap((invoice) => (invoice.invoiceNumber ? [invoice.invoiceNumber] : [])));
  const unique = (draw: () => string) => {
    for (;;) {
      const number = draw();
      if (numbers.has(number)) continue;
      numbers.add(number);
      return number;
    }
  };
  const reconciled = (invoice: InvoiceFixture): Expected => ({ status: 'reconciled', overcharges: invoice.overcharges });

  // The next unbilled shipment, of a carrier the case does not bill yet, billed as an invoice.
  const fresh = (plant: boolean | Overcharge['type'] = false, carriers: ReadonlySet<string> = new Set()) => {
    const [shipment] = unbilled.splice(
      unbilled.findIndex((candidate) => !carriers.has(carrierOf(candidate))),
      1,
    );
    const invoice = makeInvoice(seeded, shipment!, { plant });
    if (numbers.has(invoice.invoice_number)) invoice.invoice_number = unique(() => faker.string.numeric(8));
    else numbers.add(invoice.invoice_number);
    return { invoice, shipment: shipment! };
  };
  // A seeded invoice's shipment billed again: a duplicate of every line, or a credit memo for one or two of them.
  const rebill = (kind: 'duplicate' | 'credit_memo') => {
    const source = billed.shift()!;
    const shipment = shipmentById.get(source.shipmentId!)!;
    const lines = seeded.lines.filter((line) => line.invoiceId === source.id).sort((a, b) => a.lineNumber - b.lineNumber);
    const issued = new Date(Date.parse(source.invoiceDate!) + faker.number.int({ min: 15, max: 45 }) * 86_400_000);
    const picked = kind === 'duplicate' ? lines : faker.helpers.arrayElements(lines, { min: 1, max: 2 });
    const items = picked.map((line, i) => {
      const code = line.chargeCode as ChargeCode;
      const cents = Number(line.amountCents) * (kind === 'duplicate' ? 1 : -1);
      return { line_number: i + 1, description: `${CHARGE_CODES[code]}${kind === 'duplicate' ? '' : ' credit'}`, charge_code: code, amount_cents: cents, expected_cents: kind === 'duplicate' ? 0 : cents };
    });
    const invoice: InvoiceFixture = {
      carrier: carrierOf(shipment),
      invoice_number: unique(() => (kind === 'duplicate' ? faker.string.numeric(8) : `CM${faker.string.numeric(6)}`)),
      invoice_date: day(issued),
      due_date: day(new Date(issued.getTime() + 30 * 86_400_000)),
      pro_number: shipment.proNumber,
      currency: 'USD',
      ...(kind === 'credit_memo' ? { kind } : {}),
      bill_to: someone(),
      shipper: someone(),
      consignee: someone(),
      weight_lb: shipment.weightLb,
      line_items: items,
      total_cents: sum(items),
      // Every line of a duplicate bills a charge the shipment already paid; a credit never overcharges.
      overcharges: kind === 'duplicate' ? items.map((item) => ({ line_number: item.line_number, type: 'duplicate_charge', expected_cents: 0, billed_cents: item.amount_cents })) : [],
    };
    return { invoice, shipment };
  };

  // What the layout prints besides v1's fields: refs, a factor, a subtotal and tax, or the carrier's own wording.
  const decorate = (invoice: InvoiceFixture, layout: Layout, shippedOn: string): InvoiceV2 => {
    const printed: InvoiceV2 = { ...invoice, subtotal_cents: null, tax_cents: null };
    if (layout === 'landscape' || layout === 'continued') {
      const days = Math.max(0, Math.floor((Date.parse(invoice.invoice_date) - Date.parse(shippedOn)) / 86_400_000 / 2));
      printed.refs = { bol: faker.string.numeric(10), po: `PO-${faker.string.numeric(5)}`, shipped_on: shippedOn, delivered_on: addDays(shippedOn, days) };
    }
    if (layout === 'two_column') {
      printed.factor = { name: `${faker.person.lastName()} Capital Funding`, address: `P.O. Box ${faker.string.numeric(5)}, ${faker.location.city()}, ${faker.location.state({ abbreviated: true })} ${faker.location.zipCode('#####')}` };
    }
    if (layout === 'continued') Object.assign(printed, { subtotal_cents: invoice.total_cents, tax_cents: 0 });
    if (layout === 'carrier_form') printed.line_items = invoice.line_items.map((line) => ({ ...line, description: carrierWording(invoice.carrier, line.charge_code as ChargeCode, line.description) }));
    return printed;
  };

  // A date the case does not print, `from` to `to` days after `iso`.
  const unprinted = (iso: string, from: number, to: number, printed: Set<string>) => {
    for (;;) {
      const date = addDays(iso, faker.number.int({ min: from, max: to }));
      if (!printed.has(date)) return date;
    }
  };
  const tilt = (profile: Profile) =>
    profile === 'skew' ? faker.number.float({ min: 3, max: 6, fractionDigits: 2 }) * (faker.datatype.boolean() ? 1 : -1) : faker.number.float({ min: -1.5, max: 1.5, fractionDigits: 2 });
  const scan = (profile: Profile, layout: Layout | null, flip = false): ScanSpec => ({ profile, degrees: tilt(profile), noise: faker.number.int({ max: 0xffff_ffff }), sideways: layout === 'landscape', flip });

  const plans: CasePlan[] = [];
  const turns = { digital: 0, scanned: 0, digitalCases: 0, scannedCases: 0 };
  const layout = (path: Path, avoid: ReadonlySet<Layout> = new Set()) => {
    const list = path === 'digital' ? DIGITAL : SCANNED;
    for (;;) {
      const picked = list[turns[path]++ % list.length]!;
      if (!avoid.has(picked)) return picked;
    }
  };
  const single = new Set<Layout>(['continued']);
  for (const group of GROUPS_V2) {
    for (let index = 0; index < group.count; index++) {
      const id = `g2-${String(plans.length + 1).padStart(3, '0')}`;
      const { kind, path } = group;
      const caseTurn = path === 'digital' ? turns.digitalCases++ : turns.scannedCases++;
      const profile: Profile | null = path === 'scanned' ? PROFILES[(caseTurn + Math.floor(caseTurn / 10)) % PROFILES.length]! : null;
      const traits = new Set<string>(profile ? [profile] : []);

      // The case's invoices, each with its layout and what the pipeline must end with.
      type Made = { invoice: InvoiceFixture; shipment: Seeded['shipments'][number]; expected?: Expected };
      let made: Made[];
      switch (kind) {
        case 'overcharge':
          made = [fresh(TYPES[index % TYPES.length]!)];
          break;
        case 'duplicate_invoice':
          made = [rebill('duplicate')];
          break;
        case 'credit_memo':
          made = [rebill('credit_memo')];
          break;
        case 'multi_invoice': {
          const count = path === 'digital' ? [2, 3, 2][index]! : [2, 3][index]!;
          made = [];
          for (let i = 0; i < count; i++) made.push(fresh(false, new Set(made.map((each) => each.invoice.carrier))));
          break;
        }
        case 'partial_credit': {
          const base = fresh();
          const target = faker.helpers.arrayElement(base.invoice.line_items.slice(1));
          const cents = -Math.max(100, Number((BigInt(target.amount_cents) * BigInt(faker.number.int({ min: 5, max: 20 }))) / 100n));
          const code = target.charge_code as ChargeCode;
          const credit = { line_number: base.invoice.line_items.length + 1, description: `${CHARGE_CODES[code]} adjustment (credit)`, charge_code: code, amount_cents: cents, expected_cents: cents };
          const line_items = [...base.invoice.line_items, credit];
          made = [{ ...base, invoice: { ...base.invoice, line_items, total_cents: sum(line_items) } }];
          break;
        }
        case 'tricky_number': {
          const base = fresh();
          const digit = () => String(faker.number.int({ min: 1, max: 9 }));
          const patterns = [
            () => `00${faker.string.numeric(6)}`,
            () => `${initials(base.invoice.carrier)}-00${faker.string.numeric(5)}`,
            () => ((d) => `${d}000000${d}`)(digit()),
            () => ((d) => `${d.repeat(4)}-000${d}`)(digit()),
          ];
          numbers.delete(base.invoice.invoice_number);
          made = [{ ...base, invoice: { ...base.invoice, invoice_number: unique(patterns[(index + (path === 'scanned' ? 2 : 0)) % patterns.length]!) } }];
          break;
        }
        case 'missing_pro': {
          const base = fresh();
          made = [{ ...base, invoice: { ...base.invoice, pro_number: null }, expected: { status: 'needs_review', reason: 'no_shipment_match', overcharges: [] } }];
          break;
        }
        case 'non_usd': {
          const base = fresh();
          const currency = index % 2 === 0 ? 'CAD' : 'EUR';
          const convert = (cents: number) => Number((BigInt(cents) * RATES[currency] + 50n) / 100n);
          const items = base.invoice.line_items.map((item) => ({ ...item, amount_cents: convert(item.amount_cents), expected_cents: convert(item.expected_cents) }));
          made = [{ ...base, invoice: { ...base.invoice, currency, line_items: items, total_cents: sum(items) }, expected: { status: 'needs_review', reason: `unsupported_currency: ${currency}`, overcharges: [] } }];
          break;
        }
        default:
          made = [fresh()];
      }

      // Layouts: repeated digital copies, packets and upside-down pages take one-page layouts; the third repeated scan
      // variant is page 2 of a two-page invoice scanned twice.
      const repeatVariant = index % 4;
      const forced = kind === 'repeated_page' && path === 'scanned' && repeatVariant === 2 ? 'continued' : undefined;
      const oneLayout = (kind === 'repeated_page' && !forced) || kind === 'packet' || kind === 'upside_down';
      const layouts = made.map(() => forced ?? layout(path, oneLayout ? single : new Set()));
      const invoices = made.map(({ invoice, shipment }, i) => decorate(invoice, layouts[i]!, shipment.shippedOn));
      if (kind === 'revised_invoice') invoices[0]!.revised_from = unique(() => faker.string.numeric(8));
      for (const each of layouts) {
        if (TITLE_LINE.has(each)) traits.add('title_line');
        for (const trait of LAYOUT_TRAITS[each] ?? []) traits.add(trait);
        if (each === 'landscape' && path === 'scanned') traits.add('rotated_table');
      }

      // Pages: each invoice's pages in its layout, then the kind's repeats and supporting pages.
      const printed = new Set(invoices.flatMap((invoice) => [invoice.invoice_date, invoice.due_date, addDays(invoice.invoice_date, 10), ...(invoice.refs ? [invoice.refs.shipped_on, invoice.refs.delivered_on] : [])]));
      const invoicePages = (i: number): PagePlan[] =>
        pagesOf(layouts[i]!, invoices[i]!).map((_, part) => ({ source: { invoice: i, layout: layouts[i]!, part }, overlays: [], scan: null }));
      let pages: PagePlan[] = invoices.flatMap((_, i) => invoicePages(i));
      if (kind === 'repeated_page') {
        if (path === 'digital') {
          traits.add('copy_label');
          pages = [
            { ...pages[0]!, overlays: [{ mark: 'copy', label: 'ORIGINAL' }] },
            { ...pages[0]!, overlays: [{ mark: 'copy', label: 'REMITTANCE COPY' }] },
          ];
        } else pages = repeatVariant === 1 ? [pages[0]!, pages[0]!, pages[0]!] : repeatVariant === 2 ? [pages[0]!, pages[1]!, pages[1]!] : [pages[0]!, pages[0]!];
      }
      let supports = new Set<number>();
      if (kind === 'packet') {
        const of = [3, 6, 5, 8][index]!;
        const after = index % 2 === 1;
        if (after) traits.add('invoice_not_first');
        const support = (n: number): PagePlan => ({
          source: n === (after ? 1 : 2) ? { support: 'bill_of_lading', n, of } : n === 3 ? { support: 'delivery_receipt', n, of } : { support: 'terms', n, of, sections: Array.from({ length: 3 }, () => faker.lorem.paragraph(6)) },
          overlays: [],
          scan: null,
        });
        pages = Array.from({ length: of }, (_, i) => (i === (after ? 1 : 0) ? pages[0]! : support(i + 1)));
        supports = new Set(pages.flatMap((page, i) => ('support' in page.source ? [i] : [])));
      }

      // Marks: stamps (a quarter of the digital cases, and every stamp-profile scan), the fax header, notes, revisions.
      const marked = (page: PagePlan, overlay: Overlay): PagePlan => ({ ...page, overlays: [...page.overlays, overlay] });
      const firstOf = (i: number) => pages.findIndex((page) => 'invoice' in page.source && page.source.invoice === i);
      const stampOn = (i: number) => {
        const at = firstOf(i);
        const date = unprinted(invoices[i]!.invoice_date, 3, 9, printed);
        const stamp: Overlay = { mark: 'stamp', word: STAMPS[(caseTurn + i) % STAMPS.length]!, date, color: (caseTurn + i) % 2 === 0 ? 'red' : 'blue' };
        // Every copy of a repeated page is the same paper, stamp and all.
        pages = pages.map((page, n) => (n === at || (kind === 'repeated_page' && page.source === pages[at]!.source) ? marked(page, stamp) : page));
        traits.add('stamp');
      };
      if (path === 'digital' && caseTurn % 4 === 3) stampOn(0);
      if (profile === 'stamp') invoices.forEach((_, i) => stampOn(i));
      if (profile === 'fax') {
        const date = unprinted(invoices[0]!.invoice_date, 1, 9, printed);
        const time = `${String(faker.number.int({ min: 7, max: 18 })).padStart(2, '0')}:${String(faker.number.int({ min: 0, max: 59 })).padStart(2, '0')}`;
        const from = `555-01${faker.string.numeric(2)}`;
        pages = pages.map((page, n) => marked(page, { mark: 'fax', date, time, from, page: n + 1, of: pages.length }));
      }
      if (kind === 'handwritten') pages = pages.map((page, n) => (n === 0 ? marked(page, { mark: 'note', text: NOTES[index % NOTES.length]! }) : page));
      if (kind === 'revised_invoice') pages = pages.map((page, n) => (n === 0 ? marked(page, { mark: 'revised', old: invoices[0]!.revised_from! }) : page));

      // Scans: each page with the case's profile, a packet's supporting pages at low resolution to stay under 4 MiB.
      if (path === 'scanned')
        pages = pages.map((page, n) => ({
          ...page,
          scan: scan(supports.has(n) ? 'low_res' : profile!, 'layout' in page.source ? page.source.layout : null, kind === 'upside_down' && n === 0),
        }));

      // The first invoice starts on page 1, as extraction's check requires; each later one on its own first page.
      const truth: TruthInvoiceV2[] = invoices.map((invoice, i) => ({ ...invoice, first_page: i === 0 ? 1 : firstOf(i) + 1, expected: made[i]!.expected ?? reconciled(invoice) }));      const counts = { dev: group.dev ?? 0, ci: group.ci ?? 0 };
      plans.push({
        case: {
          id,
          split: index < counts.dev ? 'dev' : 'test',
          ci: index >= counts.dev && index < counts.dev + counts.ci,
          path,
          kind,
          adversarial: ADVERSARIAL.has(kind),
          traits: [...traits].sort(),
          layouts,
          pages: pages.length,
          scans: pages.map((page) => page.scan),
          file: `cases/${id}.pdf`,
          shipments: made.map(({ shipment }) => shipment.proNumber),
          invoices: truth,
        },
        pages,
      });
    }
  }
  return plans;
}

// A packet's supporting page, as v1 prints them.
const supportHtml = (source: Extract<PageSource, { support: string }>, invoice: InvoiceFixture) =>
  source.support === 'bill_of_lading'
    ? SUPPORTING.bill_of_lading(invoice, source.n, source.of)
    : source.support === 'delivery_receipt'
      ? SUPPORTING.delivery_receipt(invoice, source.n, source.of)
      : SUPPORTING.terms(invoice, source.n, source.of, source.sections!);
const htmlOf = (golden: CasePlan['case'], page: PagePlan) =>
  withOverlays('invoice' in page.source ? pagesOf(page.source.layout, golden.invoices[page.source.invoice]!)[page.source.part]! : supportHtml(page.source, golden.invoices[0]!), page.overlays);

// Ground truth is only fair if the pages print it: every identifier, line amount and the total, over all of an invoice's
// pages.
async function assertPrinted(page: Page, plan: CasePlan) {
  const texts = new Map<number, string>();
  for (const each of plan.pages) {
    if (!('invoice' in each.source)) continue;
    await page.setContent(htmlOf(plan.case, each));
    texts.set(each.source.invoice, `${texts.get(each.source.invoice) ?? ''}\n${(await page.innerText('body')).toUpperCase()}`);
  }
  for (const [i, invoice] of plan.case.invoices.entries()) {
    const values = [invoice.carrier, invoice.invoice_number, ...(invoice.pro_number === null ? [] : [invoice.pro_number]), figure(invoice, Math.abs(invoice.total_cents)), ...invoice.line_items.map((line) => figure(invoice, Math.abs(line.amount_cents)))];
    const missing = values.find((value) => !texts.get(i)?.includes(value.toUpperCase()));
    if (missing) throw new Error(`${plan.case.id} invoice ${i + 1} does not show ${missing}`);
  }
}

// A case's PDF: digital pages printed and bound, or each page scanned by its profile into an image-only PDF.
export async function renderV2(page: Page, plan: CasePlan) {
  await assertPrinted(page, plan);
  const isoDay = plan.case.invoices[0]!.invoice_date;
  if (plan.case.path === 'scanned') {
    const scans = [];
    for (const each of plan.pages) scans.push(await scanPage(page, htmlOf(plan.case, each), each.scan!));
    return bindScans(page, scans, isoDay);
  }
  const parts: Buffer[] = [];
  for (const each of plan.pages) {
    await page.setContent(htmlOf(plan.case, each));
    const landscape = 'layout' in each.source && each.source.layout === 'landscape';
    parts.push(pinDates(await page.pdf({ format: 'Letter', landscape, printBackground: true }), isoDay));
  }
  if (parts.length === 1) return parts[0]!;
  const merged = await PDFDocument.create({ updateMetadata: false });
  for (const part of parts) {
    const source = await PDFDocument.load(part, { updateMetadata: false });
    for (const copied of await merged.copyPages(source, source.getPageIndices())) merged.addPage(copied);
  }
  return merged.save();
}

export async function buildV2() {
  const root = new URL('v2/', import.meta.url);
  if (existsSync(root)) throw new Error('golden/v2 exists; a version is never rebuilt in place, build the next one instead');
  const plans = planV2(buildSeed('small'), await takenShipments());
  await mkdir(new URL('cases/', root), { recursive: true });
  const entries: Manifest['cases'] = [];
  await withPage(async (page) => {
    for (const plan of plans) {
      const pdf = await renderV2(page, plan);
      const { invoices, ...rest } = plan.case;
      const pages = (await PDFDocument.load(pdf)).getPageCount();
      if (pages !== rest.pages) throw new Error(`${rest.id} has ${pages} pages, its plan ${rest.pages}`);
      if (pdf.length > LIMITS.bytes || pages > LIMITS.pages) throw new Error(`${rest.id} is ${pdf.length} bytes and ${pages} pages, over the api's ${LIMITS.bytes} bytes and ${LIMITS.pages} pages`);
      const entry = { ...rest, sha256: sha256(pdf), bytes: pdf.length };
      await writeFile(new URL(rest.file, root), pdf);
      await writeFile(new URL(`cases/${rest.id}.json`, root), `${JSON.stringify({ ...entry, invoices }, null, 2)}\n`);
      entries.push(entry);
      console.log(JSON.stringify({ msg: 'case written', id: rest.id, kind: rest.kind, path: rest.path, pages, bytes: pdf.length }));
    }
  });
  const manifest = { set: 'golden', version: 'v2', created: new Date().toISOString().slice(0, 10), seed: 43, scale: 'small' as const, cases: entries };
  await writeFile(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ msg: 'set written', cases: entries.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) }));
}
