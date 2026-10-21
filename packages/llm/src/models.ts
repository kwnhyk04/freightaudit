import { CLAUDE_MAX_TOKENS, createClaudeProvider } from './claude.ts';
import { CLAUDE_FIRST_MAX_TOKENS, type ClaudeLog, gateClaude } from './claude-first.ts';
import type { Models, Role } from './extract.ts';
import { createGeminiProvider } from './gemini.ts';
import { type Limits, metered } from './limits.ts';
import { createOpenAiProvider } from './openai.ts';
import { traced } from './trace.ts';

export type ModelConfig = { provider: string; model: string; baseUrl: string; apiKey?: string | undefined };

// Most page images one request may carry, for providers that cap it. Groq's one vision model, qwen/qwen3.8-27b, takes 3,
// and 3 scanned pages (2,048 tokens each by Groq's count) also fit its free tier's 8,000 tokens a minute.
const MAX_IMAGES: Record<string, number> = { mistral: 8, groq: 3 };

// One provider per role, each waiting on its role's limits: Gemini and Claude through their SDKs, every other provider
// through the OpenAI-compatible client. The trace span sits inside the limits, so a bucket wait is not counted as model
// time. `claude`, when given, is the paid backup between the main model and the free fallback, on its own bucket and
// day, behind its gate; with `claudeFirst` it reads first until that UTC date ends. A role may also name the anthropic
// provider, as a pinned eval run does.
export function createModels(
  roles: Record<Role, ModelConfig>,
  limits: Limits,
  { claude, claudeFirst, log, now }: { claude?: ModelConfig | undefined; claudeFirst?: { until: string } | undefined; log?: ClaudeLog; now?: () => number } = {},
): Models {
  const build = (role: Role) => {
    const { provider, model, baseUrl, apiKey } = roles[role];
    const client =
      provider === 'gemini'
        ? createGeminiProvider({ apiKey: apiKey ?? '', model, baseUrl })
        : provider === 'anthropic'
          ? createClaudeProvider({ apiKey: apiKey ?? '', model, baseUrl })
          : createOpenAiProvider({ name: provider, baseUrl, model, apiKey });
    return { ...metered(traced(client, role), limits, role), maxImages: MAX_IMAGES[provider] };
  };
  const models: Models = { primary: build('primary'), text: build('text'), fallback: build('fallback') };
  if (!claude) return models;
  const first = claudeFirst !== undefined;
  const maxTokens = first ? CLAUDE_FIRST_MAX_TOKENS : CLAUDE_MAX_TOKENS;
  const client = createClaudeProvider({ apiKey: claude.apiKey ?? '', model: claude.model, baseUrl: claude.baseUrl, maxTokens });
  const metred = { ...metered(traced(client, 'fallback'), limits, 'claude'), available: client.available };
  return { ...models, claude: gateClaude(metred, limits, { first, until: claudeFirst?.until, maxTokens, log, now }) };
}
