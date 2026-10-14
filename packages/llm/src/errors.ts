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

// Retry-After holds delta-seconds or an HTTP date.
export function parseRetryAfter(value: string | null | undefined, now = Date.now()) {
  const text = value?.trim();
  if (!text) return undefined;
  const ms = /^\d+$/.test(text) ? Number(text) * 1_000 : Date.parse(text) - now;
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

// 408, 425, 429 and 5xx are worth retrying; any other 4xx means the request itself is wrong.
export function httpError(status: number, message: string, retryAfterMs?: number) {
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
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
// Checks names and codes, not classes: an abort is a DOMException, which may come from another realm.
export function classify(err: unknown) {
  if (err instanceof TransientError || err instanceof PermanentError) return err;
  const { name, code, cause } = (err ?? {}) as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  if (name === 'TimeoutError' || name === 'AbortError') return new TransientError('request timed out', { cause: err });
  const errorCode = cause?.code ?? code;
  if (typeof errorCode === 'string' && NETWORK_CODES.has(errorCode)) {
    return new TransientError(`connection failed: ${errorCode}`, { cause: err });
  }
  return err;
}
