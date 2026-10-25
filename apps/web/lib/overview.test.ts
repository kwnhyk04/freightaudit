import { changeNote, costText, moneyTick, RANGES, rangeKey, rangeOf, rangeWindow, ticksFor, tokensText, weekLabel, wholeDollars } from './overview.ts';

test('a range comes from ?range=, 4 weeks unless the address names another, which the address then carries', () => {
  expect(RANGES.map((range) => [range.key, range.label, range.days])).toEqual([
    ['7d', '7 days', 7],
    ['4w', '4 weeks', 28],
    ['8w', '8 weeks', 56],
  ]);
  expect(['7d', '4w', '8w', undefined, '', '30d', '7D'].map((raw) => rangeOf(raw).key)).toEqual(['7d', '4w', '8w', '4w', '4w', '4w', '4w']);
  expect(RANGES.map(rangeKey)).toEqual(['7d', undefined, '8w']);
});

test('a range is whole UTC days ending with the day of now, at most the 56 the api allows', () => {
  const now = new Date('2026-10-25T23:59:59.999Z');
  expect(RANGES.map((range) => rangeWindow(range, now))).toEqual([
    { from: '2026-10-19', to: '2026-10-25' },
    { from: '2026-09-28', to: '2026-10-25' },
    { from: '2026-08-31', to: '2026-10-25' },
  ]);
  // Just after midnight UTC it is the next day, whatever the server's own time zone.
  expect(rangeWindow(rangeOf('7d'), new Date('2026-10-26T00:00:00.000Z'))).toEqual({ from: '2026-10-20', to: '2026-10-26' });
});

test('a figure against the same days before reads as an arrow and a whole percent, or says there was none then', () => {
  const weeks = rangeOf('4w');
  expect(changeNote(121, 100, weeks)).toBe('↑ 21% on the 4 weeks before');
  expect(changeNote(94, 100, weeks)).toBe('↓ 6% on the 4 weeks before');
  expect(changeNote(5, 3, weeks)).toBe('↑ 67% on the 4 weeks before');
  expect(changeNote(1_001, 1_000, weeks)).toBe('↑ under 1% on the 4 weeks before');
  expect(changeNote(100, 100, rangeOf('7d'))).toBe('no change on the 7 days before');
  expect(changeNote(5, 0, rangeOf('8w'))).toBe('none in the 8 weeks before');
  expect(changeNote(0, 0, weeks)).toBe('none in the 4 weeks before');
});

test('cost, tokens, money and weeks in the words and sizes the overview shows', () => {
  // A cost per invoice in micro-dollars: the free tiers' $0, Claude's fractions of a cent, and nothing rounded to $0.
  expect([0, 385, 8_260, 1_234_567, 12].map(costText)).toEqual(['$0.00', '$0.0004', '$0.0083', '$1.2346', 'under $0.0001']);
  expect([0, 999, 2_700, 38_000, 1_250_000].map(tokensText)).toEqual(['0', '999', '2.7K', '38K', '1.3M']);
  expect([0, 50_000, 150_000, 250_000, 1_000_000].map(moneyTick)).toEqual(['$0', '$500', '$1.5K', '$2.5K', '$10K']);
  expect([161_940, 5_989].map(wholeDollars)).toEqual(['$1,619', '$60']);
  expect(['2026-08-24', '2026-10-05'].map(weekLabel)).toEqual(['Aug 24', 'Oct 5']);
});

test('gridlines start at 0 and step by 1, 2, 2.5 or 5 times a power of ten, whole numbers only, to the top value or just past it', () => {
  expect(ticksFor(0)).toEqual([0]);
  expect(ticksFor(1)).toEqual([0, 1]);
  expect(ticksFor(3)).toEqual([0, 1, 2, 3]);
  expect(ticksFor(7)).toEqual([0, 2, 4, 6, 8]);
  expect(ticksFor(11)).toEqual([0, 5, 10, 15]);
  expect(ticksFor(38)).toEqual([0, 10, 20, 30, 40]);
  expect(ticksFor(827_922)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000]);
});
