import { formatUsd } from './money.ts';
import { type RateCard, rateShipment } from './rating.ts';

// One version of a carrier's rate card, in force from the UTC day `from` up to, not including, `to`; a null bound is
// open on that side. Days are YYYY-MM-DD strings, which compare in date order.
export type RateCardVersion = {
  version: number;
  from: string | null;
  to: string | null;
  // Linehaul bands and minimum, and the fuel surcharge.
  rates: RateCard;
  // Contracted accessorials: a flat amount per charge code, such as LIFTGATE.
  accessorials: Readonly<Record<string, bigint>>;
};

// A billed line; chargeCode is null when extraction could not map its description to a code.
export type BilledLine = { lineNumber: number; chargeCode: string | null; amountCents: bigint };

export type Discrepancy = {
  type: 'rate_mismatch' | 'uncontracted_charge' | 'duplicate_charge';
  lineNumber: number;
  expectedCents: bigint;
  billedCents: bigint;
  evidence: string;
};

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// The version in force on a UTC day, or undefined before the first one. Overlapping versions are bad data.
export function versionInForce<V extends Pick<RateCardVersion, 'version' | 'from' | 'to'>>(versions: readonly V[], day: string) {
  if (!DAY.test(day)) throw new RangeError(`not a YYYY-MM-DD day: ${day}`);
  const found = versions.filter((version) => (version.from === null || version.from <= day) && (version.to === null || day < version.to));
  if (found.length > 1) throw new RangeError(`rate card versions ${found.map((version) => version.version).join(' and ')} overlap on ${day}`);
  return found[0];
}

// Rate cards are in US dollars, so only a USD invoice can be checked against them. Any other currency, or none, is the
// reason the invoice waits for a reviewer; it never defaults to USD.
export function currencyReview(currency: string | null | undefined) {
  if (currency === 'USD') return null;
  return currency?.trim() ? `unsupported_currency: ${currency.trim()}` : 'missing_currency';
}

// Checks every line against the version in force on the ship date. A line is a discrepancy only when it bills more
// than the contract allows, since undercharges favour the shipper. A charge code billed before, earlier on this invoice
// or on an earlier invoice for the same shipment (billedBefore), is a duplicate; a code the version does not contract
// is uncontracted; more than the linehaul (graduated bands, minimum), the fuel surcharge or the accessorial rate is a
// rate mismatch. At most one discrepancy per line. Findings do not change the invoice status: they wait as open
// discrepancies for a reviewer.
export function reconcileInvoice<V extends RateCardVersion>(
  versions: readonly V[],
  shipment: { shippedOn: string; miles: number; lines: readonly BilledLine[]; billedBefore?: readonly (string | null)[] },
) {
  const version = versionInForce(versions, shipment.shippedOn);
  if (!version) throw new RangeError(`no rate card version in force on ${shipment.shippedOn}`);
  const { linehaulCents, fuelCents } = rateShipment(version.rates, shipment.miles);
  const contracted = new Map([...Object.entries(version.accessorials), ['LINEHAUL', linehaulCents], ['FUEL', fuelCents]]);
  const billed = new Set(shipment.billedBefore);
  const discrepancies: Discrepancy[] = [];
  for (const { lineNumber, chargeCode: code, amountCents } of shipment.lines) {
    const rate = code === null ? undefined : contracted.get(code);
    let finding: Pick<Discrepancy, 'type' | 'expectedCents' | 'evidence'>;
    if (code !== null && billed.has(code)) {
      finding = { type: 'duplicate_charge', expectedCents: 0n, evidence: `${code} is billed twice.` };
    } else if (rate === undefined) {
      finding = { type: 'uncontracted_charge', expectedCents: 0n, evidence: `${code ?? `Line ${lineNumber}`} is not on rate card version ${version.version}.` };
    } else {
      const evidence = `Rate card version ${version.version} sets ${code} at ${formatUsd(rate)}; billed ${formatUsd(amountCents)}.`;
      finding = { type: 'rate_mismatch', expectedCents: rate, evidence };
    }
    if (amountCents > finding.expectedCents) discrepancies.push({ ...finding, lineNumber, billedCents: amountCents });
    if (code !== null) billed.add(code);
  }
  return { version, discrepancies };
}
