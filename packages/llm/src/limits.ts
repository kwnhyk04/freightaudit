import { microUsd } from '@freightaudit/domain';
import type { Redis } from 'ioredis';
import { setTimeout } from 'node:timers/promises';
import type { ClaudeReservation } from './claude-first.ts';
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
// One bucket per role, and one for Claude when it is configured.
export type Bucket = Role | 'claude';
// dailyTokenBudget is the free models' UTC day, dailyClaudeBudget Claude's (none without one), and claudeSpendCap the most
// Claude may ever bill, in decimal dollars such as "15.00" (no cap without one).
export type LimitsOptions = {
  prefix: string;
  enabled: boolean;
  dailyTokenBudget: number;
  dailyClaudeBudget?: number;
  claudeSpendCap?: string | undefined;
  roles: Record<Role, RoleLimits> & { claude?: RoleLimits | undefined };
  clock?: Clock;
};

// Claude's day (KEYS[1]) and its total in micro-dollars (KEYS[2], never expiring) together: takes ARGV[1] tokens and
// ARGV[3] micro-dollars unless that passes the cap ARGV[4] (returns -1) or the day's budget ARGV[2] (returns 0); 1 when
// taken.
const RESERVE = `
local total = tonumber(redis.call('GET', KEYS[2]) or '0')
if total + tonumber(ARGV[3]) > tonumber(ARGV[4]) then return -1 end
local spent = tonumber(redis.call('HGET', KEYS[1], 'claude_tokens') or '0')
if spent + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
redis.call('HINCRBY', KEYS[1], 'claude_tokens', ARGV[1])
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCRBY', KEYS[2], ARGV[3])
return 1
`;
// Keeps the larger of Claude's total (KEYS[1]) and ARGV[1], and returns it as stored.
const SEED = `
local total = redis.call('GET', KEYS[1]) or '0'
if tonumber(ARGV[1]) > tonumber(total) then
  redis.call('SET', KEYS[1], ARGV[1])
  return ARGV[1]
end
return total
`;
const claudeOffKey = (prefix: string) => `${prefix}:llm:claude:off`;
const claudeSpentKey = (prefix: string) => `${prefix}:llm:claude:spent`;

export function createLimits(redis: Redis, { prefix, enabled, dailyTokenBudget, dailyClaudeBudget = 0, claudeSpendCap, roles, clock }: LimitsOptions) {
  const spendCap = claudeSpendCap ? microUsd(claudeSpendCap) : BigInt(Number.MAX_SAFE_INTEGER);
  const dayKey = (now: number) => `${prefix}:llm:day:${new Date(now).toISOString().slice(0, 10)}`;
  const limitsOf = (role: Bucket) => {
    const found = roles[role];
    if (!found) throw new Error(`no limits for ${role}`);
    return found;
  };
  const bucket = async (role: Bucket, tokens: number, force = false) => {
    const { rpm, tpm } = limitsOf(role);
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
    async take(role: Bucket, tokens: number) {
      const want = Math.min(tokens, limitsOf(role).tpm);
      let waitedMs = 0;
      for (let wait = await bucket(role, want); wait > 0; wait = await bucket(role, want)) {
        await sleep(wait);
        waitedMs += wait;
      }
      return { tokens: want, waitedMs };
    },
    // Why Claude is switched off for every process, until pnpm claude:resume; undefined while it is on.
    claudeOff: async () => (await redis.get(claudeOffKey(prefix))) ?? undefined,
    // Stores the first reason only; true when this call switched it.
    switchClaudeOff: async (reason: string) => (await redis.set(claudeOffKey(prefix), reason, 'NX')) === 'OK',
    // Takes `tokens` from Claude's UTC day and `micro` from its spend cap, atomically, or names what is full: the cap first.
    async reserveClaude(tokens: number, micro: bigint, now = Date.now()): Promise<'ok' | 'day' | 'cap'> {
      const taken = Number(await redis.eval(RESERVE, 2, dayKey(now), claudeSpentKey(prefix), tokens, dailyClaudeBudget, micro.toString(), spendCap.toString()));
      return taken === 1 ? 'ok' : taken === 0 ? 'day' : 'cap';
    },
    // Trues a reservation up to what the call used and billed; a call that used nothing gives it all back.
    settleClaude: async (reserved: ClaudeReservation, used: Usage, usedMicro: bigint, now = Date.now()) =>
      void (await redis
        .multi()
        .hincrby(dayKey(now), 'claude_tokens', used.inputTokens + used.outputTokens - reserved.tokens)
        .incrby(claudeSpentKey(prefix), (usedMicro - reserved.micro).toString())
        .exec()),
    // Raises Claude's total to what Postgres recorded when that is larger (a Redis that lost it), and returns the total.
    seedClaudeSpent: async (micro: bigint) => BigInt(String(await redis.eval(SEED, 1, claudeSpentKey(prefix), micro.toString()))),
    // Counts a finished call against the UTC day and trues up the role's bucket from what was taken to real usage.
    // Claude's tokens count on its own day (reserveClaude), never against the free models' budget.
    async record(role: Bucket, usage: Usage, taken: number, now = Date.now()) {
      const tokens = usage.inputTokens + usage.outputTokens;
      const key = dayKey(now);
      await redis
        .multi()
        .hincrby(key, 'calls', 1)
        .hincrby(key, 'tokens', role === 'claude' ? 0 : tokens)
        .expire(key, 2 * 86_400)
        .exec();
      if (tokens !== taken) await bucket(role, tokens - taken, true);
    },
  };
}

export type Limits = ReturnType<typeof createLimits>;

// pnpm claude:resume: Claude reads again, as configured; true when it was switched off.
export const resumeClaude = async (redis: Redis, prefix: string) => (await redis.del(claudeOffKey(prefix))) === 1;

// Design target per page: about 4,000 input and 1,200 output tokens.
const TOKENS_PER_PAGE = 5_200;

// Every call, repairs included, waits for its role's bucket, reports that wait, and counts its real tokens against the
// day.
// ponytail: a failed call keeps its reservation; refund it if 429 storms starve the bucket.
export const metered = <P extends Provider>(provider: P, limits: Limits, role: Bucket): P => ({
  ...provider,
  async generate(input) {
    const { tokens: taken, waitedMs } = await limits.take(role, input.parts.length * TOKENS_PER_PAGE);
    input.onWait?.(waitedMs);
    const output = await provider.generate(input);
    await limits.record(role, output.usage, taken);
    return output;
  },
});
