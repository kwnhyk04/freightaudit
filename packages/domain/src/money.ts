// Money is integer cents in bigint: sums are exact, and every rounding step is explicit.

// numerator / denominator to the nearest integer, halves away from zero: commercial rounding, as invoices print it.
export function divRound(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // The remainder has the numerator's sign; from half the denominator on, step away from zero.
  if (2n * (remainder < 0n ? -remainder : remainder) < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

// 10,000 basis points are 100 %, so 2,350n is a 23.5 % surcharge.
export const BASIS_POINTS = 10_000n;

// `bp` basis points of an amount, to the nearest cent.
export const percentOf = (cents: bigint, bp: bigint) => divRound(cents * bp, BASIS_POINTS);

// Model call costs are integer micro-dollars (1,000,000 is $1), since one call costs a fraction of a cent.
export const MICRO_USD = 1_000_000n;

// A price list's decimal dollars ("0.075") as micro-dollars, exactly.
export function microUsd(dollars: string) {
  const match = /^(\d+)(?:[.](\d{1,6}))?$/.exec(dollars);
  if (!match) throw new RangeError('dollars must be a decimal with at most 6 places');
  return BigInt(match[1]!) * MICRO_USD + BigInt((match[2] ?? '').padEnd(6, '0'));
}

// A model call's cost in micro-dollars from its tokens and per-million-token prices in micro-dollars.
export const tokenCost = (inputTokens: bigint, outputTokens: bigint, inputPerMillion: bigint, outputPerMillion: bigint) =>
  divRound(inputTokens * inputPerMillion + outputTokens * outputPerMillion, 1_000_000n);

// Cents as US dollars for people to read, such as -$1,234.50.
export function formatUsd(cents: bigint) {
  const size = cents < 0n ? -cents : cents;
  const dollars = (size / 100n).toString().replace(/\B(?=([0-9]{3})+$)/g, ',');
  return `${cents < 0n ? '-' : ''}$${dollars}.${(size % 100n).toString().padStart(2, '0')}`;
}
