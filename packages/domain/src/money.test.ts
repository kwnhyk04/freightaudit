import fc from 'fast-check';
import { BASIS_POINTS, divRound, formatUsd, linesMatchTotal, percentOf } from './index.ts';

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

test('formatUsd writes cents as dollars that read back to the same cents', () => {
  expect([0n, 5n, 123_456n, -100n, 100_000_000n].map(formatUsd)).toEqual(['$0.00', '$0.05', '$1,234.56', '-$1.00', '$1,000,000.00']);
  fc.assert(fc.property(cents, (amount) => BigInt(formatUsd(amount).replace(/[$,.]/g, '')) === amount));
});

test('linesMatchTotal holds only for the exact sum of the lines', () => {
  fc.assert(
    fc.property(fc.array(cents, { maxLength: 20 }), fc.bigInt({ min: -100n, max: 100n }), (lines, offset) => {
      const sum = lines.reduce((total, line) => total + line, 0n);
      return linesMatchTotal(lines, sum + offset) === (offset === 0n);
    }),
  );
});
