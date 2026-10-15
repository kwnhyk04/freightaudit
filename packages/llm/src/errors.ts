// Error taxonomy for model and document work. A TransientError is retried with backoff; a PermanentError fails the
// job at once (BullMQ UnrecoverableError), and the job moves to its dead-letter queue.

// Timeouts, 429, 5xx and dropped connections. retryAfterMs is the server's minimum wait, when it sent one.
export class TransientError extends Error {
  override name = 'TransientError';
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: ErrorOptions & { retryAfterMs?: number } = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

// A bad PDF, a request the provider rejects, or model output still invalid after one repair.
export class PermanentError extends Error {
  override name = 'PermanentError';
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
  if (status === 429) return new RateLimitError(message, { retryAfterMs });
  if (status === 401 || status === 403 || status === 404) return new ProviderConfigError(message);
  const retryable = status === 408 || status === 425 || status >= 500;
  return retryable ? new TransientError(message, { retryAfterMs }) : new PermanentError(message);
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
  if (chain.some(({ name }) => name === 'TimeoutError' || name === 'AbortError')) return new TransientError('request timed out', { cause: err });
  const code = chain.map((link) => link.code).find((value) => typeof value === 'string' && NETWORK_CODES.has(value));
  if (code) return new TransientError(`connection failed: ${String(code)}`, { cause: err });
  return err;
}
