// Error taxonomy for model and document work. A TransientError is retried with backoff; a PermanentError fails the
// job at once (BullMQ UnrecoverableError), and the job moves to its dead-letter queue.

// Timeouts, 429, 5xx and dropped connections. retryAfterMs is the server's minimum wait, when it sent one; status is the
// HTTP status, when a provider answered; kind marks a timeout or a lost connection.
export class TransientError extends Error {
  override name = 'TransientError';
  readonly retryAfterMs: number | undefined;
  readonly status: number | undefined;
  readonly kind: 'timeout' | 'network' | undefined;

  constructor(message: string, options: ErrorOptions & { retryAfterMs?: number; status?: number; kind?: 'timeout' | 'network' } = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
    this.kind = options.kind;
  }
}

// A bad PDF, a request the provider rejects, or model output still invalid after one repair.
export class PermanentError extends Error {
  override name = 'PermanentError';
  readonly status: number | undefined;

  constructor(message: string, options: ErrorOptions & { status?: number } = {}) {
    super(message, options);
    this.status = options.status;
  }
}

// A 429. Retried like any TransientError, but outside evals the extraction moves to the fallback model instead.
export class RateLimitError extends TransientError {
  override name = 'RateLimitError';
}

// 401, 403 or 404: a bad key or a retired model. Every job would fail the same way, so the extract queue pauses
// instead of dead-lettering them.
export class ProviderConfigError extends PermanentError {
  override name = 'ProviderConfigError';
}

// Why Claude can take no more requests: a 402 billing_error, a 400 about the credit balance or a spend limit, the usage
// tier's monthly spend cap (a 429 naming enforced_spend_limit_reached), or a 401, 403 or 404 (a bad key or model). Any
// other 429, with or without retry-after, is a rate limit like any other.
export type ClaudeUnavailableReason = 'billing_error' | 'credit_balance' | 'spend_limit' | 'bad_key_or_model';

// Claude's account cannot be used. The free models take over for good (Limits.switchClaudeOff) and the message holds the
// reason only, never the provider's text.
export class ClaudeUnavailableError extends PermanentError {
  override name = 'ClaudeUnavailableError';
  readonly reason: ClaudeUnavailableReason;

  constructor(reason: ClaudeUnavailableReason, status: number) {
    super(`anthropic unavailable: ${reason}`, { status });
    this.reason = reason;
  }
}

// Why Claude was not asked at all: past its end date, switched off, a prompt over its cap, an invoice or day over its
// budget, or the call would pass the spend cap (which switches Claude off). Nothing was sent, so no call is recorded.
export type ClaudeSkipReason = 'end_date' | 'switched_off' | 'input_cap' | 'extraction_cap' | 'daily_budget' | 'spend_cap';
export class ClaudeSkippedError extends Error {
  override name = 'ClaudeSkippedError';
  readonly reason: ClaudeSkipReason;

  constructor(reason: ClaudeSkipReason) {
    super(`claude skipped: ${reason}`);
    this.reason = reason;
  }
}

// Retry-After holds delta-seconds or an HTTP date.
export function parseRetryAfter(value: string | null | undefined, now = Date.now()) {
  const text = value?.trim();
  if (!text) return undefined;
  const ms = /^\d+$/.test(text) ? Number(text) * 1_000 : Date.parse(text) - now;
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

// 408, 425, 429 and 5xx are worth retrying; 401, 403 and 404 mean the settings are wrong; any other 4xx means the
// request itself is.
export function httpError(status: number, message: string, retryAfterMs?: number) {
  if (status === 429) return new RateLimitError(message, { retryAfterMs, status });
  if (status === 401 || status === 403 || status === 404) return new ProviderConfigError(message, { status });
  const retryable = status === 408 || status === 425 || status >= 500;
  return retryable ? new TransientError(message, { retryAfterMs, status }) : new PermanentError(message, { status });
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

// Maps a thrown fetch or socket error onto the taxonomy; anything else passes through and BullMQ retries it.
// Checks names and codes, not classes, along the cause chain: an abort is a DOMException, which may come from another
// realm, fetch puts the socket error in its cause, and the Gen AI SDK wraps both once more (under Jest).
export function classify(err: unknown) {
  if (err instanceof TransientError || err instanceof PermanentError) return err;
  const chain: { name?: unknown; code?: unknown }[] = [];
  for (let link = err; link && typeof link === 'object' && chain.length < 4; link = (link as { cause?: unknown }).cause) chain.push(link);
  if (chain.some(({ name }) => name === 'TimeoutError' || name === 'AbortError')) return new TransientError('request timed out', { cause: err, kind: 'timeout' });
  const code = chain.map((link) => link.code).find((value) => typeof value === 'string' && NETWORK_CODES.has(value));
  if (code) return new TransientError(`connection failed: ${String(code)}`, { cause: err, kind: 'network' });
  return err;
}

export type FailureClass = 'timeout' | '429' | '5xx' | 'network' | 'parse_or_schema' | 'other';
// Key-shaped tokens: Google (AIza..., AQ....), Groq (gsk_...) and OpenAI-style (sk-...) keys, and bearer tokens.
const KEY_LIKE = /\b(?:AIza[\w-]{20,}|AQ\.[\w.-]{20,}|gsk_\w{20,}|sk-[\w-]{20,})|Bearer\s+\S+/g;

// Why a model call failed, for its record: a class, the HTTP status a provider sent, and the first line of the message,
// at most 200 characters with key-shaped tokens masked. A JSON parse error keeps no text, since V8 quotes the input.
export function failureOf(err: unknown): { errorClass: FailureClass; httpStatus: number | null; errorMessage: string } {
  const ours = err instanceof TransientError || err instanceof PermanentError;
  const status = ours ? (err.status ?? null) : null;
  const errorClass: FailureClass =
    err instanceof RateLimitError
      ? '429'
      : err instanceof TransientError && err.kind
        ? err.kind
        : status !== null && status >= 500
          ? '5xx'
          : err instanceof SyntaxError || (status === 400 && /json_validate_failed/.test(String((err as Error).message)))
            ? 'parse_or_schema'
            : 'other';
  const text = err instanceof SyntaxError ? 'SyntaxError: the response is not valid JSON' : ours ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { errorClass, httpStatus: status, errorMessage: (text.split('\n', 1)[0] ?? '').replace(KEY_LIKE, '[redacted]').slice(0, 200) };
}
