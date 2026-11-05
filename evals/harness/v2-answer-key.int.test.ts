import { createTestDatabase, testEnv } from '@freightaudit/db/testing';
import { fakeModels, replyWith } from '@freightaudit/llm/testing';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { amount } from '../fixtures/templates.ts';
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

// No golden invoice prints a positive tax, and a set is never rebuilt in place, so this case is made here in the same
// format: g2-002, whose lines all match its contract, with an overcharge hidden in a tax no rate card contracts. Line 0
// of its answer key is the whole invoice.
const TAX = 12_345;
const clean = JSON.parse(readFileSync(new URL('cases/g2-002.json', root), 'utf8')) as GoldenCase;
const lines = clean.invoices[0]!;
const taxed: GoldenCase = {
  ...clean,
  id: 'tax-001',
  file: 'tax-001.pdf',
  invoices: [
    {
      ...lines,
      subtotal_cents: lines.total_cents,
      tax_cents: TAX,
      total_cents: lines.total_cents + TAX,
      expected: { status: 'reconciled', overcharges: [{ line_number: 0, type: 'uncontracted_charge', expected_cents: 0, billed_cents: TAX }] },
    },
  ],
};
// Ground truth is only fair if the page prints it.
async function printTaxed() {
  const invoice = taxed.invoices[0]!;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  const printed = [
    invoice.carrier,
    `Invoice ${invoice.invoice_number}, ${invoice.invoice_date}, PRO ${invoice.pro_number}`,
    ...invoice.line_items.map((line) => `${line.description} ${amount(line.amount_cents)}`),
    `Subtotal ${amount(invoice.subtotal_cents!)}`,
    `Tax ${amount(TAX)}`,
    `Total ${amount(invoice.total_cents)}`,
  ];
  printed.forEach((text, i) => page.drawText(text, { x: 50, y: 740 - i * 18, size: 11, font }));
  return doc.save();
}

// The truth for the invoices whose numbers a request carries: the whole upload, or one part split from it, which
// starts on its own page 1.
function answer(body: string) {
  const golden = [...cases, taxed].find((candidate) => candidate.invoices.some((invoice) => body.includes(invoice.invoice_number)))!;
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

test('a perfect reading of each digital v2 kind, and of an invoice with tax, ends as its answer key says: status, review reason, every finding', async () => {
  expect(cases.map((golden) => golden.kind).sort()).toEqual(
    ['clean', 'credit_memo', 'duplicate_invoice', 'missing_pro', 'multi_invoice', 'non_usd', 'overcharge', 'partial_credit', 'repeated_page', 'revised_invoice', 'tricky_number'],
  );
  const fake = await fakeModels((call) => replyWith(call.protocol, answer(JSON.stringify(call.body))));
  const database = await createTestDatabase();
  const role = (provider: 'gemini' | 'groq', model: string) => ({ provider, model, baseUrl: fake.url, apiKey: 'test-key', rpm: 100_000, tpm: 1e9 });
  const roles: Roles = { primary: role('gemini', 'fake-primary'), text: role('groq', 'fake-text'), fallback: role('groq', 'fake-fallback') };
  const env = await startEnvironment(roles, { databaseUrl: database.url, redisUrl: testEnv('REDIS_URL') });
  const folder = await mkdtemp(join(tmpdir(), 'freightaudit-tax-'));
  try {
    await writeFile(join(folder, taxed.file), await printTaxed());
    const misses = [];
    for (const [golden, from] of [...cases.map((each) => [each, root] as const), [taxed, pathToFileURL(`${folder}/`)] as const]) {
      const score = scoreCase(golden, await runCase(env, from, golden));
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
    await rm(folder, { recursive: true, force: true });
  }
}, 300_000);
