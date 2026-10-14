// Pure functions: money as bigint cents, rate-card math, reconciliation. No I/O.

// Arithmetic consistency: the billed line amounts add up exactly to the invoice total.
export const linesMatchTotal = (lineCents: bigint[], totalCents: bigint) =>
  lineCents.reduce((sum, cents) => sum + cents, 0n) === totalCents;
