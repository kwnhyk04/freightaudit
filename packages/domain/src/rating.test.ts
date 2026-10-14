import fc from 'fast-check';
import { BASIS_POINTS, type MileageBand, mileageCents, rateShipment } from './index.ts';

// A fixed seed: every run checks the same cases, and a failure prints the counterexample it shrank to.
fc.configureGlobal({ seed: 42, numRuns: 1_000 });

// Up to five bands with ascending starts from mile 0, at up to $20.00 a mile.
const bands = fc
  .tuple(fc.uniqueArray(fc.integer({ min: 1, max: 3_000 }), { maxLength: 4 }), fc.array(fc.bigInt({ min: 0n, max: 2_000n }), { minLength: 5, maxLength: 5 }))
  .map(([starts, rates]) => [0, ...starts.sort((a, b) => a - b)].map((fromMile, i) => ({ fromMile, centsPerMile: rates[i]! })));
const card = fc.record({ bands, minimumCents: fc.bigInt({ min: 0n, max: 500_000n }), fuelBp: fc.bigInt({ min: 0n, max: BASIS_POINTS }) });
const miles = fc.integer({ min: 0, max: 5_000 });

// The rate of the band that mile number `mile` (counted from 0) falls in.
const rateAt = (list: MileageBand[], mile: number) => list.findLast((band) => band.fromMile <= mile)!.centsPerMile;

test('prices the example card: graduated bands, a minimum and a 23.5 % fuel surcharge', () => {
  const example = { bands: [{ fromMile: 0, centsPerMile: 300n }, { fromMile: 500, centsPerMile: 200n }], minimumCents: 100_000n, fuelBp: 2_350n };
  // 500 miles at $3.00 and 100 at $2.00; fuel is 23.5 % of $1,700.00.
  expect(rateShipment(example, 600)).toEqual({ linehaulCents: 170_000n, fuelCents: 39_950n, totalCents: 209_950n });
  // 10 miles cost $30.00, under the $1,000.00 minimum, and fuel applies to the minimum.
  expect(rateShipment(example, 10)).toEqual({ linehaulCents: 100_000n, fuelCents: 23_500n, totalCents: 123_500n });
});

test('each extra mile costs the rate of the band it falls in, from nothing at mile 0', () => {
  fc.assert(fc.property(bands, (list) => mileageCents(0, list) === 0n));
  fc.assert(fc.property(bands, miles, (list, m) => mileageCents(m + 1, list) - mileageCents(m, list) === rateAt(list, m)));
});

test('splitting a band at any mile, at the same rate, changes no price', () => {
  fc.assert(
    fc.property(bands, fc.integer({ min: 1, max: 6_000 }), miles, (list, at, m) => {
      fc.pre(list.every((band) => band.fromMile !== at));
      const split = [...list, { fromMile: at, centsPerMile: rateAt(list, at) }].sort((a, b) => a.fromMile - b.fromMile);
      return mileageCents(m, split) === mileageCents(m, list);
    }),
  );
});

test('the linehaul is the mileage charge or the minimum, whichever is higher, and the total adds up exactly', () => {
  fc.assert(
    fc.property(card, miles, (rates, m) => {
      const { linehaulCents, fuelCents, totalCents } = rateShipment(rates, m);
      const mileage = mileageCents(m, rates.bands);
      return (
        linehaulCents >= mileage &&
        linehaulCents >= rates.minimumCents &&
        (linehaulCents === mileage || linehaulCents === rates.minimumCents) &&
        totalCents === linehaulCents + fuelCents
      );
    }),
  );
});

test('the fuel surcharge is its percentage of the linehaul, within half a cent', () => {
  fc.assert(
    fc.property(card, miles, (rates, m) => {
      const { linehaulCents, fuelCents } = rateShipment(rates, m);
      const error = fuelCents * BASIS_POINTS - linehaulCents * rates.fuelBp;
      return 2n * (error < 0n ? -error : error) <= BASIS_POINTS;
    }),
  );
});

test('charges never fall as the distance grows', () => {
  fc.assert(
    fc.property(card, miles, miles, (rates, a, b) => {
      const near = rateShipment(rates, Math.min(a, b));
      const far = rateShipment(rates, Math.max(a, b));
      return near.linehaulCents <= far.linehaulCents && near.totalCents <= far.totalCents;
    }),
  );
});

test('refuses partial or negative miles and malformed cards', () => {
  const flat = [{ fromMile: 0, centsPerMile: 300n }];
  expect(() => mileageCents(1.5, flat)).toThrow('whole number');
  expect(() => mileageCents(-1, flat)).toThrow('whole number');
  expect(() => mileageCents(10, [])).toThrow('mile 0');
  expect(() => mileageCents(10, [{ fromMile: 5, centsPerMile: 300n }])).toThrow('mile 0');
  expect(() => mileageCents(10, [...flat, { fromMile: 0, centsPerMile: 200n }])).toThrow('ascending');
  expect(() => mileageCents(10, [{ fromMile: 0, centsPerMile: -1n }])).toThrow('negative');
  expect(() => rateShipment({ bands: flat, minimumCents: -1n, fuelBp: 0n }, 10)).toThrow('negative');
  expect(() => rateShipment({ bands: flat, minimumCents: 0n, fuelBp: -1n }, 10)).toThrow('negative');
});
