// Pure functions: money as bigint cents, rate-card math, carrier matching, reconciliation. No I/O.
export { type CarrierMatchRule, matchCarrier } from './carrier.ts';
export { type Dashboard, type DashboardInvoice, dashboardOf, dashboardSpan, type InvoiceState, outcomeOf } from './dashboard.ts';
export { type FindingAmounts, type FindingStatus, lineExpectedCents, overchargeCents, reviewAmounts } from './findings.ts';
export { BASIS_POINTS, divRound, formatMoney, formatUsd, MICRO_USD, microUsd, percentOf, tokenCost } from './money.ts';
export { mileageCents, rateShipment, type MileageBand, type RateCard } from './rating.ts';
export { currencyReview, duplicateInvoice, reconcileInvoice, versionInForce, type BilledLine, type Discrepancy, type RateCardVersion } from './reconcile.ts';

// Arithmetic consistency of an extracted invoice: the lines add up to the subtotal within one cent, and subtotal plus
// tax is the total. Without a printed subtotal, the lines must add up to the total less tax, within one cent.
export function checkArithmetic({ lines, subtotal, tax, total }: { lines: bigint[]; subtotal: bigint | null; tax: bigint | null; total: bigint }) {
  const off = lines.reduce((sum, cents) => sum + cents, 0n) - (subtotal ?? total - (tax ?? 0n));
  return {
    linesMatchSubtotal: off >= -1n && off <= 1n,
    subtotalPlusTaxIsTotal: subtotal === null || subtotal + (tax ?? 0n) === total,
  };
}
