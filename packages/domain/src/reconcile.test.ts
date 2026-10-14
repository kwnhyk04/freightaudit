import fc from 'fast-check';
import { type BilledLine, rateShipment, reconcileInvoice, type RateCardVersion, versionInForce } from './index.ts';

// A fixed seed: every run checks the same cases, and a failure prints the counterexample it shrank to.
fc.configureGlobal({ seed: 42, numRuns: 1_000 });

const ACCESSORIALS = ['LIFTGATE', 'RESIDENTIAL', 'INSIDE_DELIVERY', 'LIMITED_ACCESS', 'APPOINTMENT', 'DETENTION'];
const DAY_MS = 86_400_000;
const day = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const dayNumber = (iso: string) => Date.parse(iso) / DAY_MS;

// A version's terms: two graduated bands, a minimum of at least a cent, a fuel surcharge, and some accessorials.
const terms = fc.record({
  rates: fc.record({
    bands: fc
      .tuple(fc.integer({ min: 1, max: 1_500 }), fc.bigInt({ min: 0n, max: 400n }), fc.bigInt({ min: 0n, max: 400n }))
      .map(([at, near, far]) => [{ fromMile: 0, centsPerMile: near }, { fromMile: at, centsPerMile: far }]),
    minimumCents: fc.bigInt({ min: 1n, max: 200_000n }),
    fuelBp: fc.bigInt({ min: 0n, max: 5_000n }),
  }),
  accessorials: fc
    .subarray(ACCESSORIALS)
    .chain((codes) =>
      fc.array(fc.bigInt({ min: 1_000n, max: 25_000n }), { minLength: codes.length, maxLength: codes.length }).map((amounts) =>
        Object.fromEntries(codes.map((code, i) => [code, amounts[i]!])),
      ),
    ),
});

// One to four versions back to back from a start day; the last stays open-ended.
const versions = fc
  .tuple(fc.integer({ min: 19_000, max: 21_000 }), fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 4 }))
  .chain(([start, lengths]) => {
    const starts = lengths.map((_, i) => start + lengths.slice(0, i).reduce((sum, length) => sum + length, 0));
    return fc.tuple(...lengths.map(() => terms)).map((all) =>
      all.map((t, i): RateCardVersion => ({ version: i + 1, from: day(starts[i]!), to: i + 1 < starts.length ? day(starts[i + 1]!) : null, ...t })),
    );
  });

// A shipment on a day the versions cover, and an invoice billing exactly what the version in force contracts: the
// linehaul, the fuel surcharge and some of its accessorials, in any order.
const billedExactly = versions.chain((list) =>
  fc.record({ offset: fc.integer({ min: 0, max: 2_000 }), miles: fc.integer({ min: 0, max: 3_000 }) }).chain(({ offset, miles }) => {
    const shippedOn = day(dayNumber(list[0]!.from) + offset);
    // Back to back, so the version in force is the last to start by the ship date.
    const version = list.findLast((candidate) => candidate.from <= shippedOn)!;
    const { linehaulCents, fuelCents } = rateShipment(version.rates, miles);
    return fc.subarray(Object.entries(version.accessorials)).chain((extras) => {
      const charges: [string, bigint][] = [['LINEHAUL', linehaulCents], ['FUEL', fuelCents], ...extras];
      return fc.shuffledSubarray(charges, { minLength: charges.length }).map((order) => ({
        versions: list,
        version,
        shipment: { shippedOn, miles },
        lines: order.map(([chargeCode, amountCents], i): BilledLine => ({ lineNumber: i + 1, chargeCode, amountCents })),
      }));
    });
  }),
);
type Case = { versions: RateCardVersion[]; shipment: { shippedOn: string; miles: number }; lines: BilledLine[] };
const reconcile = (c: Case, lines = c.lines, billedBefore?: (string | null)[]) => reconcileInvoice(c.versions, { ...c.shipment, lines, billedBefore });
const brief = (found: { type: string; lineNumber: number; expectedCents: bigint; billedCents: bigint }[]) =>
  found.map(({ type, lineNumber, expectedCents, billedCents }) => ({ type, lineNumber, expectedCents, billedCents }));

test('the version in force is the one whose days contain the ship date, and none is before the first', () => {
  fc.assert(
    fc.property(versions, fc.integer({ min: -400, max: 2_000 }), (list, offset) => {
      const shippedOn = day(dayNumber(list[0]!.from) + offset);
      const found = versionInForce(list, shippedOn);
      if (offset < 0) expect(found).toBeUndefined();
      else expect(found!.from <= shippedOn && (found!.to === null || shippedOn < found!.to)).toBe(true);
    }),
  );
  // A general rate increase applies from its first day.
  const increase = [
    { version: 1, from: '2025-01-01', to: '2026-01-01' },
    { version: 2, from: '2026-01-01', to: null },
  ];
  expect([versionInForce(increase, '2025-12-31')?.version, versionInForce(increase, '2026-01-01')?.version]).toEqual([1, 2]);
});

test('an invoice that bills exactly the contract reconciles with no discrepancies', () => {
  fc.assert(fc.property(billedExactly, (c) => expect(reconcile(c)).toEqual({ version: c.version, status: 'reconciled', discrepancies: [] })));
});

test('each overbilled line is a rate mismatch against its contracted amount, and underbilled lines are not flagged', () => {
  fc.assert(
    fc.property(billedExactly, fc.array(fc.bigInt({ min: -50_000n, max: 50_000n }), { minLength: 8, maxLength: 8 }), (c, offsets) => {
      const lines = c.lines.map((line, i) => ({ ...line, amountCents: line.amountCents + offsets[i]! }));
      const { status, discrepancies } = reconcile(c, lines);
      const over = c.lines.filter((_, i) => offsets[i]! > 0n);
      expect(brief(discrepancies)).toEqual(
        over.map((line) => ({ type: 'rate_mismatch', lineNumber: line.lineNumber, expectedCents: line.amountCents, billedCents: lines[line.lineNumber - 1]!.amountCents })),
      );
      expect(status).toBe(over.length > 0 ? 'needs_review' : 'reconciled');
    }),
  );
});

test('a charge the version in force does not contract is uncontracted, expected at nothing', () => {
  const uncontracted = billedExactly.chain((c) =>
    fc.record({
      c: fc.constant(c),
      chargeCode: fc.constantFrom<string | null>(null, 'HAZMAT', ...ACCESSORIALS.filter((code) => !(code in c.version.accessorials))),
      amountCents: fc.bigInt({ min: 1n, max: 50_000n }),
    }),
  );
  fc.assert(
    fc.property(uncontracted, ({ c, chargeCode, amountCents }) => {
      const extra = { lineNumber: c.lines.length + 1, chargeCode, amountCents };
      const { discrepancies } = reconcile(c, [...c.lines, extra]);
      expect(brief(discrepancies)).toEqual([{ type: 'uncontracted_charge', lineNumber: extra.lineNumber, expectedCents: 0n, billedCents: amountCents }]);
    }),
  );
});

test('a charge billed again, on the same invoice or an earlier one for the shipment, is a duplicate', () => {
  fc.assert(
    fc.property(billedExactly, fc.nat(), (c, pick) => {
      const copy = { ...c.lines[pick % c.lines.length]!, lineNumber: c.lines.length + 1 };
      const duplicate = { type: 'duplicate_charge', lineNumber: copy.lineNumber, expectedCents: 0n, billedCents: copy.amountCents };
      // A repeated zero amount, such as a fuel surcharge of nothing, costs nothing.
      expect(brief(reconcile(c, [...c.lines, copy]).discrepancies)).toEqual(copy.amountCents > 0n ? [duplicate] : []);
    }),
  );
  const earlier = billedExactly.chain((c) => fc.subarray(c.lines.map((line) => line.chargeCode)).map((codes) => ({ c, codes })));
  fc.assert(
    fc.property(earlier, ({ c, codes }) => {
      const repeated = c.lines.filter((line) => codes.includes(line.chargeCode) && line.amountCents > 0n);
      expect(brief(reconcile(c, c.lines, codes).discrepancies)).toEqual(
        repeated.map((line) => ({ type: 'duplicate_charge', lineNumber: line.lineNumber, expectedCents: 0n, billedCents: line.amountCents })),
      );
    }),
  );
});

test('explains each finding for the reviewer', () => {
  const version = {
    version: 2,
    from: '2026-01-01',
    to: null,
    rates: { bands: [{ fromMile: 0, centsPerMile: 250n }], minimumCents: 50_000n, fuelBp: 2_000n },
    accessorials: { LIFTGATE: 9_500n },
  };
  const lines = [
    { lineNumber: 1, chargeCode: 'LINEHAUL', amountCents: 131_250n },
    { lineNumber: 2, chargeCode: 'FUEL', amountCents: 25_000n },
    { lineNumber: 3, chargeCode: 'LIFTGATE', amountCents: 9_500n },
    { lineNumber: 4, chargeCode: 'RESIDENTIAL', amountCents: 12_000n },
    { lineNumber: 5, chargeCode: 'LIFTGATE', amountCents: 9_500n },
  ];
  // 500 miles at $2.50 is $1,250.00, and fuel is 20 % of that; the carrier billed fuel on the contract linehaul.
  expect(reconcileInvoice([version], { shippedOn: '2026-03-02', miles: 500, lines })).toEqual({
    version,
    status: 'needs_review',
    discrepancies: [
      { type: 'rate_mismatch', lineNumber: 1, expectedCents: 125_000n, billedCents: 131_250n, evidence: 'Rate card version 2 sets LINEHAUL at $1,250.00; billed $1,312.50.' },
      { type: 'uncontracted_charge', lineNumber: 4, expectedCents: 0n, billedCents: 12_000n, evidence: 'RESIDENTIAL is not on rate card version 2.' },
      { type: 'duplicate_charge', lineNumber: 5, expectedCents: 0n, billedCents: 9_500n, evidence: 'LIFTGATE is billed twice.' },
    ],
  });
});

test('refuses a ship date no version covers, overlapping versions and malformed days', () => {
  const flat = { version: 1, from: '2025-01-01', to: null, rates: { bands: [{ fromMile: 0, centsPerMile: 100n }], minimumCents: 1n, fuelBp: 0n }, accessorials: {} };
  expect(() => reconcileInvoice([flat], { shippedOn: '2024-12-31', miles: 10, lines: [] })).toThrow('no rate card version in force on 2024-12-31');
  expect(() => versionInForce([flat, { ...flat, version: 2, from: '2025-06-01' }], '2025-07-01')).toThrow('rate card versions 1 and 2 overlap');
  expect(() => versionInForce([flat], '2025-7-1')).toThrow('YYYY-MM-DD');
});
