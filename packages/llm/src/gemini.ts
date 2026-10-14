import { classify, httpError, parseRetryAfter } from './errors.ts';
import type { Provider } from './extract.ts';

type GeminiOptions = { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number };
type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};
type GeminiError = { error?: { details?: { retryDelay?: unknown }[] } };

// Gemini REST generateContent with the PDF inline; it reads scanned pages as images.
// The key travels in a header, never in the URL, so it cannot leak through request logs.
export function createGeminiProvider({
  apiKey,
  model,
  baseUrl = 'https://generativelanguage.googleapis.com',
  timeoutMs = 60_000,
}: GeminiOptions): Provider {
  const url = new URL(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, baseUrl);
  return {
    name: 'gemini',
    model,
    async generate({ pdf, prompt }) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } }, { text: prompt }] }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0 },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw httpError(response.status, `gemini HTTP ${response.status}`, await retryHint(response));
        const reply = (await response.json()) as GeminiReply;
        const usage = reply.usageMetadata ?? {};
        return {
          text: reply.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '',
          // Thinking tokens are billed as output.
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          },
        };
      } catch (err) {
        throw classify(err);
      }
    },
  };
}

// The Retry-After header, else the RetryInfo delay that Google puts in 429 bodies ("37s").
async function retryHint(response: Response) {
  const body = await response.text().catch(() => '');
  const header = parseRetryAfter(response.headers.get('retry-after'));
  if (header !== undefined) return header;
  let delay: unknown;
  try {
    delay = (JSON.parse(body) as GeminiError).error?.details?.find((detail) => typeof detail.retryDelay === 'string')?.retryDelay;
  } catch {
    return undefined;
  }
  return typeof delay === 'string' && /^\d+(\.\d+)?s$/.test(delay) ? Math.ceil(Number.parseFloat(delay) * 1_000) : undefined;
}
