import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { createLimits } from './limits.ts';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const prefix = `test-${randomBytes(4).toString('hex')}`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

test('the token bucket hands out a minute of tokens, then makes callers wait for the refill', async () => {
  // 60,000 tokens a minute refill at one token per millisecond.
  const limits = createLimits(redis, { prefix: `${prefix}-bucket`, enabled: true, tokensPerMinute: 60_000, dailyTokenBudget: 1e9 });
  let started = Date.now();
  expect(await limits.take(60_000)).toBe(60_000);
  expect(Date.now() - started).toBeLessThan(200);
  started = Date.now();
  await limits.take(500);
  expect(Date.now() - started).toBeGreaterThanOrEqual(400);
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
