import { jitteredBackoff } from './queues.ts';

const hint = (retryAfterMs: number) => Object.assign(new Error('HTTP 429'), { retryAfterMs });

test('backoff doubles from 2 s to a 60 s cap with full jitter, and never undercuts Retry-After', () => {
  const highest = jitteredBackoff(2_000, 60_000, () => 1);
  expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => highest(attempt))).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  const lowest = jitteredBackoff(2_000, 60_000, () => 0);
  expect(lowest(3)).toBe(0);
  expect(lowest(3, 'jittered', hint(5_000))).toBe(5_000);
  const middle = jitteredBackoff(2_000, 60_000, () => 0.5);
  expect(middle(2)).toBe(2_000);
  expect(middle(2, 'jittered', hint(500))).toBe(2_000);
});
