import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';

// Logging and readiness shared by apps; OpenTelemetry joins later. Never record PDF contents or line items.

// Credential fields at the top level or one object deep, such as req.headers.
const redact = [
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["x-api-key"]',
  'apiKey',
  '*.apiKey',
];

// Fastify options for every service: pino JSON lines, a UUID per request, credentials redacted.
export const serverOptions = (level: string) => ({ logger: { level, redact }, genReqId: () => randomUUID() });

export type Check = () => Promise<void>;

const timeout = () => AbortSignal.timeout(2_000);

// ponytail: TCP reachability only; switch to queries on the real clients once steps 3 and 4 add them.
export const tcpCheck =
  (url: string, defaultPort: number): Check =>
  async () => {
    const { hostname, port } = new URL(url);
    const socket = connect({ host: hostname, port: Number(port) || defaultPort, signal: timeout() });
    try {
      await once(socket, 'connect');
    } finally {
      socket.destroy();
    }
  };

export const httpCheck =
  (url: string): Check =>
  async () => {
    const response = await fetch(url, { signal: timeout() });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };

type Logger = { warn(obj: object, msg: string): void };

// Runs every check in parallel; the service is ready only when all of them pass.
export async function readiness(checks: Record<string, Check>, log: Logger) {
  const results = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        await check();
        return [name, 'ok'] as const;
      } catch (err) {
        log.warn({ err, check: name }, 'readiness check failed');
        return [name, 'fail'] as const;
      }
    }),
  );
  const ready = results.every(([, result]) => result === 'ok');
  return { ready, body: { status: ready ? 'ok' : 'unavailable', checks: Object.fromEntries(results) } };
}
