// Provider layer: error taxonomy, PDF pages, extraction with repair and fallback, Gemini and OpenAI-compatible clients,
// shared AI limits and call prices. The model only extracts data; code checks every amount it returns.
export { CLAUDE_MAX_TOKENS, createClaudeProvider } from './claude.ts';
export { CLAUDE_EXTRACTION_CAP, CLAUDE_FIRST_MAX_TOKENS, CLAUDE_INPUT_CAP, CLAUDE_PROMPT_CEILING, type ClaudeLog, estimateInputTokens, gateClaude } from './claude-first.ts';
export {
  ClaudeUnavailableError,
  type ClaudeUnavailableReason,
  classify,
  httpError,
  parseRetryAfter,
  PermanentError,
  ProviderConfigError,
  RateLimitError,
  TransientError,
} from './errors.ts';
export {
  type Backup,
  type Call,
  type ClaudeHandoff,
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_PROMPT,
  type ExtractedInvoice,
  type Extraction,
  extractInvoices,
  type GenerateInput,
  type Models,
  type Part,
  type Provider,
  type Reply,
  type Role,
  type Step,
  type Usage,
} from './extract.ts';
export { createGeminiProvider } from './gemini.ts';
export { createLimits, type Limits, metered, resumeClaude, type RoleLimits } from './limits.ts';
export { createModels, type ModelConfig } from './models.ts';
export { createOpenAiProvider } from './openai.ts';
export { readPages } from './pages.ts';
export { imageToPdf, MAX_PAGES, readPdf, splitPdf } from './pdf.ts';
export { callCost, hasPrice, paidCost } from './prices.ts';
