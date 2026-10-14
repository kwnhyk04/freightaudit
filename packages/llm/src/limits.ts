import type { Redis } from 'ioredis';
import { setTimeout } from 'node:timers/promises';
import type { Provider, Usage } from './extract.ts';

// Token bucket in one hash: `tokens` left and `at` (ms), refilled at `capacity` per minute on the Redis clock, so all
// workers share one limit, unless ARGV[4] gives the time. Returns 0 once the tokens are taken, else the ms to wait.
// 'force' always debits, even below zero, to true up an estimate after a call.
const BUCKET = `
local capacity = tonumber(ARGV[1])
local want = tonumber(ARGV[2])
local now = tonumber(ARGV[4])
if not now then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local state = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = math.min(capacity, (tonumber(state[1]) or capacity) + (now - (tonumber(state[2]) or now)) * capacity / 60000)
local wait = 0
if ARGV[3] == 'force' or want <= tokens then
  tokens = tokens - want
else
  wait = math.ceil((want - tokens) * 60000 / capacity)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', now)
redis.call('PEXPIRE', KEYS[1], 120000)
return wait
`;

// While AI is switched off, delayed jobs check back this often.
const DISABLED_RETRY_MS = 5 * 60_000;

// The bucket's clock and waits. Without one the bucket runs on the Redis clock and waits in real time; tests pass a fake.
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export type LimitsOptions = { prefix: string; enabled: boolean; tokensPerMinute: number; dailyTokenBudget: number; clock?: Clock };

export function createLimits(redis: Redis, { prefix, enabled, tokensPerMinute, dailyTokenBudget, clock }: LimitsOptions) {
  const bucketKey = `${prefix}:llm:bucket`;
  const dayKey = (now: number) => `${prefix}:llm:day:${new Date(now).toISOString().slice(0, 10)}`;
  const bucket = async (tokens: number, force = false) =>
    Number(await redis.eval(BUCKET, 1, bucketKey, tokensPerMinute, tokens, force ? 'force' : '', clock?.now() ?? ''));
  const sleep = clock?.sleep ?? ((ms: number) => setTimeout(ms));

  return {
    // When model calls may resume: later while AI is off or the UTC day's token budget is spent, else undefined.
    async blockedUntil(now = Date.now()) {
      if (!enabled) return now + DISABLED_RETRY_MS;
      const spent = Number(await redis.hget(dayKey(now), 'tokens'));
      if (spent < dailyTokenBudget) return undefined;
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      return midnight.getTime();
    },
    // Waits until the per-minute bucket covers `tokens` (at most its size), takes them, and returns the amount taken.
    async take(tokens: number) {
      const want = Math.min(tokens, tokensPerMinute);
      for (let wait = await bucket(want); wait > 0; wait = await bucket(want)) await sleep(wait);
      return want;
    },
    // Counts a finished call against the UTC day and trues up the bucket from what was taken to real usage.
    async record(usage: Usage, taken: number, now = Date.now()) {
      const tokens = usage.inputTokens + usage.outputTokens;
      const key = dayKey(now);
      await redis.multi().hincrby(key, 'calls', 1).hincrby(key, 'tokens', tokens).expire(key, 2 * 86_400).exec();
      if (tokens !== taken) await bucket(tokens - taken, true);
    },
  };
}

export type Limits = ReturnType<typeof createLimits>;

// Design target per page: about 4,000 input and 1,200 output tokens.
const TOKENS_PER_PAGE = 5_200;

// Every call, repairs included, waits for the per-minute bucket and counts against the day.
// ponytail: a failed call keeps its reservation; refund it if 429 storms starve the bucket.
export const metered = (provider: Provider, limits: Limits): Provider => ({
  ...provider,
  async generate(input) {
    const taken = await limits.take(input.pageCount * TOKENS_PER_PAGE);
    const output = await provider.generate(input);
    await limits.record(output.usage, taken);
    return output;
  },
});
