import { testEnv } from '@freightaudit/db/testing';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { createLimits, type RoleLimits } from './limits.ts';

const redis = new Redis(testEnv('REDIS_URL'));
const prefix = `test-${randomBytes(4).toString('hex')}`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

// Limits per role; the roles a test does not use get room to spare.
const roles = (primary: RoleLimits) => ({ primary, text: { rpm: 1_000, tpm: 1e9 }, fallback: { rpm: 1_000, tpm: 1e9 } });

// A fake clock in place of the Redis clock: waits are recorded and move it forward, so nothing depends on real time.
function fakeClock() {
  const clock = {
    now: Date.parse('2026-10-14T12:00:00Z'),
    waits: [] as number[],
    sleep: async (ms: number) => {
      clock.waits.push(ms);
      clock.now += ms;
    },
  };
  return clock;
}

test('the token bucket hands out a minute of tokens at once, then makes callers wait exactly for the refill', async () => {
  const clock = fakeClock();
  // 60,000 tokens a minute refill at one token per millisecond.
  const limits = createLimits(redis, {
    prefix: `${prefix}-bucket`,
    enabled: true,
    roles: roles({ rpm: 10_000, tpm: 60_000 }),
    dailyTokenBudget: 1e9,
    clock: { now: () => clock.now, sleep: clock.sleep },
  });
  expect(await limits.take('primary', 60_000)).toEqual({ tokens: 60_000, waitedMs: 0 });
  expect(clock.waits).toEqual([]);
  // Empty: 500 tokens take 500 ms to come back, and the caller hears how long it waited.
  expect(await limits.take('primary', 500)).toEqual({ tokens: 500, waitedMs: 500 });
  expect(clock.waits).toEqual([500]);
  // 250 ms later 250 tokens are back, so 1,000 wait another 750 ms.
  clock.now += 250;
  await limits.take('primary', 1_000);
  expect(clock.waits).toEqual([500, 750]);
  // A call that used 2,000 tokens more than it reserved takes the bucket below zero; the next caller waits that out.
  await limits.record('primary', { inputTokens: 1_500, outputTokens: 500 }, 0, clock.now);
  expect(await limits.take('primary', 100)).toEqual({ tokens: 100, waitedMs: 2_100 });
  expect(clock.waits).toEqual([500, 750, 2_100]);
});

test('requests per minute are limited per role: a third request in the minute waits for one to come back', async () => {
  const clock = fakeClock();
  const limits = createLimits(redis, {
    prefix: `${prefix}-rpm`,
    enabled: true,
    roles: roles({ rpm: 2, tpm: 1e9 }),
    dailyTokenBudget: 1e9,
    clock: { now: () => clock.now, sleep: clock.sleep },
  });
  await limits.take('primary', 10);
  await limits.take('primary', 10);
  expect(clock.waits).toEqual([]);
  // Two a minute: one request comes back every 30 s. Another role's bucket is untouched.
  await limits.take('text', 10);
  expect(clock.waits).toEqual([]);
  await limits.take('primary', 10);
  expect(clock.waits).toEqual([30_000]);
});

test('the daily budget blocks model calls until the next UTC midnight, and AI off blocks them too', async () => {
  const day = `${prefix}-day`;
  const limits = createLimits(redis, { prefix: day, enabled: true, roles: roles({ rpm: 60, tpm: 60_000 }), dailyTokenBudget: 1_000 });
  const now = Date.parse('2026-10-14T15:30:00Z');
  expect(await limits.blockedUntil(now)).toBeUndefined();
  await limits.record('primary', { inputTokens: 700, outputTokens: 300 }, 1_000, now);
  expect(await redis.hgetall(`${day}:llm:day:2026-10-14`)).toEqual({ calls: '1', tokens: '1000' });
  expect(await limits.blockedUntil(now)).toBe(Date.parse('2026-10-15T00:00:00Z'));

  const off = createLimits(redis, { prefix: day, enabled: false, roles: roles({ rpm: 60, tpm: 60_000 }), dailyTokenBudget: 1e9 });
  expect(await off.blockedUntil(now)).toBe(now + 5 * 60_000);
});
