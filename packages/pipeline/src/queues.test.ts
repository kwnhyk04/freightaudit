import { jitteredBackoff, jobOptions } from './queues.ts';

const hint = (retryAfterMs: number) => Object.assign(new Error('HTTP 429'), { retryAfterMs });

test('backoff doubles from its base to its cap, jitter takes at most half a delay, and it never undercuts Retry-After', () => {
  const highest = jitteredBackoff(2_000, 60_000, () => 1);
  expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => highest(attempt))).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  const lowest = jitteredBackoff(2_000, 60_000, () => 0);
  expect([1, 2, 3, 6, 7].map((attempt) => lowest(attempt))).toEqual([1_000, 2_000, 4_000, 30_000, 30_000]);
  expect(lowest(3, 'jittered', hint(5_000))).toBe(5_000);
  const middle = jitteredBackoff(2_000, 60_000, () => 0.5);
  expect(middle(2)).toBe(3_000);
  expect(middle(2, 'jittered', hint(500))).toBe(3_000);
});

// Every wait of a job that fails on each attempt, at the jitter `random` gives, by the defaults the workers run with.
const window = (random: number) => {
  const backoff = jitteredBackoff(undefined, undefined, () => random);
  return Array.from({ length: jobOptions.attempts - 1 }, (_, i) => backoff(i + 1)).reduce((total, wait) => total + wait, 0);
};

test('a job in flight rides out a 5-minute provider outage and reaches the dead letters within 10 minutes 15 seconds of waits', () => {
  // 2.5, 5, 10, 20, 40, 80 and 150 s at the least; twice that at the most.
  expect(window(0)).toBe(307_500);
  expect(window(1)).toBe(615_000);
});
