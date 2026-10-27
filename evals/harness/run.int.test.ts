import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { fakeModels, replyWith } from '@freightaudit/llm/testing';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { GoldenCase } from '../golden/build.ts';
import { measure, scoreCase } from './metrics.ts';
import { evaluate, type Roles, startEnvironment } from './run.ts';

// Two golden digital cases through the real worker and reconcile against the small seed, with a fake model that
// answers each with its ground truth: a clean invoice and one with a planted rate mismatch. No real provider is called.
const IDS = ['g001', 'g054'];
const truth = IDS.map((id) => JSON.parse(readFileSync(new URL(`../golden/v1/cases/${id}.json`, import.meta.url), 'utf8')) as GoldenCase);
// The ground truth in the extraction schema, for the case whose invoice number the request's page text carries.
function answer(body: string) {
  const golden = truth.find((candidate) => body.includes(candidate.invoices[0]!.invoice_number))!;
  const invoices = golden.invoices.map(({ first_page, carrier, invoice_number, invoice_date, pro_number, currency, line_items, total_cents }) => ({
    first_page,
    carrier,
    invoice_number,
    invoice_date,
    pro_number,
    currency,
    line_items: line_items.map(({ line_number, description, charge_code, amount_cents }) => ({ line_number, description, charge_code, amount_cents })),
    subtotal_cents: null,
    tax_cents: null,
    total_cents,
  }));
  return JSON.stringify({ invoices });
}

test('the harness scores cases run through the real pipeline, caches them, and a rerun resumes from the cache', async () => {
  const fake = await fakeModels((call) => replyWith(call.protocol, answer(JSON.stringify(call.body))));
  const database = await createTestDatabase();
  const role = (provider: 'gemini' | 'groq', model: string) => ({ provider, model, baseUrl: fake.url, apiKey: 'test-key', rpm: 100_000, tpm: 1e9 });
  const roles: Roles = { primary: role('gemini', 'fake-primary'), text: role('groq', 'fake-text'), fallback: role('groq', 'fake-fallback') };
  const options = { set: 'golden' as const, subset: 'full' as const, label: 'test', roles, only: IDS, environment: (r: Roles) => startEnvironment(r, { databaseUrl: database.url, redisUrl: testEnv('REDIS_URL') }) };
  let key: string | undefined;
  try {
    const first = await evaluate(options);
    key = first.key;
    expect(first).toMatchObject({ computed: 2, stopped: undefined });
    const scores = truth.map((golden) => scoreCase(golden, first.results.get(golden.id)!));
    const metrics = Object.fromEntries(measure(scores).map((m) => [m.metric, m.value]));
    expect(metrics).toMatchObject({ header_accuracy_digital: 1, line_f1_digital: 1, overcharge_recall: 1, overcharge_precision: 1, false_flag_rate: 0, outcome_accuracy: 1 });
    const calls = fake.calls();

    // The same pins, prompt and set: every case comes from the cache and no model is called.
    const again = await evaluate(options);
    expect(again.computed).toBe(0);
    expect([...again.results.keys()].sort()).toEqual(IDS);
    expect(fake.calls()).toBe(calls);
  } finally {
    await fake.close();
    await database.drop();
    if (key) await rm(new URL(`../.cache/golden-v1/${key}/`, import.meta.url), { recursive: true, force: true });
  }
}, 120_000);

// The weekly run opens its regression issue on exit 1, and the smoke's comment calls 1 a broken floor.
test('a run that crashes exits 3, never the 1 of a broken floor', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('run.ts', import.meta.url)), '--subset', 'nope'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const [code] = await once(child, 'close');
  expect([code, stderr]).toEqual([3, expect.stringContaining('--subset must be dev, test, ci, full or compare')]);
}, 60_000);
