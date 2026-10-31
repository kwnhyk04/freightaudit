import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_FIRST_MAX_TOKENS } from './claude-first.ts';
import { ClaudeUnavailableError, type ClaudeUnavailableReason, httpError, parseRetryAfter, TransientError } from './errors.ts';
import type { Part, Provider } from './extract.ts';

type ClaudeOptions = { apiKey: string; model: string; baseUrl?: string | undefined; timeoutMs?: number | undefined; fetch?: typeof fetch; maxTokens?: number };

// Claude through the official SDK: structured output to the extraction schema, scans as base64 JPEG (Haiku 5.5 takes
// images, per its Models API capabilities). Thinking is off, since it counts against max_tokens and could cut the answer
// short. No temperature: Haiku 5.5 refuses a non-default one. SDK retries are off; the ladder and the job's retries
// handle failures. Every call passes Claude's gate (claude-first.ts), which keeps Claude off once its account cannot be
// used.
export function createClaudeProvider({ apiKey, model, baseUrl, timeoutMs = 60_000, fetch, maxTokens = CLAUDE_FIRST_MAX_TOKENS }: ClaudeOptions): Provider {
  const client = new Anthropic({ apiKey, baseURL: baseUrl, timeout: timeoutMs, maxRetries: 0, ...(fetch ? { fetch } : {}) });
  return {
    name: 'anthropic',
    model,
    async generate({ prompt, parts, schema }) {
      const started = performance.now();
      try {
        const reply = await client.messages.create({
          model,
          max_tokens: maxTokens,
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
        if (reason) throw new ClaudeUnavailableError(reason, err.status);
        // The error type, never the message, which may quote the request.
        throw httpError(err.status, `anthropic HTTP ${err.status}${err.type ? ` ${err.type}` : ''}`, parseRetryAfter(err.headers?.get('retry-after')));
      }
    },
  };
}

// An account that cannot be used: a 402 billing_error; the usage tier's monthly spend cap, a 429 whose details name
// enforced_spend_limit_reached (it has no retry-after and fails until the month ends); a 400 invalid_request_error about
// the credit balance or a spend limit; or a 401, 403 or 404 (a bad key or model). Any other 429 is a rate limit. Only
// those two 400 messages are read, and only to tell them apart; no message is kept.
function unavailableReason(err: InstanceType<typeof Anthropic.APIError>): ClaudeUnavailableReason | undefined {
  const { error } = (err.error ?? {}) as { error?: { message?: unknown; details?: { error_code?: unknown } | null } };
  if (error?.details?.error_code === 'enforced_spend_limit_reached') return 'spend_limit';
  if (err.status === 402 || err.type === 'billing_error') return 'billing_error';
  if (err.status === 401 || err.status === 403 || err.status === 404) return 'bad_key_or_model';
  if (err.status !== 400 || err.type !== 'invalid_request_error') return undefined;
  const message = String(error?.message ?? '');
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
