import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { findMarks, type Mark, type MarkValues, type TextItem } from './marks.ts';

// The golden set's digital cases, each read by pdf.js as the viewer reads it, marked with its ground truth as the AI's
// reading. Two-invoice cases are skipped: an upload of them becomes two invoices, each with its own part.
const golden = new URL('../../../evals/golden/v1/', import.meta.url);
type Line = { line_number: number; description: string; amount_cents: number };
type Truth = { carrier: string; invoice_number: string; invoice_date: string; pro_number: string | null; total_cents: number; line_items: Line[]; overcharges: { line_number: number }[] };
type Case = { id: string; path: string; layouts: string[]; invoices: Truth[] };
const cases = (JSON.parse(readFileSync(new URL('manifest.json', golden), 'utf8')) as { cases: { id: string; path: string }[] }).cases
  .filter((each) => each.path === 'digital')
  .map(({ id }) => JSON.parse(readFileSync(new URL(`cases/${id}.json`, golden), 'utf8')) as Case)
  .filter((each) => each.invoices.length === 1);

async function pagesOf(id: string) {
  const task = getDocument({ data: new Uint8Array(readFileSync(new URL(`cases/${id}.pdf`, golden))) });
  const doc = await task.promise;
  const pages: TextItem[][] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const { items } = await (await doc.getPage(number)).getTextContent();
    pages.push(items.filter((item) => 'str' in item) as TextItem[]);
  }
  await task.destroy();
  return pages;
}

// The reading the AI gives: the ground truth, with descriptions as printed. The ledger layout prints them in capitals,
// and the model copies them so (the sample's g002 and g056 readings).
const valuesOf = ({ layouts: [layout], invoices: [truth] }: Case): MarkValues => ({
  carrier: truth!.carrier,
  number: truth!.invoice_number,
  issuedOn: truth!.invoice_date,
  proNumber: truth!.pro_number,
  totalCents: truth!.total_cents,
  lines: truth!.line_items.map((line) => ({
    description: layout === 'ledger' ? line.description.toUpperCase() : line.description,
    amountCents: line.amount_cents,
    flagged: truth!.overcharges.some((overcharge) => overcharge.line_number === line.line_number),
  })),
});

// The text a mark covers, from its first character to its last, in the page's own words.
const covered = (pages: TextItem[][], { page, from, to }: Mark) => {
  const items = pages[page]!;
  if (from.item === to.item) return items[from.item]!.str.slice(from.offset, to.offset);
  const middle = items.slice(from.item + 1, to.item).map((item) => item.str);
  return [items[from.item]!.str.slice(from.offset), ...middle, items[to.item]!.str.slice(0, to.offset)].join('');
};
const plain = (text: string) => text.replace(/[,$€£¥]/g, '').replace(/\s+/g, ' ').trim();
const amount = (cents: number) => `${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dates = (iso: string) => {
  const [year, month, day] = iso.split('-') as [string, string, string];
  const mon = MONTHS[Number(month) - 1]!;
  return [iso, `${month}/${day}/${year}`, `${mon} ${Number(day)} ${year}`, `${day}-${mon.toUpperCase()}-${year}`];
};

describe.each(cases)('$id ($layouts)', (golden) => {
  test('every mark covers its value in the PDF text, one mark at most per value', async () => {
    const pages = await pagesOf(golden.id);
    const values = valuesOf(golden);
    const marks = findMarks(pages, values);
    const fields = marks.filter((mark) => mark.kind === 'field');
    expect(new Set(fields.map((mark) => mark.field)).size).toBe(fields.length);
    for (const mark of fields) {
      const text = plain(covered(pages, mark));
      if (mark.field === 'carrier') expect(text.toLowerCase()).toBe(plain(values.carrier!).toLowerCase());
      if (mark.field === 'number') expect(text).toBe(values.number);
      if (mark.field === 'proNumber') expect(text).toBe(values.proNumber);
      if (mark.field === 'total') expect(text).toBe(amount(values.totalCents!));
      if (mark.field === 'issuedOn') expect(dates(values.issuedOn!)).toContain(text);
    }
    const flagged = values.lines.filter((line) => line.flagged);
    const tints = marks.filter((mark) => mark.kind === 'line');
    expect(tints.length).toBeLessThanOrEqual(flagged.length);
    for (const mark of tints) {
      const text = plain(covered(pages, mark));
      expect(flagged.some((line) => text.startsWith(plain(line.description)) && text.endsWith(amount(line.amountCents)))).toBe(true);
    }
    const layout = golden.layouts[0];
    // remit prints the invoice number, PRO and total twice (the bill and its stub); boxed prints every amount twice.
    if (layout === 'remit') expect(fields.map((mark) => mark.field).filter((field) => ['number', 'proNumber', 'total'].includes(field!))).toEqual([]);
    if (layout === 'boxed') expect(tints).toEqual([]);
    // The ledger prints the carrier in capitals; the carrier matches ignoring case.
    if (layout === 'ledger') expect(fields.map((mark) => mark.field)).toContain('carrier');
    // Layouts that print each value once mark them all, and every line with a finding, unless an amount is printed
    // elsewhere too: a one-line invoice's line is its total (g081), so neither is marked.
    if (['classic', 'modern', 'compact', 'ledger'].includes(layout!)) {
      const shared = (cents: number) => values.lines.filter((line) => line.amountCents === cents).length;
      const twins = (line: (typeof flagged)[number]) => values.lines.filter((other) => other.amountCents === line.amountCents && other.description === line.description).length;
      const once = ['carrier', 'issuedOn', 'number', ...(values.proNumber ? ['proNumber'] : []), ...(shared(values.totalCents!) === 0 ? ['total'] : [])];
      expect(fields.map((mark) => mark.field).sort()).toEqual(once.sort());
      expect(tints).toHaveLength(flagged.filter((line) => line.amountCents !== values.totalCents && shared(line.amountCents) === twins(line)).length);
    }
  });
});

test("g062's two identical fuel lines take their places in order: the duplicate, line 4, tints the second", async () => {
  const g062 = cases.find((each) => each.id === 'g062')!;
  const pages = await pagesOf('g062');
  const [tint, ...more] = findMarks(pages, valuesOf(g062)).filter((mark) => mark.kind === 'line');
  expect(more).toEqual([]);
  const rows = pages[0]!.filter((item) => item.str === 'FUEL').map((item) => item.transform[5]!);
  expect(rows).toHaveLength(2);
  expect(pages[0]![tint!.from.item]!.transform[5]).toBe(Math.min(...rows));
});

// Synthetic pages: one text item per line, as some layouts print them, with enough text to count as digital.
const page = (...lines: string[]): TextItem[] => [
  ...lines.map((str, row) => ({ str, transform: [10, 0, 0, 10, 40, 700 - row * 20], width: str.length * 5, height: 10, hasEOL: true })),
  { str: 'x'.repeat(100), transform: [10, 0, 0, 10, 40, 100], width: 500, height: 10, hasEOL: true },
];
const none: MarkValues = { carrier: null, number: null, issuedOn: null, proNumber: null, totalCents: null, lines: [] };

test('a value in no place, or only inside a longer number, gets no mark', () => {
  expect(findMarks([page('INVOICE 1000', 'TOTAL 2,000.00')], { ...none, number: '100', totalCents: 2_000 })).toEqual([]);
  expect(findMarks([page('INVOICE 1000')], { ...none, number: 'X-77' })).toEqual([]);
});

test('lines that share only an amount keep the one-place rule, so neither is tinted', () => {
  const lines = [
    { description: 'Detention', amountCents: 10_000, flagged: true },
    { description: 'Liftgate', amountCents: 10_000, flagged: false },
  ];
  expect(findMarks([page('Detention $100.00', 'Liftgate $100.00')], { ...none, lines })).toEqual([]);
});

test('a scanned page, with less text than the extraction reads as digital, gets no mark', () => {
  const scan: TextItem[] = [{ str: 'INVOICE 1000', transform: [10, 0, 0, 10, 40, 700], width: 60, height: 10, hasEOL: true }];
  expect(findMarks([scan], { ...none, number: '1000' })).toEqual([]);
  expect(findMarks([page('INVOICE 1000')], { ...none, number: '1000' })).toEqual([{ page: 0, kind: 'field', field: 'number', from: { item: 0, offset: 8 }, to: { item: 0, offset: 12 } }]);
});
