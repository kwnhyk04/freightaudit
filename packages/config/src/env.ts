import { writeSync } from 'node:fs';
import { z } from 'zod';

// Digits only: z.coerce.number() would turn an empty value into 0.
const integer = (fallback: number, max = Number.MAX_SAFE_INTEGER) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(max)).default(fallback);
const port = (fallback: number) => integer(fallback, 65_535);
const perMinute = (fallback: number) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1)).default(fallback);
const httpUrl = z.url({ protocol: /^https?$/ });
// Empty means the provider's default.
const baseUrl = z.union([httpUrl, z.literal('')]).optional();

export const LLM_PROVIDERS = ['gemini', 'groq', 'mistral', 'openrouter', 'nvidia', 'ollama', 'anthropic'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
const llmProvider = z.enum(LLM_PROVIDERS);

// Every setting the services read. Each service loads only the keys it uses.
export const settings = {
  HOST: z.string().min(1).default('localhost'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: port(4000),
  WORKER_PORT: port(4001),
  MOCK_TMS_PORT: port(4010),
  // Comma-separated, so a key can be rotated without downtime.
  API_KEYS: z
    .string()
    .transform((value) => value.split(',').map((key) => key.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(32, 'each key needs at least 32 characters')).min(1, 'set at least one key')),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Prefix of every Redis key this deployment writes: queues, rate limits and AI counters.
  REDIS_PREFIX: z.string().regex(/^[\w-]+$/).default('freightaudit'),
  S3_ENDPOINT: httpUrl,
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default('invoices'),
  // ponytail: one tenant per deployment until API keys carry their tenant.
  TENANT_ID: z.uuid(),
  // Uploads get 503 while more extract jobs than this are waiting.
  EXTRACT_HIGH_WATER: integer(5_000),
  // Requests per API key and minute: everything but uploads, and the two upload routes. Load tests raise them.
  RATE_LIMIT_PER_MIN: perMinute(60),
  UPLOAD_RATE_LIMIT_PER_MIN: perMinute(10),
  // A manifest file (cases[].sha256, as evals/golden/v1/manifest.json) whose PDFs alone may be uploaded; empty accepts
  // any file. The public demo sets it, so only synthetic invoices reach it.
  UPLOAD_ALLOWLIST: z.string().default(''),
  // OpenTelemetry (api and worker): traces and metrics go as OTLP/JSON to the collector of the observability profile.
  OTEL_SDK_DISABLED: z.stringbool().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl.default('http://localhost:4318'),
  // Milliseconds between metric exports; Prometheus scrapes the collector every 15 s.
  OTEL_METRIC_EXPORT_INTERVAL: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(100)).default(15_000),
  // Kill switch: false stops every model call, and extract jobs wait instead.
  AI_ENABLED: z.stringbool().default(false),
  DAILY_AI_TOKEN_BUDGET: integer(1_000_000),
  // Model roles: provider, model, base URL and the model's free-tier requests and tokens per minute. Models pinned on
  // 2026-10-15 from each key's model list; limits from the providers' pages that day (docs/memory.md).
  LLM_PRIMARY_PROVIDER: llmProvider.default('gemini'),
  LLM_PRIMARY_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  LLM_PRIMARY_BASE_URL: baseUrl,
  LLM_PRIMARY_RPM: perMinute(15),
  LLM_PRIMARY_TPM: perMinute(250_000),
  LLM_TEXT_PROVIDER: llmProvider.default('groq'),
  LLM_TEXT_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  LLM_TEXT_BASE_URL: baseUrl,
  LLM_TEXT_RPM: perMinute(30),
  LLM_TEXT_TPM: perMinute(8_000),
  LLM_FALLBACK_PROVIDER: llmProvider.default('groq'),
  LLM_FALLBACK_MODEL: z.string().min(1).default('qwen/qwen3.8-27b'),
  LLM_FALLBACK_BASE_URL: baseUrl,
  LLM_FALLBACK_RPM: perMinute(30),
  LLM_FALLBACK_TPM: perMinute(8_000),
  // A page whose text layer has fewer non-space characters than this is read as an image, like a scan.
  LLM_TEXT_MIN_CHARS: integer(100),
  // The paid Claude backup between each role's main model and the free fallback. Empty (the default) turns it off.
  LLM_CLAUDE_MODEL: z.string().default(''),
  LLM_CLAUDE_RPM: perMinute(50),
  LLM_CLAUDE_TPM: perMinute(50_000),
  // With a UTC date, Claude reads first through the end of that day, then the free chain for good. Empty: off.
  LLM_CLAUDE_FIRST_UNTIL: z
    .union([z.literal(''), z.iso.date().refine((day) => Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), 'not a calendar date')])
    .default(''),
  // Claude's own UTC day, apart from DAILY_AI_TOKEN_BUDGET: $15 to 2026-11-10 over 21 days at $0.50 per million.
  DAILY_CLAUDE_TOKEN_BUDGET: integer(1_400_000),
  // One key per provider account; required while AI_ENABLED is true for each provider a role uses. Empty means not set.
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Empty turns the TMS sync off (the public demo bills seeded shipments only).
  MOCK_TMS_URL: z.union([httpUrl, z.literal('')]),
  // web (backend-for-frontend): the api's base URL and one of its API_KEYS. Both stay on the server.
  API_URL: httpUrl,
  API_KEY: z.string().min(32, 'API_KEY needs at least 32 characters'),
  // HMAC key of the session cookie; changing it signs everyone out.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET needs at least 32 characters'),
  // The reviewer's password as an argon2id hash in PHC form.
  DEMO_PASSWORD_HASH: z
    .string()
    .regex(
      /^[$]argon2id[$]v=19[$]m=[0-9]+,t=[0-9]+,p=[0-9]+[$][A-Za-z0-9+/]+[$][A-Za-z0-9+/]+$/,
      'DEMO_PASSWORD_HASH must be an argon2id hash; make one with pnpm --filter @freightaudit/web hash-password',
    ),
  // How long a worker owns a job before another may recover it; the lock renews at half this while the job runs.
  JOB_LOCK_MS: integer(60_000),
  // Documents the worker reads at once; the public demo reads one at a time.
  EXTRACT_CONCURRENCY: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(8)).default(8),
  // production on a machine whose database must survive; dev tools such as pnpm db:reset refuse to run there.
  NODE_ENV: z.string().optional(),
  // mock-tms fault injection: share of requests that fail with 500, and delay added to each response.
  FAULT_RATE: z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/).transform(Number).default(0),
  LATENCY_MS: integer(0),
};

type Settings = typeof settings;

// Validates the given keys of process.env; on any problem it lists them all and exits.
export function loadEnv<K extends keyof Settings>(keys: K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<Settings, K>;
  const result = z.object(shape).safeParse(process.env);
  if (result.success) return result.data;
  // Messages name the variable but never echo its value, which may be a secret.
  return configError(z.prettifyError(result.error));
}

// Also for rules that span settings, such as a key that one switch makes required.
export function configError(problems: string): never {
  writeSync(2, `Invalid environment configuration (see .env.example):\n${problems}\n`);
  process.exit(1);
}

// Every setting the model roles read, for loadEnv.
export const LLM_SETTINGS = [
  'LLM_PRIMARY_PROVIDER',
  'LLM_PRIMARY_MODEL',
  'LLM_PRIMARY_BASE_URL',
  'LLM_PRIMARY_RPM',
  'LLM_PRIMARY_TPM',
  'LLM_TEXT_PROVIDER',
  'LLM_TEXT_MODEL',
  'LLM_TEXT_BASE_URL',
  'LLM_TEXT_RPM',
  'LLM_TEXT_TPM',
  'LLM_FALLBACK_PROVIDER',
  'LLM_FALLBACK_MODEL',
  'LLM_FALLBACK_BASE_URL',
  'LLM_FALLBACK_RPM',
  'LLM_FALLBACK_TPM',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_CLAUDE_MODEL',
  'LLM_CLAUDE_RPM',
  'LLM_CLAUDE_TPM',
  'LLM_CLAUDE_FIRST_UNTIL',
] as const satisfies (keyof Settings)[];

const BASE_URLS: Record<LlmProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  ollama: 'http://localhost:11434/v1',
  anthropic: 'https://api.anthropic.com',
};
// Ollama runs locally without a key.
const KEYS = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

export type LlmRoleName = 'primary' | 'text' | 'fallback';
export type LlmRole = { provider: LlmProvider; model: string; baseUrl: string; apiKey: string | undefined; rpm: number; tpm: number };
// What loadEnv returns for these keys, optional ones optional.
type LlmEnv = z.output<z.ZodObject<Pick<Settings, (typeof LLM_SETTINGS)[number]>>>;

// The model roles from validated settings, plus what keeps them from running: a provider without its key, or a fallback
// on the primary's provider. Callers report the problems only while AI_ENABLED is true.
export function llmRoles(env: LlmEnv) {
  const role = (name: 'PRIMARY' | 'TEXT' | 'FALLBACK'): LlmRole => {
    const provider = env[`LLM_${name}_PROVIDER`];
    return {
      provider,
      model: env[`LLM_${name}_MODEL`],
      baseUrl: env[`LLM_${name}_BASE_URL`] || BASE_URLS[provider],
      apiKey: provider === 'ollama' ? undefined : env[KEYS[provider]] || undefined,
      rpm: env[`LLM_${name}_RPM`],
      tpm: env[`LLM_${name}_TPM`],
    };
  };
  const roles: Record<LlmRoleName, LlmRole> = { primary: role('PRIMARY'), text: role('TEXT'), fallback: role('FALLBACK') };
  const problems = Object.entries(roles).flatMap(([name, { provider, apiKey }]) =>
    provider === 'ollama' || apiKey ? [] : [`LLM_${name.toUpperCase()}_PROVIDER is ${provider}, which needs ${KEYS[provider]}`],
  );
  if (roles.fallback.provider === roles.primary.provider) problems.push('LLM_FALLBACK_PROVIDER must differ from LLM_PRIMARY_PROVIDER');
  // The Claude backup, only while LLM_CLAUDE_MODEL names a model; evals never take it, since a run pins one model per role.
  const claude: LlmRole | undefined = env.LLM_CLAUDE_MODEL
    ? { provider: 'anthropic', model: env.LLM_CLAUDE_MODEL, baseUrl: BASE_URLS.anthropic, apiKey: env.ANTHROPIC_API_KEY || undefined, rpm: env.LLM_CLAUDE_RPM, tpm: env.LLM_CLAUDE_TPM }
    : undefined;
  if (claude && !claude.apiKey) problems.push('LLM_CLAUDE_MODEL is set, which needs ANTHROPIC_API_KEY');
  const claudeFirst = env.LLM_CLAUDE_FIRST_UNTIL ? { until: env.LLM_CLAUDE_FIRST_UNTIL } : undefined;
  if (claudeFirst && !claude) problems.push('LLM_CLAUDE_FIRST_UNTIL is set, which needs LLM_CLAUDE_MODEL');
  return { roles, claude, claudeFirst, problems };
}
