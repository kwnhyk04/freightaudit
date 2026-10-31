import { ClaudeSkippedError, ClaudeUnavailableError, PermanentError, TransientError } from './errors.ts';
import type { GenerateInput, Provider, Usage } from './extract.ts';
import { callCost } from './prices.ts';

// Caps while Claude reads first, sized from Haiku's real use on the golden PDFs the demo accepts (its 2026-10-17 run,
// docs/memory.md) with about 10% headroom, so it is never cut off mid-work on them.
// Output per call: the largest reply was 462 tokens (g084); g083, which never ran on Haiku, projects to about 510.
export const CLAUDE_FIRST_MAX_TOKENS = 560;
// Input per call, estimated before sending: the largest prompt was 6,373 tokens (g079, a 3-page scan), estimated 6,521.
export const CLAUDE_INPUT_CAP = 7_100;
// Above 100,000 input tokens Haiku charges 5x (packages/llm/prices.json): no prompt goes past it, whatever the cap.
export const CLAUDE_PROMPT_CEILING = 100_000;
// One invoice's Claude tokens, the next call's reservation included: g053's repair came to about 7,750 that way.
export const CLAUDE_EXTRACTION_CAP = 8_500;

// Text at 1.5 characters a token, which never undercounted the 70 recorded Haiku first passes (1.02 to 1.09 times their
// billed input); a page image at width x height / 750 plus its label, or 2,100 when its JPEG gives no size.
const CHARS_PER_TOKEN = 1.5;
export function estimateInputTokens({ prompt, parts, schema }: Pick<GenerateInput, 'prompt' | 'parts' | 'schema'>) {
  let tokens = Math.ceil((prompt.length + JSON.stringify(schema).length) / CHARS_PER_TOKEN);
  for (const part of parts) {
    if ('text' in part) tokens += Math.ceil(`Page ${part.page}:\n${part.text}`.length / CHARS_PER_TOKEN);
    else {
      const size = jpegSize(part.jpeg);
      tokens += size ? Math.ceil((size.width * size.height) / 750) + 10 : 2_100;
    }
  }
  return tokens;
}

// A JPEG's size from its start-of-frame segment.
function jpegSize(bytes: Uint8Array) {
  for (let i = 2; i + 8 < bytes.length; i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!)) {
    const marker = bytes[i + 1]!;
    if (bytes[i] !== 0xff) return undefined;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
  }
  return undefined;
}

export type ClaudeLog = (fields: object, msg: string) => void;
// What a call holds of Claude's day and spend cap until it settles: its tokens, and its cost in micro-dollars.
export type ClaudeReservation = { tokens: number; micro: bigint };
// What every worker process shares through Redis (Limits): the switch to the free models, Claude's UTC day and its spend
// cap. A reservation takes the day's tokens and the cap's micro-dollars together, or names what is full, the cap first.
export type ClaudeStore = {
  claudeOff(): Promise<string | undefined>;
  switchClaudeOff(reason: string): Promise<boolean>;
  reserveClaude(tokens: number, micro: bigint, now?: number): Promise<'ok' | 'day' | 'cap'>;
  settleClaude(reserved: ClaudeReservation, used: Usage, usedMicro: bigint, now?: number): Promise<void>;
};
type GateOptions = { until?: string | undefined; maxTokens?: number; inputCap?: number | undefined; now?: () => number; log?: ClaudeLog };

const NOTHING: Usage = { inputTokens: 0, outputTokens: 0 };

// Every Claude call passes here. Past its end date, switched off, over a cap, over its day or past the spend cap it is
// never sent (ClaudeSkippedError). An account that cannot be used, or the spend cap reached, switches every process to the
// free models for good, with one alert.
export function gateClaude(provider: Provider, store: ClaudeStore, { until, maxTokens = CLAUDE_FIRST_MAX_TOKENS, inputCap = CLAUDE_INPUT_CAP, now = Date.now, log = () => {} }: GateOptions): Provider {
  // Claude reads through the end date's whole UTC day.
  const end = until ? Date.parse(`${until}T00:00:00Z`) + 86_400_000 : Number.POSITIVE_INFINITY;
  // The caps from real use bind, and no prompt passes the ceiling, whatever cap a caller gives.
  const cap = Math.min(inputCap, CLAUDE_PROMPT_CEILING);
  const price = (usage: Usage) => callCost(provider.name, provider.model, usage);
  let off = false;
  const switchOff = async (reason: string, status?: number) => {
    off = true;
    if (!(await store.switchClaudeOff(reason))) return;
    if (status === undefined) log({ alert: 'claude_switched_off', reason }, 'Claude reached its spend cap: the free models read every invoice until the cap is raised and pnpm claude:resume runs');
    else log({ alert: 'claude_switched_off', reason, status }, 'Claude cannot be used: the free models read every invoice until pnpm claude:resume');
  };
  return {
    ...provider,
    async generate(input) {
      const at = now();
      if (at >= end) throw new ClaudeSkippedError('end_date');
      if (off || (await store.claudeOff())) {
        off = true;
        throw new ClaudeSkippedError('switched_off');
      }
      const estimate = estimateInputTokens(input);
      if (estimate > cap) throw new ClaudeSkippedError('input_cap');
      // The worst case: the estimate and a full reply, at the model's prices.
      const reserved = { tokens: estimate + maxTokens, micro: price({ inputTokens: estimate, outputTokens: maxTokens }) };
      if ((input.claudeTokens ?? 0) + reserved.tokens > CLAUDE_EXTRACTION_CAP) throw new ClaudeSkippedError('extraction_cap');
      const taken = await store.reserveClaude(reserved.tokens, reserved.micro, at);
      if (taken === 'day') throw new ClaudeSkippedError('daily_budget');
      if (taken === 'cap') {
        await switchOff('spend_cap');
        throw new ClaudeSkippedError('spend_cap');
      }
      let reply;
      try {
        reply = await provider.generate(input);
      } catch (err) {
        if (err instanceof ClaudeUnavailableError) await switchOff(err.reason, err.status);
        // Anthropic bills no call it answered with an error, so that reservation comes back; a timeout or a lost connection
        // may have been billed, so it keeps its reservation.
        if ((err instanceof TransientError || err instanceof PermanentError) && err.status !== undefined) await store.settleClaude(reserved, NOTHING, 0n, at);
        throw err;
      }
      await store.settleClaude(reserved, reply.usage, price(reply.usage), at);
      return reply;
    },
  };
}
