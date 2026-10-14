import { percentOf } from './money.ts';

// A per-mile band of a rate card. Bands are graduated, like tax brackets: each mile pays the rate of the band it falls
// in. With bands from mile 0 at 300 cents and from mile 500 at 200 cents, 600 miles cost 500 * 300 + 100 * 200 cents.
export type MileageBand = { fromMile: number; centsPerMile: bigint };

export type RateCard = {
  // Ascending by fromMile; the first starts at mile 0.
  bands: MileageBand[];
  // The linehaul is never billed below this.
  minimumCents: bigint;
  // Fuel surcharge in basis points of the linehaul, after the minimum.
  fuelBp: bigint;
};

const isMiles = (value: number) => Number.isSafeInteger(value) && value >= 0;

// The per-mile charge for whole miles, before the minimum.
export function mileageCents(miles: number, bands: MileageBand[]) {
  if (!isMiles(miles)) throw new RangeError('miles must be a whole number, 0 or more');
  if (bands[0]?.fromMile !== 0) throw new RangeError('the first band must start at mile 0');
  let cents = 0n;
  for (const [i, band] of bands.entries()) {
    const next = bands[i + 1]?.fromMile;
    if (next !== undefined && !(isMiles(next) && next > band.fromMile)) throw new RangeError('bands must start at ascending whole miles');
    if (band.centsPerMile < 0n) throw new RangeError('a band rate must not be negative');
    const end = Math.min(miles, next ?? miles);
    if (end > band.fromMile) cents += BigInt(end - band.fromMile) * band.centsPerMile;
  }
  return cents;
}

// Linehaul, fuel surcharge and total for one shipment. Only the fuel surcharge rounds, to the nearest cent.
export function rateShipment({ bands, minimumCents, fuelBp }: RateCard, miles: number) {
  if (minimumCents < 0n || fuelBp < 0n) throw new RangeError('the minimum and fuel surcharge must not be negative');
  const mileage = mileageCents(miles, bands);
  const linehaulCents = mileage > minimumCents ? mileage : minimumCents;
  const fuelCents = percentOf(linehaulCents, fuelBp);
  return { linehaulCents, fuelCents, totalCents: linehaulCents + fuelCents };
}
