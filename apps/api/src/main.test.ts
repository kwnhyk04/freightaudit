import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Boots src/main.ts in a plain Node process; main.int.test.ts runs it against real dependencies.
const main = fileURLToPath(new URL('main.ts', import.meta.url));

test('exits with a clear error that lists every missing or invalid setting without echoing values', async () => {
  const child = spawn(process.execPath, [main], {
    env: { ...process.env, DATABASE_URL: undefined, API_KEYS: 'too-short-secret' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = await once(child, 'close');
  expect(code).toBe(1);
  expect(stderr).toContain('Invalid environment configuration');
  expect(stderr).toContain('at DATABASE_URL');
  expect(stderr).toContain('at API_KEYS');
  expect(stderr).not.toContain('too-short-secret');
});
