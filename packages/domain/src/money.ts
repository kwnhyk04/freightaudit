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

// Cents as US dollars for people to read, such as -$1,234.50.
export function formatUsd(cents: bigint) {
  const size = cents < 0n ? -cents : cents;
  const dollars = (size / 100n).toString().replace(/\B(?=([0-9]{3})+$)/g, ',');
  return `${cents < 0n ? '-' : ''}$${dollars}.${(size % 100n).toString().padStart(2, '0')}`;
}
