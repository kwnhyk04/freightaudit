import { ClaudeSkippedError, ClaudeUnavailableError } from './errors.ts';
import type { Backup, GenerateInput, Usage } from './extract.ts';

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
// What every worker process shares through Redis (Limits): the switch to the free models and Claude's UTC day.
export type ClaudeStore = {
  claudeOff(): Promise<string | undefined>;
  switchClaudeOff(reason: string): Promise<boolean>;
  reserveClaude(tokens: number, now?: number): Promise<boolean>;
  settleClaude(reserved: number, used: Usage, now?: number): Promise<void>;
};
type GateOptions = { first: boolean; until?: string | undefined; maxTokens: number; inputCap?: number | undefined; now?: () => number; log?: ClaudeLog };

// Every Claude call passes here. Past its end date, switched off, over a cap or over its day it is never sent
// (ClaudeSkippedError). An account that cannot be used switches every process to the free models, with one alert.
export function gateClaude(provider: Backup, store: ClaudeStore, { first, until, maxTokens, inputCap = CLAUDE_INPUT_CAP, now = Date.now, log = () => {} }: GateOptions): Backup {
  // Claude reads through the end date's whole UTC day.
  const end = until ? Date.parse(`${until}T00:00:00Z`) + 86_400_000 : Number.POSITIVE_INFINITY;
  // The caps from real use bind while Claude reads first; the ceiling binds always.
  const cap = first ? Math.min(inputCap, CLAUDE_PROMPT_CEILING) : CLAUDE_PROMPT_CEILING;
  let off = false;
  return {
    ...provider,
    first,
    available: () => !off && provider.available(),
    async generate(input) {
      const at = now();
      if (at >= end) throw new ClaudeSkippedError('end_date');
      if (off || (await store.claudeOff())) {
        off = true;
        throw new ClaudeSkippedError('switched_off');
      }
      const estimate = estimateInputTokens(input);
      if (estimate > cap) throw new ClaudeSkippedError('input_cap');
      const reserved = estimate + maxTokens;
      if (first && (input.claudeTokens ?? 0) + reserved > CLAUDE_EXTRACTION_CAP) throw new ClaudeSkippedError('extraction_cap');
      if (!(await store.reserveClaude(reserved, at))) throw new ClaudeSkippedError('daily_budget');
      let reply;
      try {
        reply = await provider.generate(input);
      } catch (err) {
        if (err instanceof ClaudeUnavailableError) {
          off = true;
          if (await store.switchClaudeOff(err.reason)) log({ alert: 'claude_switched_off', reason: err.reason, status: err.status }, 'Claude cannot be used: the free models read every invoice until pnpm claude:resume');
        }
        // ponytail: a failed call keeps its reservation, in case Anthropic billed it; settle it if that starves the day.
        throw err;
      }
      await store.settleClaude(reserved, reply.usage, at);
      return reply;
    },
  };
}
