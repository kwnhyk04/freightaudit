// The recorded-fixture model provider for the system load test (README, Load test): every Gemini call gets Gemini's
// recorded reading of fixtures/scanned.pdf and every OpenAI-compatible call Groq's of fixtures/digital.pdf, each after
// a fixed latency (default 2,300 ms, the eval's measured extraction p50). It never reaches a real provider.
// Usage: pnpm --filter @freightaudit/llm fixture-models [--port=4011] [--latency-ms=2300]
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fakeModels, replyWith } from '../src/testing.ts';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4011' }, 'latency-ms': { type: 'string', default: '2300' } } });
const port = Number(values.port);
const latencyMs = Number(values['latency-ms']);
if (!Number.isInteger(port) || port < 1 || port > 65_535 || !Number.isInteger(latencyMs) || latencyMs < 0) {
  console.error('usage: fixture-models [--port=<1-65535>] [--latency-ms=<ms>]');
  process.exit(1);
}

const { url } = await fakeModels(async (call) => {
  await setTimeout(latencyMs);
  return replyWith(call.protocol);
}, port);
console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'fixture models listening', url, latencyMs }));
