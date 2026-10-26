// Builds a versioned eval set from the generator and the small seed: evals/golden/v1, the 90-case golden set with its
// dev, test and ci splits, or evals/comparison/v1, 15 scans for the primary model comparison drawn with another seed and
// other shipments, so choosing a model never looks at the test split. Ground truth comes from the generator, never
// from hand labels. A version is never rebuilt in place: a changed set is the next version.
// Usage: node golden/build.ts --set golden|comparison, or --version v2 for golden set v2 (golden/v2.ts).
import { faker } from '@faker-js/faker';
import { CHARGE_CODES, type ChargeCode } from '@freightaudit/db';
import { buildSeed, type Overcharge } from '@freightaudit/db/scripts/seed';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { assertPrinted, day, makeInvoice, party, printPdf, scanPdf, TEMPLATE_NAMES, withPage } from '../fixtures/generate-invoices.ts';
import { handwriting, type InvoiceFixture, SUPPORTING, TEMPLATES } from '../fixtures/templates.ts';
import { buildV2 } from './v2.ts';

type Path = 'digital' | 'scanned';
type Split = 'dev' | 'test' | 'comparison';
type Kind =
  | 'clean'
  | 'overcharge'
  | 'duplicate_invoice'
  | 'long_digit_run'
  | 'packet_long'
  | 'packet_3_pages'
  | 'repeated_page'
  | 'credit_memo'
  | 'two_invoices'
  | 'handwritten'
  | 'missing_pro'
  | 'non_usd';
// A group of cases of one kind and path; its first `dev` cases form the dev split, the next `ci` the ci subset.
type Group = { kind: Kind; path: Path; count: number; dev?: number; ci?: number };
// What the pipeline must end with for an invoice: its status, the review reason, and every overcharge it must find.
export type Expected = { status: 'reconciled' | 'needs_review'; reason?: string; overcharges: InvoiceFixture['overcharges'] };
// Subtotal and tax as printed: null when the invoice prints none, as no v1 layout does.
export type TruthInvoice = InvoiceFixture & { first_page: number; subtotal_cents: number | null; tax_cents: number | null; expected: Expected };
export type GoldenCase = {
  id: string;
  split: Split;
  ci: boolean;
  path: Path;
  // A v1 Kind, or one of golden/v2.ts.
  kind: string;
  adversarial: boolean;
  // What makes a v2 case hard (its layouts and noise), for the report's breakdown; v1 cases have none.
  traits?: string[];
  layouts: string[];
  pages: number;
  file: string;
  sha256: string;
  bytes: number;
  // PRO numbers of every shipment the case bills, printed or not, so other sets can avoid them.
  shipments: string[];
  invoices: TruthInvoice[];
};
export type Manifest = { set: string; version: string; created: string; seed: number; scale: 'small'; cases: Omit<GoldenCase, 'invoices'>[] };

const GOLDEN: Group[] = [
  { kind: 'clean', path: 'digital', count: 46, dev: 8, ci: 6 },
  { kind: 'clean', path: 'scanned', count: 7, dev: 2, ci: 3 },
  { kind: 'overcharge', path: 'digital', count: 12, dev: 2, ci: 3 },
  { kind: 'overcharge', path: 'scanned', count: 3, dev: 1, ci: 1 },
  { kind: 'duplicate_invoice', path: 'digital', count: 4, dev: 1, ci: 1 },
  { kind: 'duplicate_invoice', path: 'scanned', count: 1 },
  { kind: 'long_digit_run', path: 'digital', count: 2, dev: 1 },
  { kind: 'long_digit_run', path: 'scanned', count: 2, ci: 1 },
  { kind: 'packet_long', path: 'scanned', count: 1 },
  { kind: 'packet_3_pages', path: 'scanned', count: 1, ci: 1 },
  { kind: 'repeated_page', path: 'scanned', count: 1 },
  { kind: 'credit_memo', path: 'digital', count: 2, dev: 1 },
  { kind: 'two_invoices', path: 'digital', count: 2, dev: 1, ci: 1 },
  { kind: 'handwritten', path: 'scanned', count: 2, dev: 1, ci: 1 },
  { kind: 'missing_pro', path: 'digital', count: 1, dev: 1 },
  { kind: 'missing_pro', path: 'scanned', count: 1, ci: 1 },
  { kind: 'non_usd', path: 'digital', count: 2, dev: 1, ci: 1 },
];
const COMPARISON: Group[] = [
  { kind: 'clean', path: 'scanned', count: 10 },
  { kind: 'overcharge', path: 'scanned', count: 5 },
];
const SETS = { golden: { seed: 42, prefix: 'g', groups: GOLDEN }, comparison: { seed: 7, prefix: 'c', groups: COMPARISON } };
const ADVERSARIAL = new Set<Kind>(['credit_memo', 'two_invoices', 'handwritten', 'missing_pro', 'non_usd']);
const TYPES: Overcharge['type'][] = ['rate_mismatch', 'uncontracted_charge', 'duplicate_charge'];
// The two unbilled shipments whose PRO numbers hold a run of five or more equal digits, as in the PRO 6a misread.
const LONG_RUN_PROS = ['1000007919', '1000000000'];
const LONG_RUN_INVOICES = ['80000008', '44444441'];
// Notes a clerk wrote on the scan: one harmless, one with an amount that the extraction must not take.
const NOTES = ['OK to pay - J.M. 9/18', 'short pay $75.00?'];
// Exchange rates per 100 USD for the foreign invoices.
const RATES = { CAD: 137n, EUR: 92n };

const sum = (items: { amount_cents: number }[]) => items.reduce((total, item) => total + item.amount_cents, 0);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const reconciled = (inv: InvoiceFixture): Expected => ({ status: 'reconciled', overcharges: inv.overcharges });

async function main() {
  const { values } = parseArgs({ options: { set: { type: 'string', default: 'golden' }, version: { type: 'string', default: 'v1' } } });
  if (values.set !== 'golden' && values.set !== 'comparison') throw new Error('--set must be golden or comparison');
  if (values.version === 'v2' && values.set === 'golden') return buildV2();
  if (values.version !== 'v1') throw new Error('--version must be v1, or v2 for the golden set');
  const set = SETS[values.set];
  const root = new URL(`${values.set}/v1/`, new URL('../', import.meta.url));
  if (existsSync(root)) throw new Error(`${values.set}/v1 exists; a version is never rebuilt in place, build the next one instead`);

  const seeded = buildSeed('small');
  faker.seed(set.seed);
  // Shipments another set already bills, so the comparison set never repeats a golden invoice.
  const taken = new Set(LONG_RUN_PROS);
  if (values.set === 'comparison') {
    const golden = JSON.parse(await readFile(new URL('../golden/v1/manifest.json', import.meta.url), 'utf8')) as Manifest;
    for (const entry of golden.cases) for (const pro of entry.shipments) taken.add(pro);
  }
  const unbilled = faker.helpers.shuffle(seeded.unbilled.filter((shipment) => !taken.has(shipment.proNumber)));
  // Invoices the seed reconciled, whose shipments a duplicate or a credit memo bills again.
  const billed = faker.helpers.shuffle(seeded.invoices.filter((invoice) => (invoice.status === 'reconciled' || invoice.status === 'approved') && invoice.shipmentId));
  const shipmentById = new Map(seeded.shipments.map((shipment) => [shipment.id, shipment]));
  const shipmentByPro = new Map(seeded.shipments.map((shipment) => [shipment.proNumber, shipment]));
  const nextShipment = () => unbilled.shift()!;

  // A seeded invoice's shipment billed again: a duplicate of every line, or a credit memo for one or two of them.
  function rebill(kind: 'duplicate' | 'credit_memo'): { invoice: InvoiceFixture; shipment: string } {
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
      carrier: seeded.carriers.find((carrier) => carrier.id === shipment.carrierId)!.name,
      invoice_number: kind === 'duplicate' ? faker.string.numeric(8) : `CM${faker.string.numeric(6)}`,
      invoice_date: day(issued),
      due_date: day(new Date(issued.getTime() + 30 * 86_400_000)),
      pro_number: shipment.proNumber,
      currency: 'USD',
      ...(kind === 'credit_memo' ? { kind } : {}),
      bill_to: party(),
      shipper: party(),
      consignee: party(),
      weight_lb: shipment.weightLb,
      line_items: items,
      total_cents: sum(items),
      // Every line of a duplicate bills a charge the shipment already paid; a credit never overcharges.
      overcharges: kind === 'duplicate' ? items.map((item) => ({ line_number: item.line_number, type: 'duplicate_charge', expected_cents: 0, billed_cents: item.amount_cents })) : [],
    };
    return { invoice, shipment: shipment.proNumber };
  }

  // The invoices of one case, with what the pipeline must end with for each.
  function invoicesFor(kind: Kind, index: number): { invoices: { invoice: InvoiceFixture; expected: Expected }[]; shipments: string[] } {
    const fresh = (options: Parameters<typeof makeInvoice>[2] = { plant: false }) => {
      const shipment = nextShipment();
      return { invoice: makeInvoice(seeded, shipment, options), shipment: shipment.proNumber };
    };
    const one = ({ invoice, shipment }: { invoice: InvoiceFixture; shipment: string }, expected = reconciled(invoice)) => ({ invoices: [{ invoice, expected }], shipments: [shipment] });
    switch (kind) {
      case 'overcharge':
        return one(fresh({ plant: TYPES[index % TYPES.length]! }));
      case 'duplicate_invoice':
        return one(rebill('duplicate'));
      case 'credit_memo':
        return one(rebill('credit_memo'));
      case 'long_digit_run': {
        // First a long run in the invoice number, then one in the PRO number of a real shipment.
        if (index % 2 === 0) {
          const made = fresh();
          return one({ ...made, invoice: { ...made.invoice, invoice_number: LONG_RUN_INVOICES.shift()! } });
        }
        const shipment = shipmentByPro.get(LONG_RUN_PROS.shift()!)!;
        return one({ invoice: makeInvoice(seeded, shipment, { plant: false }), shipment: shipment.proNumber });
      }
      case 'two_invoices': {
        const [first, second] = [fresh(), fresh()];
        return { invoices: [first, second].map(({ invoice }) => ({ invoice, expected: reconciled(invoice) })), shipments: [first.shipment, second.shipment] };
      }
      case 'missing_pro': {
        const made = fresh();
        const invoice = { ...made.invoice, pro_number: null };
        return one({ invoice, shipment: made.shipment }, { status: 'needs_review', reason: 'no_shipment_match', overcharges: [] });
      }
      case 'non_usd': {
        const currency = index % 2 === 0 ? 'CAD' : 'EUR';
        const made = fresh();
        const convert = (cents: number) => Number((BigInt(cents) * RATES[currency] + 50n) / 100n);
        const items = made.invoice.line_items.map((item) => ({ ...item, amount_cents: convert(item.amount_cents), expected_cents: convert(item.amount_cents) }));
        const invoice = { ...made.invoice, currency, line_items: items, total_cents: sum(items) };
        return one({ invoice, shipment: made.shipment }, { status: 'needs_review', reason: `unsupported_currency: ${currency}`, overcharges: [] });
      }
      default:
        return one(fresh());
    }
  }

  await mkdir(new URL('cases/', root), { recursive: true });
  const entries: Manifest['cases'] = [];
  await withPage(async (page) => {
    for (const group of set.groups) {
      for (let index = 0; index < group.count; index++) {
        const n = entries.length;
        const id = `${set.prefix}${String(n + 1).padStart(3, '0')}`;
        const { invoices, shipments } = invoicesFor(group.kind, index);
        const layouts = invoices.map((_, i) => TEMPLATE_NAMES[(n + i) % TEMPLATE_NAMES.length]!);
        const htmls = invoices.map(({ invoice }, i) => TEMPLATES[layouts[i]!](invoice));
        const first = invoices[0]!.invoice;

        // Every invoice page must print what its ground truth says.
        for (const [i, { invoice }] of invoices.entries()) {
          await page.setContent(htmls[i]!);
          await assertPrinted(page, invoice, `${id} (${layouts[i]})`);
        }
        let pdf: Uint8Array;
        if (group.path === 'digital') {
          const parts = [];
          for (const [i, html] of htmls.entries()) parts.push(await printPdf(page, html, invoices[i]!.invoice.invoice_date));
          if (parts.length === 1) pdf = parts[0]!;
          else {
            const merged = await PDFDocument.create({ updateMetadata: false });
            for (const part of parts) {
              const source = await PDFDocument.load(part, { updateMetadata: false });
              for (const copied of await merged.copyPages(source, source.getPageIndices())) merged.addPage(copied);
            }
            pdf = await merged.save();
          }
        } else {
          const html = htmls[0]!;
          let pages = [html];
          if (group.kind === 'packet_long' || group.kind === 'packet_3_pages') {
            const of = group.kind === 'packet_long' ? 14 : 3;
            pages = [html, SUPPORTING.bill_of_lading(first, 2, of), SUPPORTING.delivery_receipt(first, 3, of)];
            for (let at = 4; at <= of; at++) pages.push(SUPPORTING.terms(first, at, of, Array.from({ length: 3 }, () => faker.lorem.paragraph(6))));
          } else if (group.kind === 'repeated_page') pages = [html, html];
          else if (group.kind === 'handwritten') pages = [handwriting(html, NOTES[index % NOTES.length]!)];
          ({ pdf } = await scanPdf(page, pages, first.invoice_date));
        }

        const file = `cases/${id}.pdf`;
        const pageCount = (await PDFDocument.load(pdf)).getPageCount();
        const truth: TruthInvoice[] = invoices.map(({ invoice, expected }, i) => ({ ...invoice, first_page: i + 1, subtotal_cents: null, tax_cents: null, expected }));
        const counts = { dev: group.dev ?? 0, ci: group.ci ?? 0 };
        const entry: Manifest['cases'][number] = {
          id,
          split: values.set === 'comparison' ? 'comparison' : index < counts.dev ? 'dev' : 'test',
          ci: index >= counts.dev && index < counts.dev + counts.ci,
          path: group.path,
          kind: group.kind,
          adversarial: ADVERSARIAL.has(group.kind),
          layouts,
          pages: pageCount,
          file,
          sha256: sha256(pdf),
          bytes: pdf.length,
          shipments,
        };
        await writeFile(new URL(file, root), pdf);
        await writeFile(new URL(`cases/${id}.json`, root), `${JSON.stringify({ ...entry, invoices: truth } satisfies GoldenCase, null, 2)}\n`);
        entries.push(entry);
        console.log(JSON.stringify({ msg: 'case written', id, kind: group.kind, path: group.path, pages: pageCount, bytes: pdf.length }));
      }
    }
  });
  const manifest: Manifest = {
    set: values.set,
    version: 'v1',
    created: new Date().toISOString().slice(0, 10),
    seed: set.seed,
    scale: 'small',
    cases: entries,
  };
  await writeFile(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) await main();
