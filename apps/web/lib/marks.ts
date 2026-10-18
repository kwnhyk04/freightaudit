// Document marks: where the values the AI read sit in a digital PDF's own text, so the viewer can box them. Pure: pdf.js
// supplies each page's text items, the viewer draws. A value is marked only where it appears exactly once, so a mark
// never points at the wrong place; lines identical in description and amount take their places in order.

export type TextItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
export type MarkValues = {
  carrier: string | null;
  number: string | null;
  issuedOn: string | null;
  proNumber: string | null;
  totalCents: number | null;
  // Every line, flagged when an open or disputed finding stands on it; the others matter for identical lines.
  lines: { description: string; amountCents: number; flagged: boolean }[];
};
export type Position = { item: number; offset: number };
export type Mark = { page: number; kind: 'field' | 'line'; field?: 'carrier' | 'number' | 'issuedOn' | 'proNumber' | 'total'; from: Position; to: Position };

// The extraction reads a page as text when its text layer has at least 100 non-space characters; the marks follow it.
export const isDigital = (items: readonly TextItem[]) => items.reduce((count, item) => count + item.str.replace(/\s/g, '').length, 0) >= 100;

type Normal = { text: string; at: number[] };
type Page = { starts: number[]; exact: Normal; folded: Normal };
type Place = { page: number; from: Position; to: Position };

const WORD = /[\p{L}\p{N}]/u;
// A currency sign, with the letters some print before a dollar sign (C$, US$).
const CURRENCY = /^(?:[A-Z]{1,2}\$|[$€£¥])/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Text with spaces collapsed to one, commas and currency signs dropped, and each kept character's place in the original;
// a line break stays, so no value spans two lines. fold compares ignoring case.
function normal(text: string, fold: boolean): Normal {
  let out = '';
  const at: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let char = text[index]!;
    const sign = WORD.test(text[index - 1] ?? ' ') ? undefined : CURRENCY.exec(text.slice(index, index + 3));
    if (sign) {
      index += sign[0].length - 1;
      continue;
    }
    if (char === ',') continue;
    if (char !== '\n' && /\s/.test(char)) {
      if (out.endsWith(' ')) continue;
      char = ' ';
    }
    const lower = char.toLowerCase();
    out += fold && lower.length === 1 ? lower : char;
    at.push(index);
  }
  return { text: out, at };
}

// A page's text as one string, items in their order and a newline after each line, with where each item starts.
function prepare(items: readonly TextItem[]): Page {
  let joined = '';
  const starts = items.map((item) => {
    const start = joined.length;
    joined += item.str + (item.hasEOL ? '\n' : '');
    return start;
  });
  return { starts, exact: normal(joined, false), folded: normal(joined, true) };
}

// The item holding a character of a page's joined text, and the character's offset in it.
function locate(starts: number[], index: number): Position {
  let item = 0;
  while (item + 1 < starts.length && starts[item + 1]! <= index) item++;
  return { item, offset: index - starts[item]! };
}

// Every place a value appears whole: the characters around it are no letter or digit, and no decimal point before an amount.
function find(pages: (Page | undefined)[], value: string, { fold = false, amount = false } = {}): Place[] {
  const needle = normal(value, fold).text.trim();
  const places: Place[] = [];
  if (!needle) return places;
  pages.forEach((page, number) => {
    if (!page) return;
    const { text, at } = fold ? page.folded : page.exact;
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
      const before = text[index - 1] ?? ' ';
      if (WORD.test(before) || WORD.test(text[index + needle.length] ?? ' ') || (amount && before === '.')) continue;
      const last = locate(page.starts, at[index + needle.length - 1]!);
      places.push({ page: number, from: locate(page.starts, at[index]!), to: { item: last.item, offset: last.offset + 1 } });
    }
  });
  return places;
}

// Cents as printed without signs or separators: 433970 is 4339.70.
const amountText = (cents: number) => `${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
// An ISO date in each form the invoice layouts print: 2026-03-05, 03/05/2026, Mar 5 2026 (its comma dropped), 05-MAR-2026.
function dateTexts(iso: string) {
  const [year, month, day] = iso.split('-');
  const mon = MONTHS[Number(month) - 1];
  if (!year || !day || !mon) return [iso];
  return [iso, `${month}/${day}/${year}`, `${mon} ${Number(day)} ${year}`, `${day}-${mon.toUpperCase()}-${year}`];
}

export function findMarks(raw: readonly (readonly TextItem[])[], values: MarkValues): Mark[] {
  const pages = raw.map((items) => (isDigital(items) ? prepare(items) : undefined));
  const marks: Mark[] = [];
  const field = (name: NonNullable<Mark['field']>, texts: string[], options: { fold?: boolean; amount?: boolean } = {}) => {
    const places = texts.flatMap((text) => find(pages, text, options));
    if (places.length === 1) marks.push({ page: places[0]!.page, kind: 'field', field: name, from: places[0]!.from, to: places[0]!.to });
  };
  if (values.carrier) field('carrier', [values.carrier], { fold: true });
  if (values.number) field('number', [values.number]);
  if (values.issuedOn) field('issuedOn', dateTexts(values.issuedOn));
  if (values.proNumber) field('proNumber', [values.proNumber]);
  if (values.totalCents !== null) field('total', [amountText(values.totalCents)], { amount: true });
  // A line's band runs from its description to its amount on one row. Identical lines (same description and amount)
  // take the places in order, and only when places and lines are as many.
  for (const line of values.lines) {
    if (!line.flagged) continue;
    const twins = values.lines.filter((other) => other.description === line.description && other.amountCents === line.amountCents);
    const descriptions = find(pages, line.description);
    const amounts = find(pages, amountText(line.amountCents), { amount: true });
    if (descriptions.length !== twins.length || amounts.length !== twins.length) continue;
    const rank = twins.indexOf(line);
    const [start, end] = [descriptions[rank]!, amounts[rank]!];
    const items = raw[start.page]!;
    const [first, last] = [items[start.from.item]!, items[end.to.item]!];
    const sameRow = start.page === end.page && Math.abs(first.transform[5]! - last.transform[5]!) <= Math.max(first.height, last.height) / 2;
    const ordered = end.to.item > start.from.item || (end.to.item === start.from.item && end.to.offset > start.from.offset);
    if (sameRow && ordered) marks.push({ page: start.page, kind: 'line', from: start.from, to: end.to });
  }
  return marks;
}
