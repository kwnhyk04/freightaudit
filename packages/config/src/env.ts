import { writeSync } from 'node:fs';
import { z } from 'zod';

// Digits only: z.coerce.number() would turn an empty value into port 0.
const port = (fallback: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(65_535)).default(fallback);

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
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
};

type Settings = typeof settings;

// Validates the given keys of process.env; on any problem it lists them all and exits.
export function loadEnv<K extends keyof Settings>(keys: K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<Settings, K>;
  const result = z.object(shape).safeParse(process.env);
  if (result.success) return result.data;
  // Messages name the variable but never echo its value, which may be a secret.
  writeSync(2, `Invalid environment configuration (see .env.example):\n${z.prettifyError(result.error)}\n`);
  process.exit(1);
}
