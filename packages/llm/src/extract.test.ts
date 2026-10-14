import { PDFDocument } from 'pdf-lib';
import { PermanentError } from './errors.ts';
import { extractInvoices, type Provider } from './extract.ts';
import { readPdf, splitPdf } from './pdf.ts';

const invoice = (first_page = 1, total_cents = 143_750) => ({
  first_page,
  carrier: 'Halcyon Ridge Freight',
  invoice_number: '10000001',
  invoice_date: '2026-09-01',
  pro_number: '1000000000',
  currency: 'USD',
  line_items: [
    { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 125_000 },
    { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 18_750 },
  ],
  total_cents,
});
const reply = (...invoices: object[]) => JSON.stringify({ invoices });
const pdf = new Uint8Array();

// Answers with the scripted replies in order and keeps every prompt it was sent.
function scripted(...replies: string[]) {
  const prompts: string[] = [];
  const provider: Provider = {
    name: 'fake',
    model: 'scripted',
    generate: async ({ prompt }) => {
      prompts.push(prompt);
      return { text: replies[prompts.length - 1] ?? '', usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return { provider, prompts };
}

test('valid output passes on the first call', async () => {
  const { provider, prompts } = scripted(reply(invoice()));
  expect(await extractInvoices(provider, { pdf, pageCount: 1 })).toEqual({
    invoices: [invoice()],
    model: 'fake/scripted',
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  expect(prompts).toHaveLength(1);
});

test('one repair call sees what failed, and a fixed reply passes', async () => {
  const { provider, prompts } = scripted(reply(invoice(1, 999)), reply(invoice()));
  const result = await extractInvoices(provider, { pdf, pageCount: 1 });
  expect(result.invoices).toEqual([invoice()]);
  expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  expect(prompts[1]).toContain('- invoices.0: line_items amount_cents do not add up to total_cents');
});

test('output still invalid after the repair fails permanently, naming fields but never document values', async () => {
  const bad = reply({ ...invoice(), invoice_date: '09/01/2026', currency: 'usd' });
  const { provider, prompts } = scripted(bad, bad, reply(invoice()));
  const error = await extractInvoices(provider, { pdf, pageCount: 1 }).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(PermanentError);
  expect((error as Error).message).toMatch(/^schema invalid after repair: invoices\.0\.invoice_date: .+; invoices\.0\.currency: /);
  expect((error as Error).message).not.toMatch(/09\/01\/2026|usd|Halcyon|1000000000/);
  expect(prompts).toHaveLength(2);
});

test('invoices start on page 1, ascend and fit inside the document', async () => {
  for (const bad of [reply(invoice(2)), reply(invoice(1), invoice(1)), reply(invoice(1), invoice(4)), 'not json']) {
    const { provider } = scripted(bad, bad);
    await expect(extractInvoices(provider, { pdf, pageCount: 3 })).rejects.toThrow(/first_page|not valid JSON/);
  }
  const { provider } = scripted(reply(invoice(1), invoice(3)));
  expect((await extractInvoices(provider, { pdf, pageCount: 3 })).invoices).toHaveLength(2);
});

test('splits pages into PDFs whose bytes repeat across loads, and rejects files that are not readable PDFs', async () => {
  const source = await PDFDocument.create();
  for (const width of [100, 200, 300]) source.addPage([width, 100]);
  const bytes = await source.save();
  const ranges: [number, number][] = [
    [1, 2],
    [3, 3],
  ];
  const parts = await splitPdf(await readPdf(bytes), ranges);
  expect(await splitPdf(await readPdf(bytes), ranges)).toEqual(parts);
  const widths = await Promise.all(parts.map(async (part) => (await readPdf(part)).getPages().map((page) => page.getWidth())));
  expect(widths).toEqual([[100, 200], [300]]);
  for (const text of ['plain text', '%PDF-1.7 no objects']) {
    await expect(readPdf(new TextEncoder().encode(text))).rejects.toBeInstanceOf(PermanentError);
  }
  const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
  await expect(readPdf(empty)).rejects.toThrow('PDF has no pages');
});
