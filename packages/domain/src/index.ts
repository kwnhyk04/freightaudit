// Pure functions: money as bigint cents, rate-card math, reconciliation. No I/O.
export { BASIS_POINTS, divRound, formatUsd, percentOf } from './money.ts';
export { mileageCents, rateShipment, type MileageBand, type RateCard } from './rating.ts';
export { reconcileInvoice, versionInForce, type BilledLine, type Discrepancy, type RateCardVersion } from './reconcile.ts';

// Arithmetic consistency: the billed line amounts add up exactly to the invoice total.
export const linesMatchTotal = (lineCents: bigint[], totalCents: bigint) =>
  lineCents.reduce((sum, cents) => sum + cents, 0n) === totalCents;
