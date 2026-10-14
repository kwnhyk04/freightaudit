import { testEnv } from '@freightaudit/db/testing';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { createLimits } from './limits.ts';

const redis = new Redis(testEnv('REDIS_URL'));
const prefix = `test-${randomBytes(4).toString('hex')}`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

test('the token bucket hands out a minute of tokens at once, then makes callers wait exactly for the refill', async () => {
  // A fake clock in place of the Redis clock: waits are recorded and move it forward, so nothing depends on real time.
  let now = Date.parse('2026-10-14T12:00:00Z');
  const waits: number[] = [];
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
  };
  // 60,000 tokens a minute refill at one token per millisecond.
  const limits = createLimits(redis, { prefix: `${prefix}-bucket`, enabled: true, tokensPerMinute: 60_000, dailyTokenBudget: 1e9, clock });
  expect(await limits.take(60_000)).toBe(60_000);
  expect(waits).toEqual([]);
  // Empty: 500 tokens take 500 ms to come back.
  expect(await limits.take(500)).toBe(500);
  expect(waits).toEqual([500]);
  // 250 ms later 250 tokens are back, so 1,000 wait another 750 ms.
  now += 250;
  await limits.take(1_000);
  expect(waits).toEqual([500, 750]);
  // A call that used 2,000 tokens more than it reserved takes the bucket below zero; the next caller waits that out.
  await limits.record({ inputTokens: 1_500, outputTokens: 500 }, 0, now);
  expect(await limits.take(100)).toBe(100);
  expect(waits).toEqual([500, 750, 2_100]);
});

test('the daily budget blocks model calls until the next UTC midnight, and AI off blocks them too', async () => {
  const day = `${prefix}-day`;
  const limits = createLimits(redis, { prefix: day, enabled: true, tokensPerMinute: 60_000, dailyTokenBudget: 1_000 });
  const now = Date.parse('2026-10-14T15:30:00Z');
  expect(await limits.blockedUntil(now)).toBeUndefined();
  await limits.record({ inputTokens: 700, outputTokens: 300 }, 1_000, now);
  expect(await redis.hgetall(`${day}:llm:day:2026-10-14`)).toEqual({ calls: '1', tokens: '1000' });
  expect(await limits.blockedUntil(now)).toBe(Date.parse('2026-10-15T00:00:00Z'));

  const off = createLimits(redis, { prefix: day, enabled: false, tokensPerMinute: 60_000, dailyTokenBudget: 1e9 });
  expect(await off.blockedUntil(now)).toBe(now + 5 * 60_000);
});
