// The overview's ranges of days, the window each one asks the api for, and its figures in the words and sizes the page
// shows.
export type Range = { key: '7d' | '4w' | '8w'; label: string; short: string; days: number };
export const RANGES: readonly Range[] = [
  { key: '7d', label: '7 days', short: '7D', days: 7 },
  { key: '4w', label: '4 weeks', short: '4W', days: 28 },
  { key: '8w', label: '8 weeks', short: '8W', days: 56 },
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

// A day (or week) of the overview's charts, and how many of its invoices the pipeline finished: matched the rate card,
// needed a reviewer or failed.
export type Bucket = { day: string; received: number; matchedRateCard: number; neededReviewer: number; failed: number; overbilledCents: number };
export const processed = (bucket: Bucket) => bucket.matchedRateCard + bucket.neededReviewer + bucket.failed;

// A line chart's points in percent of its plot, y from the top: each week centred in its share of the width, as high as
// its share of the top gridline.
const hundredths = (value: number) => Math.round(value * 100) / 100;
export const weekPoints = (values: readonly number[], top: number) =>
  values.map((value, i) => [hundredths(((i + 0.5) / values.length) * 100), hundredths(100 - (value / top) * 100)] as const);
// The curve through those points as count samples, after Web3Bento's smooth(): each segment eases from one point to the
// next, flat at both, so it never overshoots a value. The count is fixed, so a line can morph from one range to another.
type Point = readonly [number, number];
export function sampled(points: readonly Point[], count: number): Point[] {
  const [x0] = points[0]!;
  const [xn] = points.at(-1)!;
  return Array.from({ length: count }, (_, k) => {
    const x = x0 + ((xn - x0) * k) / (count - 1);
    const i = Math.min(Math.max(0, points.findLastIndex(([px]) => px <= x)), points.length - 2);
    if (i < 0) return points[0]!;
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const u = Math.min(1, Math.max(0, (x - ax) / (bx - ax)));
    return [hundredths(x), hundredths(ay + (by - ay) * u * u * (3 - 2 * u))] as const;
  });
}
export const path = (points: readonly Point[]) => `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')}`;

// Gridlines for columns as tall as top: from 0 in at most four steps of 1, 2, 2.5 or 5 times a power of ten, whole
// numbers only, the last at top or just past it.
export function ticksFor(top: number) {
  if (top <= 0) return [0];
  const power = 10 ** Math.floor(Math.log10(top / 4));
  const step = [1, 2, 2.5, 5, 10].map((times) => times * power).find((each) => each >= top / 4 && Number.isInteger(each))!;
  return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
}
