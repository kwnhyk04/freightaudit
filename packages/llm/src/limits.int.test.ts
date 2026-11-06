import { testEnv } from '@freightaudit/db/testing';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { createLimits, dayLeft, resumeClaude, type RoleLimits } from './limits.ts';

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

test("Claude has its own UTC day: its tokens never count against the free budget, and a reservation that would pass its budget is refused, even two at once", async () => {
  const day = `${prefix}-claude-day`;
  const options = { prefix: day, enabled: true, roles: { ...roles({ rpm: 60, tpm: 60_000 }), claude: { rpm: 50, tpm: 50_000 } }, dailyTokenBudget: 1_000, dailyClaudeBudget: 5_000 };
  const limits = createLimits(redis, options);
  const now = Date.parse('2026-10-21T15:00:00Z');
  expect(await limits.reserveClaude(3_000, 0n, now)).toBe('ok');
  await limits.record('claude', { inputTokens: 1_500, outputTokens: 500 }, 2_000, now);
  await limits.settleClaude({ tokens: 3_000, micro: 0n }, { inputTokens: 1_500, outputTokens: 500 }, 0n, now);
  expect(await redis.hget(`${day}:llm:day:2026-10-21`, 'claude_tokens')).toBe('2000');
  // The free budget of 1,000 is untouched by Claude's 2,000.
  expect(await limits.blockedUntil(now)).toBeUndefined();
  // 3,000 left: of two reservations of 2,000 sent at once, only one fits.
  const both = await Promise.all([limits.reserveClaude(2_000, 0n, now), createLimits(redis, options).reserveClaude(2_000, 0n, now)]);
  expect(both.sort()).toEqual(['day', 'ok']);
  expect(await limits.reserveClaude(1_001, 0n, now)).toBe('day');
  // The next UTC day starts empty.
  expect(await limits.reserveClaude(5_000, 0n, Date.parse('2026-10-22T00:00:00Z'))).toBe('ok');
});

test("Claude's spend cap: a reservation takes the day's tokens and the cap's micro-dollars together or neither, two at once never pass it, the total never expires, and a seed keeps the larger total", async () => {
  const cap = `${prefix}-claude-cap`;
  // A cap of $0.001: 1,000 micro-dollars, with nothing recorded in Postgres yet.
  const options = {
    prefix: cap,
    enabled: true,
    roles: { ...roles({ rpm: 60, tpm: 60_000 }), claude: { rpm: 50, tpm: 50_000 } },
    dailyTokenBudget: 1e9,
    dailyClaudeBudget: 10_000,
    claudeSpendCap: '0.001',
    claudeRecorded: async () => 0n,
  };
  const limits = createLimits(redis, options);
  const now = Date.parse('2026-10-31T15:00:00Z');
  const spent = async () => [await redis.get(`${cap}:llm:claude:spent`), await redis.hget(`${cap}:llm:day:2026-10-31`, 'claude_tokens')];
  expect(await limits.reserveClaude(1_000, 600n, now)).toBe('ok');
  // Settled to what the call used and billed.
  await limits.settleClaude({ tokens: 1_000, micro: 600n }, { inputTokens: 500, outputTokens: 100 }, 100n, now);
  expect(await spent()).toEqual(['100', '600']);
  expect(await redis.ttl(`${cap}:llm:claude:spent`)).toBe(-1);
  // 900 micro-dollars left: of two reservations of 600 sent at once, only one fits, and the refused one takes no tokens.
  const both = await Promise.all([limits.reserveClaude(10, 600n, now), createLimits(redis, options).reserveClaude(10, 600n, now)]);
  expect(both.sort()).toEqual(['cap', 'ok']);
  expect(await spent()).toEqual(['700', '610']);
  // A refund gives a call's whole reservation back.
  await limits.settleClaude({ tokens: 10, micro: 600n }, { inputTokens: 0, outputTokens: 0 }, 0n, now);
  expect(await spent()).toEqual(['100', '600']);
  // A full day is told apart from a reached cap, and the cap wins when both are reached.
  expect(await limits.reserveClaude(10_000, 1n, now)).toBe('day');
  expect(await limits.reserveClaude(10_000, 1_000n, now)).toBe('cap');
  // The seed from what Postgres recorded keeps the larger total, whichever it is.
  expect(await limits.seedClaudeSpent(50n)).toBe(100n);
  expect(await limits.seedClaudeSpent(950n)).toBe(950n);
  expect(await limits.reserveClaude(1, 51n, now)).toBe('cap');
});

test("a total Redis lost is seeded again from what Postgres recorded before Claude reserves, so the cap never restarts from 0, and a settle never brings it back from nothing", async () => {
  const lost = `${prefix}-claude-lost`;
  const key = `${lost}:llm:claude:spent`;
  // A cap of $0.001: 1,000 micro-dollars, 900 of them billed already as Postgres records it.
  let recorded = 900n;
  let asked = 0;
  const options = {
    prefix: lost,
    enabled: true,
    roles: { ...roles({ rpm: 60, tpm: 60_000 }), claude: { rpm: 50, tpm: 50_000 } },
    dailyTokenBudget: 1e9,
    dailyClaudeBudget: 10_000,
    claudeSpendCap: '0.001',
    claudeRecorded: async () => {
      asked++;
      return recorded;
    },
  };
  const limits = createLimits(redis, options);
  const now = Date.parse('2026-11-03T15:00:00Z');
  // No total in Redis, as after a restart that lost its data: the 900 count before anything is taken.
  expect(await redis.get(key)).toBeNull();
  expect(await limits.reserveClaude(10, 101n, now)).toBe('cap');
  expect([await redis.get(key), asked]).toEqual(['900', 1]);
  // Seeded once: the next reservation reads Redis alone.
  expect(await limits.reserveClaude(10, 100n, now)).toBe('ok');
  expect([await redis.get(key), asked]).toEqual(['1000', 1]);

  // Redis loses the total while that call runs. Its settle leaves the total missing instead of starting it from the
  // refund; Postgres records the call's 40, and the next reservation counts it.
  await redis.del(key);
  await limits.settleClaude({ tokens: 10, micro: 100n }, { inputTokens: 5, outputTokens: 1 }, 40n, now);
  expect(await redis.get(key)).toBeNull();
  recorded = 940n;
  expect(await limits.reserveClaude(10, 61n, now)).toBe('cap');
  expect([await redis.get(key), asked]).toEqual(['940', 2]);

  // Two workers that find it missing at once seed it once between them, and still never pass the cap together.
  await redis.del(key);
  const both = await Promise.all([limits.reserveClaude(10, 60n, now), createLimits(redis, options).reserveClaude(10, 60n, now)]);
  expect(both.sort()).toEqual(['cap', 'ok']);
  expect(await redis.get(key)).toBe('1000');
});

test("a spend cap needs Claude's total as Postgres records it, to seed a total Redis lost", () => {
  const options = { prefix: `${prefix}-claude-unrecorded`, enabled: true, roles: { ...roles({ rpm: 60, tpm: 60_000 }), claude: { rpm: 50, tpm: 50_000 } }, dailyTokenBudget: 1e9 };
  expect(() => createLimits(redis, { ...options, claudeSpendCap: '15.00' })).toThrow('claudeRecorded');
  expect(() => createLimits(redis, options)).not.toThrow();
});

test("what is left of the UTC day reads without taking any: Claude's tokens, the free models', and none for Claude while it is off", async () => {
  const day = `${prefix}-left`;
  const budgets = { dailyTokenBudget: 1_000, dailyClaudeBudget: 500 };
  const limits = createLimits(redis, { prefix: day, enabled: true, ...budgets, roles: roles({ rpm: 10, tpm: 1_000 }) });
  const now = Date.parse('2026-11-06T12:00:00Z');
  expect(await dayLeft(redis, day, budgets, now)).toEqual({ claude: 500, free: 1_000 });
  expect(await redis.keys(`${day}:*`)).toEqual([]);

  expect(await limits.reserveClaude(120, 0n, now)).toBe('ok');
  await limits.record('primary', { inputTokens: 200, outputTokens: 100 }, 300, now);
  expect(await dayLeft(redis, day, budgets, now)).toEqual({ claude: 380, free: 700 });
  // The next UTC day starts full.
  expect(await dayLeft(redis, day, budgets, now + 86_400_000)).toEqual({ claude: 500, free: 1_000 });

  await limits.record('primary', { inputTokens: 900, outputTokens: 900 }, 1_800, now);
  await limits.switchClaudeOff('spend_cap');
  expect(await dayLeft(redis, day, budgets, now)).toEqual({ claude: 0, free: 0 });
});

test('the switch to the free models is stored once, seen by every worker process, and stays until claude:resume clears it', async () => {
  const off = `${prefix}-claude-off`;
  const options = { prefix: off, enabled: true, roles: roles({ rpm: 60, tpm: 60_000 }), dailyTokenBudget: 1e9 };
  const limits = createLimits(redis, options);
  expect(await limits.claudeOff()).toBeUndefined();
  expect(await limits.switchClaudeOff('spend_limit')).toBe(true);
  expect(await limits.switchClaudeOff('billing_error')).toBe(false);
  // Another process, or the same worker after pnpm demo:up, reads the first reason.
  const restarted = createLimits(redis, options);
  expect(await restarted.claudeOff()).toBe('spend_limit');
  expect(await resumeClaude(redis, off)).toBe(true);
  expect(await restarted.claudeOff()).toBeUndefined();
  expect(await resumeClaude(redis, off)).toBe(false);
});
