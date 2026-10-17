import Anthropic from '@anthropic-ai/sdk';
import { ClaudeUnavailableError, type ClaudeUnavailableReason, httpError, parseRetryAfter, TransientError } from './errors.ts';
import type { Backup, Part } from './extract.ts';

// The output ceiling the main readers run at (Gemini 3.5 Flash-Lite and Groq's gpt-oss-120b, both 65,536 by their model
// metadata), so Claude may write as much as the models it stands behind.
export const CLAUDE_MAX_TOKENS = 65_536;

export type ClaudeLog = (fields: object, msg: string) => void;
type ClaudeOptions = { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch; log?: ClaudeLog };

// Claude as the paid backup, through the official SDK: structured output to the extraction schema, scans as base64 JPEG
// (Haiku 5.5 takes images, per its Models API capabilities). Thinking is off, since it counts against max_tokens and
// could cut the answer short. No temperature: Haiku 5.5 refuses a non-default one. SDK retries are off; the job's
// retries and the ladder handle failures. Once the account is out of credit it stays skipped for the rest of the
// process, logged once by reason.
export function createClaudeProvider({ apiKey, model, baseUrl, timeoutMs = 60_000, fetch, log = () => {} }: ClaudeOptions): Backup {
  const client = new Anthropic({ apiKey, baseURL: baseUrl, timeout: timeoutMs, maxRetries: 0, ...(fetch ? { fetch } : {}) });
  let unavailable: ClaudeUnavailableReason | undefined;
  return {
    name: 'anthropic',
    model,
    available: () => unavailable === undefined,
    async generate({ prompt, parts, schema }) {
      const started = performance.now();
      try {
        const reply = await client.messages.create({
          model,
          max_tokens: CLAUDE_MAX_TOKENS,
          thinking: { type: 'disabled' },
          system: prompt,
          messages: [{ role: 'user', content: userContent(parts) }],
          output_config: { format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
        });
        return {
          text: reply.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
          usage: { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens },
          latencyMs: Math.round(performance.now() - started),
          servedModel: reply.model,
          finishReason: reply.stop_reason ?? undefined,
        };
      } catch (err) {
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw new TransientError('request timed out', { cause: err, kind: 'timeout' });
        if (err instanceof Anthropic.APIConnectionError) throw new TransientError('connection failed', { cause: err, kind: 'network' });
        if (!(err instanceof Anthropic.APIError) || err.status === undefined) throw err;
        const reason = unavailableReason(err);
        if (reason) {
          if (!unavailable) log({ alert: 'claude_unavailable', reason, status: err.status }, 'Claude is out of credit; the free models take over for the rest of this process');
          unavailable = reason;
          throw new ClaudeUnavailableError(reason, err.status);
        }
        // The error type, never the message, which may quote the request.
        throw httpError(err.status, `anthropic HTTP ${err.status}${err.type ? ` ${err.type}` : ''}`, parseRetryAfter(err.headers?.get('retry-after')));
      }
    },
  };
}

// A spent account: a 402 billing_error, a 400 invalid_request_error about the credit balance or a spend limit, or a 429
// without retry-after. A 429 with retry-after is a normal rate limit and waits and retries like any other. Only those
// two 400 messages are read, and only to tell them apart; no message is kept.
function unavailableReason(err: InstanceType<typeof Anthropic.APIError>): ClaudeUnavailableReason | undefined {
  if (err.status === 402 || err.type === 'billing_error') return 'billing_error';
  if (err.status === 429) return err.headers?.get('retry-after') ? undefined : 'rate_limit_without_retry_after';
  if (err.status !== 400 || err.type !== 'invalid_request_error') return undefined;
  const message = String((err.error as { error?: { message?: unknown } } | undefined)?.error?.message ?? '');
  if (/credit balance/i.test(message)) return 'credit_balance';
  if (/spend(ing)? limit|usage limit/i.test(message)) return 'spend_limit';
  return undefined;
}

// Page text as text blocks, scans as base64 JPEG image blocks, each after its page label.
function userContent(parts: Part[]): Anthropic.ContentBlockParam[] {
  return parts.flatMap((part): Anthropic.ContentBlockParam[] =>
    'text' in part
      ? [{ type: 'text', text: `Page ${part.page}:\n${part.text}` }]
      : [
          { type: 'text', text: `Page ${part.page}:` },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(part.jpeg).toString('base64') } },
        ],
  );
}
