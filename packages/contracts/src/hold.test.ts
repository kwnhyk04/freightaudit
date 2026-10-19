import { holdOf } from './hold.ts';

test('a checked invoice is held by a confirmed duplicate first, then a possible one, then any open finding, as the api says', () => {
  const charge = { type: 'RATE_MISMATCH' as const, status: 'OPEN' as const };
  const duplicate = (status: 'OPEN' | 'CONFIRMED' | 'DISMISSED') => ({ type: 'DUPLICATE_INVOICE' as const, status });
  expect(holdOf('RECONCILED', [charge, duplicate('CONFIRMED')])).toBe('CONFIRMED_DUPLICATE');
  expect(holdOf('RECONCILED', [{ ...charge, status: 'DISMISSED' }, duplicate('CONFIRMED')])).toBe('CONFIRMED_DUPLICATE');
  expect(holdOf('RECONCILED', [charge, duplicate('OPEN')])).toBe('POSSIBLE_DUPLICATE');
  expect(holdOf('RECONCILED', [charge, duplicate('DISMISSED')])).toBe('OPEN_FINDINGS');
  expect(holdOf('RECONCILED', [{ ...charge, status: 'CONFIRMED' }, duplicate('DISMISSED')])).toBeNull();
  expect(holdOf('RECONCILED', [])).toBeNull();
  // Only a checked invoice waits on a reviewer: once rejected, its confirmed duplicate holds nothing.
  expect(holdOf('REJECTED', [duplicate('CONFIRMED')])).toBeNull();
});
