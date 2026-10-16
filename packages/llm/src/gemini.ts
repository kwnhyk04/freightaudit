import { ApiError, GoogleGenAI, type Part as GeminiPart } from '@google/genai';
import { classify, httpError, ProviderConfigError } from './errors.ts';
import type { Part, Provider } from './extract.ts';

type GeminiOptions = { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number };
type GeminiError = { error?: { status?: unknown; details?: { reason?: unknown; retryDelay?: unknown; violations?: { quotaId?: unknown }[] }[] } };

// Gemini through the Gen AI SDK. The key is passed in code, so a GOOGLE_API_KEY in the environment cannot replace it,
// and the SDK sends it in the x-goog-api-key header, never in the URL. SDK retries stay off: the job's backoff and the
// fallback model handle failures. The SDK's timeout bounds each call; passing fetch skips its undici dispatcher, which
// needs Node's own globals and fails inside Jest's sandbox.
export function createGeminiProvider({ apiKey, model, baseUrl, timeoutMs = 60_000 }: GeminiOptions): Provider {
  const ai = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { baseUrl, timeout: timeoutMs, fetch } });
  return {
    name: 'gemini',
    model,
    async generate({ prompt, parts, schema }) {
      const started = performance.now();
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }, ...parts.flatMap(toGemini)] }],
          config: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: schema },
        });
        const usage = response.usageMetadata ?? {};
        return {
          text: response.text ?? '',
          // Thinking tokens are billed as output.
          usage: { inputTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) },
          latencyMs: Math.round(performance.now() - started),
          servedModel: response.modelVersion,
          finishReason: response.candidates?.[0]?.finishReason,
        };
      } catch (err) {
        throw err instanceof ApiError ? apiError(err) : classify(err);
      }
    },
  };
}

const toGemini = (part: Part): GeminiPart[] =>
  'text' in part
    ? [{ text: `Page ${part.page}:\n${part.text}` }]
    : [{ text: `Page ${part.page}:` }, { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(part.jpeg).toString('base64') } }];

const parse = (text: string): GeminiError => {
  try {
    return JSON.parse(text) as GeminiError;
  } catch {
    return {};
  }
};
const identifier = (value: unknown) => (typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined);

// The SDK puts the whole error body in the message; only the status, the gRPC status name and the ErrorInfo reason are
// kept. An invalid key is a 400 with reason API_KEY_INVALID, as wrong as a 401. A 429 carries its wait as RetryInfo.
function apiError({ status, message }: ApiError) {
  const { error } = parse(message);
  const details = error?.details ?? [];
  const reason = details.map((detail) => identifier(detail.reason)).find(Boolean);
  // A 429's QuotaFailure names the quota it hit, such as a per-minute or a per-day one.
  const quota = details.flatMap((detail) => detail.violations ?? []).map(({ quotaId }) => quotaId).find((id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(id));
  const text = ['gemini HTTP', status, identifier(error?.status), reason, quota && `quota ${String(quota)}`].filter(Boolean).join(' ');
  if (status === 400 && reason === 'API_KEY_INVALID') return new ProviderConfigError(text, { status });
  const delay = details.map((detail) => detail.retryDelay).find((value) => typeof value === 'string' && /^\d+(\.\d+)?s$/.test(value));
  return httpError(status, text, typeof delay === 'string' ? Math.ceil(Number.parseFloat(delay) * 1_000) : undefined);
}
