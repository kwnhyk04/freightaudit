import { classify, httpError, parseRetryAfter } from './errors.ts';
import type { Part, Provider } from './extract.ts';

type OpenAiOptions = { name: string; baseUrl: string; model: string; apiKey?: string; timeoutMs?: number };
type ChatReply = { model?: string; choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
type ChatError = { code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } };

// One client for every OpenAI-compatible chat API (Groq, Mistral, OpenRouter, NVIDIA, Ollama): strict JSON schema output
// at temperature 0, page text as text and scans as JPEG data URLs. Ollama needs no key.
export function createOpenAiProvider({ name, baseUrl, model, apiKey, timeoutMs = 60_000 }: OpenAiOptions): Provider {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    name,
    model,
    async generate({ prompt, parts, schema }) {
      const started = performance.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: userContent(parts) },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'invoices', strict: true, schema } },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          const code = errorCode((await response.json().catch(() => ({}))) as ChatError);
          throw httpError(response.status, `${name} HTTP ${response.status}${code ? ` ${code}` : ''}`, parseRetryAfter(response.headers.get('retry-after')));
        }
        const reply = (await response.json()) as ChatReply;
        return {
          text: reply.choices?.[0]?.message?.content ?? '',
          usage: { inputTokens: reply.usage?.prompt_tokens ?? 0, outputTokens: reply.usage?.completion_tokens ?? 0 },
          latencyMs: Math.round(performance.now() - started),
          servedModel: reply.model,
        };
      } catch (err) {
        throw classify(err);
      }
    },
  };
}

const isText = (part: Part): part is Extract<Part, { text: string }> => 'text' in part;

// Text alone goes as one string, since some models (Groq's gpt-oss) take no content arrays.
function userContent(parts: Part[]) {
  const label = (part: Part) => `Page ${part.page}:`;
  if (parts.every(isText)) return parts.map((part) => `${label(part)}\n${part.text}`).join('\n\n');
  return parts.flatMap((part) =>
    'text' in part
      ? [{ type: 'text', text: `${label(part)}\n${part.text}` }]
      : [
          { type: 'text', text: label(part) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(part.jpeg).toString('base64')}` } },
        ],
  );
}

// The provider's error code, never its message: Groq's json_validate_failed message echoes the model's output, line
// items included. Mistral puts the code at the top level.
function errorCode(body: ChatError) {
  const code = body.error?.code ?? body.error?.type ?? body.code ?? body.type;
  return (typeof code === 'string' || typeof code === 'number') && /^[\w.-]{1,64}$/.test(String(code)) ? String(code) : '';
}
