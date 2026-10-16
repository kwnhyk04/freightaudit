import type { Redis } from 'ioredis';
import { setTimeout } from 'node:timers/promises';
import type { Provider, Role, Usage } from './extract.ts';

// One bucket per role in a hash: `requests` and `tokens` left and `at` (ms), each refilled at its per-minute capacity on
// the Redis clock, so all workers share the limits of a role's model, unless ARGV[5] gives the time. Takes a request and
// the tokens together and returns 0, else the ms to wait. 'force' debits tokens only, even below zero, to true up an
// estimate after a call.
const BUCKET = `
local rpm = tonumber(ARGV[1])
local tpm = tonumber(ARGV[2])
local want = tonumber(ARGV[3])
local now = tonumber(ARGV[5])
if not now then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local state = redis.call('HMGET', KEYS[1], 'requests', 'tokens', 'at')
local elapsed = now - (tonumber(state[3]) or now)
local requests = math.min(rpm, (tonumber(state[1]) or rpm) + elapsed * rpm / 60000)
local tokens = math.min(tpm, (tonumber(state[2]) or tpm) + elapsed * tpm / 60000)
local wait = 0
if ARGV[4] == 'force' then
  tokens = tokens - want
elseif requests >= 1 and want <= tokens then
  requests = requests - 1
  tokens = tokens - want
else
  if requests < 1 then wait = math.ceil((1 - requests) * 60000 / rpm) end
  if want > tokens then wait = math.max(wait, math.ceil((want - tokens) * 60000 / tpm)) end
end
redis.call('HSET', KEYS[1], 'requests', tostring(requests), 'tokens', tostring(tokens), 'at', now)
redis.call('PEXPIRE', KEYS[1], 120000)
return wait
`;

// While AI is switched off, delayed jobs check back this often.
const DISABLED_RETRY_MS = 5 * 60_000;

// The bucket's clock and waits. Without one the bucket runs on the Redis clock and waits in real time; tests pass a fake.
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

// A role's model limits: requests and tokens per minute.
export type RoleLimits = { rpm: number; tpm: number };
export type LimitsOptions = { prefix: string; enabled: boolean; dailyTokenBudget: number; roles: Record<Role, RoleLimits>; clock?: Clock };

export function createLimits(redis: Redis, { prefix, enabled, dailyTokenBudget, roles, clock }: LimitsOptions) {
  const dayKey = (now: number) => `${prefix}:llm:day:${new Date(now).toISOString().slice(0, 10)}`;
  const bucket = async (role: Role, tokens: number, force = false) => {
    const { rpm, tpm } = roles[role];
    return Number(await redis.eval(BUCKET, 1, `${prefix}:llm:bucket:${role}`, rpm, tpm, tokens, force ? 'force' : '', clock?.now() ?? ''));
  };
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
    // Waits until the role's bucket has a request and `tokens` (at most a minute's worth), takes them, and returns the
    // tokens taken and the ms it waited for them.
    async take(role: Role, tokens: number) {
      const want = Math.min(tokens, roles[role].tpm);
      let waitedMs = 0;
      for (let wait = await bucket(role, want); wait > 0; wait = await bucket(role, want)) {
        await sleep(wait);
        waitedMs += wait;
      }
      return { tokens: want, waitedMs };
    },
    // Counts a finished call against the UTC day and trues up the role's bucket from what was taken to real usage.
    async record(role: Role, usage: Usage, taken: number, now = Date.now()) {
      const tokens = usage.inputTokens + usage.outputTokens;
      const key = dayKey(now);
      await redis.multi().hincrby(key, 'calls', 1).hincrby(key, 'tokens', tokens).expire(key, 2 * 86_400).exec();
      if (tokens !== taken) await bucket(role, tokens - taken, true);
    },
  };
}

export type Limits = ReturnType<typeof createLimits>;

// Design target per page: about 4,000 input and 1,200 output tokens.
const TOKENS_PER_PAGE = 5_200;

// Every call, repairs included, waits for its role's bucket, reports that wait, and counts its real tokens against the
// day.
// ponytail: a failed call keeps its reservation; refund it if 429 storms starve the bucket.
export const metered = (provider: Provider, limits: Limits, role: Role): Provider => ({
  ...provider,
  async generate(input) {
    const { tokens: taken, waitedMs } = await limits.take(role, input.parts.length * TOKENS_PER_PAGE);
    input.onWait?.(waitedMs);
    const output = await provider.generate(input);
    await limits.record(role, output.usage, taken);
    return output;
  },
});
