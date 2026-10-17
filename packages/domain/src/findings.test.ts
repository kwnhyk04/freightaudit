import fc from 'fast-check';
import { type FindingAmounts, lineExpectedCents, overchargeCents, reviewAmounts } from './index.ts';

fc.configureGlobal({ seed: 42, numRuns: 1_000 });

const finding = (status: FindingAmounts['status'], expectedCents: bigint, billedCents: bigint): FindingAmounts => ({ status, expectedCents, billedCents });

test('open and disputed findings stand; a dismissed one lets the billed amount stand', () => {
  expect(reviewAmounts(227861n, [])).toEqual({ openCents: 0n, standingCents: 0n, expectedCents: 227861n });
  expect(reviewAmounts(712409n, [finding('open', 534360n, 614514n)])).toEqual({ openCents: 80154n, standingCents: 80154n, expectedCents: 632255n });
  expect(reviewAmounts(565930n, [finding('confirmed', 86027n, 96350n)])).toEqual({ openCents: 0n, standingCents: 10323n, expectedCents: 555607n });
  expect(reviewAmounts(71498n, [finding('dismissed', 0n, 12940n)])).toEqual({ openCents: 0n, standingCents: 0n, expectedCents: 71498n });
  expect(reviewAmounts(-213076n, [])).toEqual({ openCents: 0n, standingCents: 0n, expectedCents: -213076n });
});

test("a line's expected amount is its standing finding's, else what was billed", () => {
  expect(lineExpectedCents(5989n)).toBe(5989n);
  expect(lineExpectedCents(5989n, finding('open', 0n, 5989n))).toBe(0n);
  expect(lineExpectedCents(96350n, finding('confirmed', 86027n, 96350n))).toBe(86027n);
  expect(lineExpectedCents(12940n, finding('dismissed', 0n, 12940n))).toBe(12940n);
  expect(overchargeCents({ billedCents: 731456n, expectedCents: 0n })).toBe(731456n);
});

// Findings are overcharges: the contract allows a share of what was billed, never more.
const status = fc.constantFrom<FindingAmounts['status']>('open', 'confirmed', 'dismissed');
const share = fc.integer({ min: 0, max: 100 });
const anyFinding = fc
  .record({ status, billed: fc.bigInt({ min: 0n, max: 10n ** 12n }), share })
  .map(({ status: decided, billed, share: percent }) => finding(decided, (billed * BigInt(percent)) / 100n, billed));
const total = fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n });

test('expected plus standing overcharges is the total, and no more stands open than stands at all', () => {
  fc.assert(
    fc.property(total, fc.array(anyFinding, { maxLength: 8 }), (cents, findings) => {
      const { openCents, standingCents, expectedCents } = reviewAmounts(cents, findings);
      return expectedCents + standingCents === cents && openCents >= 0n && openCents <= standingCents;
    }),
  );
});

test('dismissed findings never change the amounts', () => {
  fc.assert(
    fc.property(total, fc.array(anyFinding, { maxLength: 8 }), (cents, findings) => {
      expect(reviewAmounts(cents, findings)).toEqual(reviewAmounts(cents, findings.filter((each) => each.status !== 'dismissed')));
    }),
  );
});

test("the lines' expected amounts add up to the invoice's expected total", () => {
  // Each line carries at most one finding, on what that line billed, as reconcileInvoice writes them.
  const line = fc.record({ amount: fc.bigInt({ min: 0n, max: 10n ** 10n }), status: fc.option(status, { nil: undefined }), share });
  fc.assert(
    fc.property(fc.array(line, { maxLength: 10 }), (lines) => {
      const findings = lines.map(({ amount, status: decided, share: percent }) => decided && finding(decided, (amount * BigInt(percent)) / 100n, amount));
      const sum = lines.reduce((cents, { amount }) => cents + amount, 0n);
      const expected = lines.reduce((cents, { amount }, i) => cents + lineExpectedCents(amount, findings[i]), 0n);
      return expected === reviewAmounts(sum, findings.filter((each) => each !== undefined)).expectedCents;
    }),
  );
});
