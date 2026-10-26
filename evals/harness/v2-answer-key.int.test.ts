import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { fakeModels, replyWith } from '@freightaudit/llm/testing';
import { readFileSync } from 'node:fs';
import type { GoldenCase, Manifest } from '../golden/build.ts';
import { scoreCase } from './metrics.ts';
import { type Roles, runCase, startEnvironment } from './run.ts';

// The first digital case of each v2 kind through the real worker and reconcile, with a fake model that answers each
// request with the truth: whatever a perfect reader returns must end exactly as the answer key says. No real provider
// is called.
const root = new URL('../golden/v2/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as Manifest;
const firsts = new Map<string, string>();
for (const entry of manifest.cases) if (entry.path === 'digital' && !firsts.has(entry.kind)) firsts.set(entry.kind, entry.id);
const cases = [...firsts.values()].map((id) => JSON.parse(readFileSync(new URL(`cases/${id}.json`, root), 'utf8')) as GoldenCase);

// The truth for the invoices whose numbers a request carries: the whole upload, or one part split from it, which
// starts on its own page 1.
function answer(body: string) {
  const golden = cases.find((candidate) => candidate.invoices.some((invoice) => body.includes(invoice.invoice_number)))!;
  const found = golden.invoices.filter((invoice) => body.includes(invoice.invoice_number));
  const part = found.length < golden.invoices.length;
  const invoices = found.map(({ first_page, carrier, invoice_number, invoice_date, pro_number, currency, line_items, subtotal_cents, tax_cents, total_cents }) => ({
    first_page: part ? 1 : first_page,
    carrier,
    invoice_number,
    invoice_date,
    pro_number,
    currency,
    line_items: line_items.map(({ line_number, description, charge_code, amount_cents }) => ({ line_number, description, charge_code, amount_cents })),
    subtotal_cents,
    tax_cents,
    total_cents,
  }));
  return JSON.stringify({ invoices });
}

test('a perfect reading of each digital v2 kind ends as its answer key says: status, review reason, every finding', async () => {
  expect(cases.map((golden) => golden.kind).sort()).toEqual(
    ['clean', 'credit_memo', 'duplicate_invoice', 'missing_pro', 'multi_invoice', 'non_usd', 'overcharge', 'partial_credit', 'repeated_page', 'revised_invoice', 'tricky_number'],
  );
  const fake = await fakeModels((call) => replyWith(call.protocol, answer(JSON.stringify(call.body))));
  const database = await createTestDatabase();
  const role = (provider: 'gemini' | 'groq', model: string) => ({ provider, model, baseUrl: fake.url, apiKey: 'test-key', rpm: 100_000, tpm: 1e9 });
  const roles: Roles = { primary: role('gemini', 'fake-primary'), text: role('groq', 'fake-text'), fallback: role('groq', 'fake-fallback') };
  const env = await startEnvironment(roles, { databaseUrl: database.url, redisUrl: testEnv('REDIS_URL') });
  try {
    const misses = [];
    for (const golden of cases) {
      const score = scoreCase(golden, await runCase(env, root, golden));
      const right =
        score.header.correct === score.header.total &&
        score.lines.fp + score.lines.fn === 0 &&
        score.overcharges.fp + score.overcharges.fn === 0 &&
        score.outcomes.ok === score.outcomes.total &&
        score.invoices.read === score.invoices.truth;
      if (!right) misses.push({ id: golden.id, kind: golden.kind, header: score.header, lines: score.lines, overcharges: score.overcharges, outcomes: score.outcomes, invoices: score.invoices });
    }
    expect(misses).toEqual([]);
  } finally {
    await env.close();
    await fake.close();
    await database.drop();
  }
}, 300_000);
