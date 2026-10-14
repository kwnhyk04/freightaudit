import { writeSync } from 'node:fs';
import { z } from 'zod';

// Digits only: z.coerce.number() would turn an empty value into 0.
const integer = (fallback: number, max = Number.MAX_SAFE_INTEGER) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(max)).default(fallback);
const port = (fallback: number) => integer(fallback, 65_535);
const httpUrl = z.url({ protocol: /^https?$/ });

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
  // Kill switch: false stops every model call, and extract jobs wait instead.
  AI_ENABLED: z.stringbool().default(false),
  DAILY_AI_TOKEN_BUDGET: integer(1_000_000),
  LLM_TOKENS_PER_MINUTE: integer(250_000),
  // Required when AI_ENABLED is true, which the worker checks; empty means not set.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_BASE_URL: httpUrl.default('https://generativelanguage.googleapis.com'),
  MOCK_TMS_URL: httpUrl,
  // How long a worker owns a job before another may recover it; the lock renews at half this while the job runs.
  JOB_LOCK_MS: integer(60_000),
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
