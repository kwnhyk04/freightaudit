import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';
import { e2eEnv, PASSWORD } from './e2e/env.ts';
import { hashPassword } from './lib/password.ts';

// The whole stack on this project's ports, bound to 127.0.0.1: the recorded-fixture model server, api, worker, the web
// and a second web whose api is down. A taken port stops the run (reuseExistingServer: false).
const env = { ...process.env, ...e2eEnv, DEMO_PASSWORD_HASH: await hashPassword(PASSWORD) } as Record<string, string>;
// A port that was just freed, so nothing answers there: the offline web finds its backend down.
const deadPort = await new Promise<number>((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolve(port));
  });
});
export const OFFLINE_PORT = Number(process.env.E2E_OFFLINE_PORT ?? 3002);
const web = (port: number, extra: Record<string, string> = {}) => ({
  command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
  url: `http://127.0.0.1:${port}/healthz`,
  env: { ...env, NODE_ENV: 'production', ...extra },
  reuseExistingServer: false,
});
const node = (app: string, port: number) => ({
  command: 'node --import ./src/telemetry.ts src/main.ts',
  cwd: `../${app}`,
  url: `http://127.0.0.1:${port}/healthz`,
  env,
  reuseExistingServer: false,
});

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /auth[.]setup[.]ts/ },
    { name: 'main', dependencies: ['setup'], testMatch: /main[.]spec[.]ts/, use: { storageState: 'e2e/.auth/reviewer.json' } },
    { name: 'public', dependencies: ['setup'], testMatch: /demo[.]spec[.]ts/ },
    { name: 'lockout', dependencies: ['main', 'public'], testMatch: /lockout[.]spec[.]ts/ },
    { name: 'screenshots', dependencies: ['setup'], testMatch: /screenshots[.]spec[.]ts/, use: { storageState: 'e2e/.auth/reviewer.json' } },
  ],
  webServer: [
    { command: 'pnpm --filter @freightaudit/llm fixture-models --port=4011 --latency-ms=500', port: 4011, env, reuseExistingServer: false },
    node('api', 4000),
    node('worker', 4001),
    web(3000),
    web(OFFLINE_PORT, { API_URL: `http://127.0.0.1:${deadPort}` }),
  ],
});
