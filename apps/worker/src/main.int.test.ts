import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createTestEnv } from './testing.ts';

// Boots src/main.ts in a plain Node process, outside the Jest realm, against the test run's Postgres and Redis.
const main = fileURLToPath(new URL('main.ts', import.meta.url));
let env: Awaited<ReturnType<typeof createTestEnv>>;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const settings = () => ({
  ...process.env,
  HOST: '127.0.0.1',
  WORKER_PORT: '0',
  LOG_LEVEL: 'info',
  DATABASE_URL: env.databaseUrl,
  REDIS_PREFIX: env.prefix,
  TENANT_ID: env.tenantId,
  MOCK_TMS_URL: 'http://127.0.0.1:9',
});

test('with AI_ENABLED unset (false), the worker starts without any model key and answers its probes', async () => {
  const child = spawn(process.execPath, [main], { env: settings(), stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    let baseUrl = '';
    for await (const line of createInterface({ input: child.stdout! })) {
      const { msg } = (line.startsWith('{') ? JSON.parse(line) : {}) as { msg?: string };
      if (msg?.startsWith('Server listening at ')) {
        baseUrl = msg.slice('Server listening at '.length);
        break;
      }
    }
    child.stdout!.resume();
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});

test('with AI_ENABLED=true it exits 1, naming every missing key and a fallback on the primary provider, never a value', async () => {
  const child = spawn(process.execPath, [main], {
    env: { ...settings(), AI_ENABLED: 'true', LLM_FALLBACK_PROVIDER: 'gemini', GROQ_API_KEY: 'groq-secret-value' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = await once(child, 'close');
  expect(code).toBe(1);
  expect(stderr).toContain('Invalid environment configuration');
  expect(stderr).toContain('LLM_PRIMARY_PROVIDER is gemini, which needs GEMINI_API_KEY');
  expect(stderr).toContain('LLM_FALLBACK_PROVIDER is gemini, which needs GEMINI_API_KEY');
  expect(stderr).toContain('LLM_FALLBACK_PROVIDER must differ from LLM_PRIMARY_PROVIDER');
  expect(stderr).not.toContain('LLM_TEXT_PROVIDER');
  expect(stderr).not.toContain('groq-secret-value');
});
