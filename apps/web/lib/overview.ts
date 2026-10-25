// The overview's ranges of days, the window each one asks the api for, and its figures in the words and sizes the page
// shows.
export type Range = { key: '7d' | '4w' | '8w'; label: string; days: number };
export const RANGES: readonly Range[] = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '4w', label: '4 weeks', days: 28 },
  { key: '8w', label: '8 weeks', days: 56 },
];
const FOUR_WEEKS = RANGES[1]!;
// A range from ?range=; anything else is 4 weeks, which the address leaves out.
export const rangeOf = (raw: string | undefined) => RANGES.find((range) => range.key === raw) ?? FOUR_WEEKS;
export const rangeKey = (range: Range) => (range === FOUR_WEEKS ? undefined : range.key);

const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// The whole UTC days a range covers, the day of now the last, as the api's dashboard takes them.
export function rangeWindow(range: Range, now: Date) {
  const to = dayOf(now.getTime());
  return { from: dayOf(Date.parse(`${to}T00:00:00Z`) - (range.days - 1) * DAY), to };
}

// A figure against the same number of days just before: an arrow and a whole percent, or that there was none then.
export function changeNote(now: number, before: number, range: Range) {
  const period = `the ${range.label} before`;
  if (before === 0) return `none in ${period}`;
  if (now === before) return `no change on ${period}`;
  const percent = Math.round((Math.abs(now - before) / before) * 100);
  return `${now > before ? '↑' : '↓'} ${percent === 0 ? 'under 1' : percent}% on ${period}`;
}

// A model cost per invoice from micro-dollars, in four decimals since Claude's are fractions of a cent; the free tiers'
// $0 reads $0.00, and no other cost rounds down to it.
export const costText = (micro: number) => (micro === 0 ? '$0.00' : micro < 100 ? 'under $0.0001' : `$${(micro / 1_000_000).toFixed(4)}`);

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const compactDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const monday = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// Tokens as 38K; a gridline's money as $1.5K; a column's own label in whole dollars; a week by its Monday, as Aug 24.
export const tokensText = (tokens: number) => compact.format(tokens);
export const moneyTick = (cents: number) => compactDollars.format(cents / 100);
export const wholeDollars = (cents: number) => dollars.format(cents / 100);
export const weekLabel = (day: string) => monday.format(new Date(`${day}T00:00:00Z`));

// Gridlines for columns as tall as top: from 0 in at most four steps of 1, 2, 2.5 or 5 times a power of ten, whole
// numbers only, the last at top or just past it.
export function ticksFor(top: number) {
  if (top <= 0) return [0];
  const power = 10 ** Math.floor(Math.log10(top / 4));
  const step = [1, 2, 2.5, 5, 10].map((times) => times * power).find((each) => each >= top / 4 && Number.isInteger(each))!;
  return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
}
