import { shipments, tmsSyncState } from '@freightaudit/db';
import { testEnv } from '@freightaudit/db/testing';
import { buildApp } from '@freightaudit/mock-tms/app';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { createTestEnv, waitFor } from './testing.ts';
import { scheduleTmsSync } from './workers.ts';

const SHIPMENTS = 1_000;

// Toxiproxy's REST API in the test run's container.
async function toxiproxy(method: string, path: string, body?: object) {
  const response = await fetch(new URL(path, testEnv('TOXIPROXY_URL')), { method, body: body && JSON.stringify(body) });
  if (!response.ok) throw new Error(`toxiproxy ${method} ${path}: HTTP ${response.status} ${await response.text()}`);
  await response.body?.cancel();
}

let tms: ReturnType<typeof buildApp> | undefined;
let env: Awaited<ReturnType<typeof createTestEnv>> | undefined;
afterAll(async () => {
  await env?.close();
  // Absent if the test failed before creating it.
  await toxiproxy('DELETE', '/proxies/tms').catch(() => {});
  await tms?.close();
});

test("the TMS sync reaches the mock's full shipment count through 20% connection resets and 300 ms latency", async () => {
  // The real mock TMS, with its 10 requests a second. It closes each connection after its response, so every page
  // opens a new one through the proxy and meets the resets; a kept-alive connection would dodge them.
  const server = (tms = buildApp({}, { shipments: SHIPMENTS }));
  server.addHook('onSend', async (_req, reply) => {
    reply.header('connection', 'close');
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const upstream = `host.docker.internal:${(server.server.address() as AddressInfo).port}`;
  await toxiproxy('POST', '/proxies', { name: 'tms', listen: testEnv('TOXIPROXY_LISTEN'), upstream, enabled: true });
  await toxiproxy('POST', '/proxies/tms/toxics', { name: 'latency', type: 'latency', stream: 'downstream', attributes: { latency: 300 } });
  await toxiproxy('POST', '/proxies/tms/toxics', { name: 'resets', type: 'reset_peer', stream: 'downstream', toxicity: 0.2, attributes: { timeout: 0 } });

  const current = (env = await createTestEnv());
  await scheduleTmsSync(current.queues, current.tenantId);
  current.runWorkers({ tmsUrl: testEnv('TOXIPROXY_LISTEN_URL') });
  const [job] = await waitFor(async () => {
    const queue = current.queues.queue('tms-sync');
    const done = [...(await queue.getCompleted()), ...(await queue.getFailed())];
    return done.length > 0 && done;
  }, 50_000);

  expect(await job!.getState()).toBe('completed');
  expect(await current.db.$count(shipments)).toBe(SHIPMENTS);
  const [state] = await current.db.select().from(tmsSyncState).where(eq(tmsSyncState.tenantId, current.tenantId));
  expect(state?.cursor).toBe(`TMS-${String(SHIPMENTS).padStart(6, '0')}`);
});
