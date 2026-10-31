import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Provider } from './extract.ts';
import type { Bucket } from './limits.ts';

// GenAI semantic conventions as of semconv v1.41.1, the last core release that defines them: v1.42.0 moved them to the
// semantic-conventions-genai repository, and they are still in development. The names are inlined rather than imported,
// so no release can rename them under these spans.
const tracer = trace.getTracerProvider().getTracer('@freightaudit/llm', undefined, { schemaUrl: 'https://opentelemetry.io/schemas/1.41.1' });
const PROVIDER_NAMES: Record<string, string> = { gemini: 'gcp.gemini', groq: 'groq', mistral: 'mistral_ai' };

// A client span around each model call, after its rate-limit wait, so its time is the provider's. It records the model,
// tokens and finish reason, never the prompt, the pages or the output. Claude's calls carry the role `claude`.
export const traced = (provider: Provider, role: Bucket): Provider => ({
  ...provider,
  generate(input) {
    const operation = provider.name === 'gemini' ? 'generate_content' : 'chat';
    const attributes = {
      'gen_ai.operation.name': operation,
      'gen_ai.provider.name': PROVIDER_NAMES[provider.name] ?? provider.name,
      'gen_ai.request.model': provider.model,
      'gen_ai.request.temperature': 0,
      'gen_ai.output.type': 'json',
      'freightaudit.llm.role': role,
      ...(input.step ? { 'freightaudit.llm.step': input.step } : {}),
    };
    return tracer.startActiveSpan(`${operation} ${provider.model}`, { kind: SpanKind.CLIENT, attributes }, async (span) => {
      try {
        const reply = await provider.generate(input);
        span.setAttributes({
          'gen_ai.usage.input_tokens': reply.usage.inputTokens,
          'gen_ai.usage.output_tokens': reply.usage.outputTokens,
          ...(reply.servedModel ? { 'gen_ai.response.model': reply.servedModel } : {}),
          ...(reply.finishReason ? { 'gen_ai.response.finish_reasons': [reply.finishReason] } : {}),
        });
        return reply;
      } catch (err) {
        // The class only (RateLimitError, TransientError, ...): messages stay out of spans.
        span.setAttribute('error.type', err instanceof Error ? err.name : 'Error');
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  },
});
