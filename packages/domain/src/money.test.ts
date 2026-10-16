import fc from 'fast-check';
import { BASIS_POINTS, checkArithmetic, divRound, formatMoney, formatUsd, MICRO_USD, microUsd, percentOf, tokenCost } from './index.ts';

// A fixed seed: every run checks the same cases, and a failure prints the counterexample it shrank to.
fc.configureGlobal({ seed: 42, numRuns: 1_000 });

const abs = (n: bigint) => (n < 0n ? -n : n);
const cents = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const divisor = fc.bigInt({ min: 1n, max: 10n ** 6n });

test('rounds to the nearest integer: never more than half away from the exact quotient', () => {
  fc.assert(fc.property(cents, divisor, (n, d) => 2n * abs(n - divRound(n, d) * d) <= d));
});

test('rounds halves away from zero', () => {
  // n is exactly k + 1/2 times d.
  const half = fc.record({ k: fc.bigInt({ min: 0n, max: 10n ** 12n }), d: divisor.map((x) => 2n * x), negative: fc.boolean() });
  fc.assert(
    fc.property(half, ({ k, d, negative }) => {
      const n = k * d + d / 2n;
      return negative ? divRound(-n, d) === -(k + 1n) : divRound(n, d) === k + 1n;
    }),
  );
});

test('is symmetric around zero, never decreases, and is exact on multiples', () => {
  fc.assert(fc.property(cents, divisor, (n, d) => divRound(-n, d) === -divRound(n, d)));
  fc.assert(
    fc.property(cents, cents, divisor, (a, b, d) => {
      const [low, high] = a <= b ? [a, b] : [b, a];
      return divRound(low, d) <= divRound(high, d);
    }),
  );
  fc.assert(fc.property(cents, divisor, (k, d) => divRound(k * d, d) === k));
});

test('refuses a zero or negative denominator', () => {
  expect(() => divRound(1n, 0n)).toThrow(RangeError);
  expect(() => divRound(1n, -2n)).toThrow(RangeError);
});

test('percentOf takes basis points of an amount to the nearest cent', () => {
  expect(percentOf(12_345n, 2_350n)).toBe(2_901n); // 2,901.075 cents
  expect(percentOf(10n, 500n)).toBe(1n); // half a cent rounds away from zero
  expect(percentOf(-10n, 500n)).toBe(-1n);
  fc.assert(fc.property(cents, (amount) => percentOf(amount, BASIS_POINTS) === amount && percentOf(amount, 0n) === 0n));
});

test('formatMoney shows cents exactly in their currency, with no float on the way', () => {
  expect(formatMoney(123_456n)).toBe('$1,234.56');
  expect(formatMoney(-213_076, 'USD')).toBe('-$2,130.76');
  expect(formatMoney(5n, 'CAD')).toBe('CA$0.05');
  expect(formatMoney(100n, 'eur')).toBe('$1.00');
  // Amounts past the float's exact range still read back digit for digit.
  fc.assert(
    fc.property(cents, (n) => {
      const digits = formatMoney(n).replace(/[$,]/g, '');
      return BigInt(digits.replace('.', '')) === n;
    }),
  );
});

test('formatUsd writes cents as dollars that read back to the same cents', () => {
  expect([0n, 5n, 123_456n, -100n, 100_000_000n].map(formatUsd)).toEqual(['$0.00', '$0.05', '$1,234.56', '-$1.00', '$1,000,000.00']);
  fc.assert(fc.property(cents, (amount) => BigInt(formatUsd(amount).replace(/[$,.]/g, '')) === amount));
});

test('lines must add up to the subtotal within one cent, and subtotal plus tax must be the total exactly', () => {
  const offset = fc.bigInt({ min: -100n, max: 100n });
  fc.assert(
    fc.property(fc.array(cents, { maxLength: 20 }), offset, fc.option(cents, { nil: null }), offset, (lines, off, tax, totalOff) => {
      const subtotal = lines.reduce((total, line) => total + line, 0n) + off;
      const checked = checkArithmetic({ lines, subtotal, tax, total: subtotal + (tax ?? 0n) + totalOff });
      return checked.linesMatchSubtotal === abs(off) <= 1n && checked.subtotalPlusTaxIsTotal === (totalOff === 0n);
    }),
  );
});

test('without a printed subtotal, lines must add up to the total less tax within one cent', () => {
  fc.assert(
    fc.property(fc.array(cents, { maxLength: 20 }), fc.bigInt({ min: -100n, max: 100n }), fc.option(cents, { nil: null }), (lines, off, tax) => {
      const total = lines.reduce((sum, line) => sum + line, 0n) + off + (tax ?? 0n);
      const checked = checkArithmetic({ lines, subtotal: null, tax, total });
      return checked.linesMatchSubtotal === abs(off) <= 1n && checked.subtotalPlusTaxIsTotal;
    }),
  );
});

test('prices parse exactly to micro-dollars, and a call costs its tokens at those prices', () => {
  expect(['0.30', '2.50', '0.075', '12', '0.000001'].map(microUsd)).toEqual([300_000n, 2_500_000n, 75_000n, 12n * MICRO_USD, 1n]);
  for (const bad of ['', '1.0000001', '-1', '1e3', '$1']) expect(() => microUsd(bad)).toThrow(RangeError);
  // 1,108 input and 43 output tokens at $0.30 and $2.50 per million: 332.4 + 107.5 = 439.9 micro-dollars.
  expect(tokenCost(1_108n, 43n, microUsd('0.30'), microUsd('2.50'))).toBe(440n);
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 10n ** 7n }), fc.bigInt({ min: 0n, max: 10n ** 7n }), (input, output) => {
      // A million tokens of each at whole-dollar prices cost exactly those dollars.
      return tokenCost(input * 1_000_000n, output * 1_000_000n, 2n * MICRO_USD, 3n * MICRO_USD) === (2n * input + 3n * output) * MICRO_USD;
    }),
  );
});
