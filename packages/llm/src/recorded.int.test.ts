import { LLM_SETTINGS, llmRoles, settings } from '@freightaudit/config/env';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { type ExtractedInvoice, extractInvoices, type Provider } from './extract.ts';
import { createGeminiProvider } from './gemini.ts';
import { createOpenAiProvider } from './openai.ts';
import { readPages } from './pages.ts';
import { cassetteServer, fixture } from './testing.ts';

// Real replies of the pinned models and of the configured fallback to the fixture invoices, recorded with LLM_RECORD=1
// (keys from the repo's .env) and replayed by every other run. LLM_PROVIDER=ollama sends the same requests to a local
// Ollama instead.
const recording = process.env.LLM_RECORD === '1';
const ollama = process.env.LLM_PROVIDER === 'ollama';
// Read here, not loaded into process.env: Jest hands tests a copy of it.
const ENV_FILE = new URL('../../../.env', import.meta.url);
const dotenv: Record<string, string | undefined> = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
// The fallback as the worker resolves it (environment over .env over defaults), so fallback-scanned follows LLM_FALLBACK_*.
const llmSettings = z.object(Object.fromEntries(LLM_SETTINGS.map((key) => [key, settings[key]])) as Pick<typeof settings, (typeof LLM_SETTINGS)[number]>);
const fallback = llmRoles(llmSettings.parse({ ...dotenv, ...process.env })).roles.fallback;

type Model = { provider: string; model: string; upstream: string; apiKey: string | undefined };
const GEMINI: Model = { provider: 'gemini', model: 'gemini-3.5-flash-lite', upstream: 'https://generativelanguage.googleapis.com', apiKey: dotenv.GEMINI_API_KEY };
const cases: (Model & { name: string; file: 'digital' | 'scanned' })[] = [
  { name: 'groq-digital', file: 'digital', provider: 'groq', model: 'openai/gpt-oss-120b', upstream: 'https://api.groq.com/openai/v1', apiKey: dotenv.GROQ_API_KEY },
  { name: 'gemini-scanned', file: 'scanned', ...GEMINI },
  { name: 'fallback-scanned', file: 'scanned', provider: fallback.provider, model: fallback.model, upstream: fallback.baseUrl, apiKey: fallback.apiKey },
];
// Gemini takes at most 20 MB in one request, inline page images included.
const GEMINI_REQUEST_BYTES = 20_000_000;

type Truth = { carrier: string; invoice_number: string; invoice_date: string; pro_number: string; currency: string; total_cents: number; line_items: { amount_cents: number }[] };

function client({ provider, model, apiKey }: Model, baseUrl: string): Provider {
  if (ollama) {
    const url = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1';
    return createOpenAiProvider({ name: 'ollama', baseUrl: url, model: process.env.OLLAMA_MODEL ?? 'qwen2.5vl:7b', timeoutMs: 300_000 });
  }
  // A replay sends no real key; a recording sends the configured one.
  const key = recording ? (apiKey ?? '') : 'replayed';
  return provider === 'gemini' ? createGeminiProvider({ apiKey: key, model, baseUrl }) : createOpenAiProvider({ name: provider, baseUrl, model, apiKey: key });
}

// One invoice, with every identifier and amount as the ground truth says.
function expectRead(invoices: ExtractedInvoice[], truth: Truth) {
  expect(invoices).toHaveLength(1);
  expect(invoices[0]).toMatchObject({
    carrier: truth.carrier,
    invoice_number: truth.invoice_number,
    invoice_date: truth.invoice_date,
    pro_number: truth.pro_number,
    currency: truth.currency,
    total_cents: truth.total_cents,
  });
  expect(invoices[0]!.line_items.map((line) => line.amount_cents)).toEqual(truth.line_items.map((line) => line.amount_cents));
}

// A long invoice as a scan: Letter pages drawn 1,000 px wide in the Liberation Sans that pdf.js ships, three lines a
// page and the total on the last, speckled like paper and saved as JPEG pictures with no text layer.
async function longScan(pages: number) {
  GlobalFonts.registerFromPath(createRequire(import.meta.url).resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'), 'Scan Sans');
  const kinds = ['linehaul', 'fuel surcharge', 'detention'];
  const lines = Array.from({ length: pages * 3 }, (_, i) => ({
    description: `Leg ${Math.floor(i / 3) + 1} ${kinds[i % 3]}`,
    amount_cents: 5_000 + (((i + 1) * 7_919) % 90_000),
  }));
  const truth: Truth = {
    carrier: 'Halcyon Ridge Freight',
    invoice_number: '58204617',
    invoice_date: '2026-09-14',
    pro_number: '7316402985',
    currency: 'USD',
    total_cents: lines.reduce((sum, line) => sum + line.amount_cents, 0),
    line_items: lines,
  };
  const money = (cents: number) => `${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

  // Paper speckle: a seeded tile of light gray noise, multiplied over each page.
  const tile = createCanvas(256, 256);
  const noise = tile.getContext('2d').createImageData(256, 256);
  for (let i = 0, seed = 42; i < noise.data.length; i += 4) {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    noise.data.fill(200 + ((seed >>> 24) % 56), i, i + 3);
    noise.data[i + 3] = 255;
  }
  tile.getContext('2d').putImageData(noise, 0, 0);

  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let page = 1; page <= pages; page++) {
    const canvas = createCanvas(1_000, 1_294);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1_000, 1_294);
    ctx.fillStyle = '#1a1a1a';
    const write = (text: string, x: number, y: number, size = 24) => {
      ctx.font = `${size}px "Scan Sans"`;
      ctx.fillText(text, x, y);
    };
    let y = 90;
    if (page === 1) {
      write(truth.carrier, 60, y, 40);
      write('INVOICE', 780, y, 36);
      const fields = [`Invoice number: ${truth.invoice_number}`, 'Invoice date: September 14, 2026', `PRO number: ${truth.pro_number}`, `Currency: ${truth.currency}`];
      for (const field of fields) write(field, 60, (y += 50));
    } else {
      write(`${truth.carrier}, invoice ${truth.invoice_number} (continued)`, 60, y, 28);
    }
    write('Line', 60, (y += 90));
    write('Description', 160, y);
    write('Amount', 780, y);
    for (let n = (page - 1) * 3; n < page * 3; n++) {
      write(String(n + 1), 60, (y += 60));
      write(lines[n]!.description, 160, y);
      write(money(lines[n]!.amount_cents), 780, y);
    }
    if (page === pages) write(`Total due: USD ${money(truth.total_cents)}`, 560, y + 100, 28);
    write(`Page ${page} of ${pages}`, 820, 1_240, 20);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, 1_000, 1_294);
    doc.addPage([612, 792]).drawImage(await doc.embedJpg(await canvas.encode('jpeg', 70)), { x: 0, y: 0, width: 612, height: 792 });
  }
  return { pdf: await doc.save(), truth };
}

test.each(cases)('$name: the recorded reply reads the fixture invoice as its ground truth says', async (c) => {
  const truth = JSON.parse(fixture(`${c.file}.json`).toString()) as Truth;
  const parts = await readPages(fixture(`${c.file}.pdf`), 100);
  expect(parts.map((part) => ('text' in part ? 'text' : 'jpeg'))).toEqual([c.file === 'digital' ? 'text' : 'jpeg']);
  const server = ollama ? undefined : await cassetteServer(c.name, c.upstream);
  try {
    const provider = client(c, server?.url ?? '');
    // Every role is this one model, so every call of the ladder reaches it.
    const outcome = await extractInvoices({ primary: provider, text: provider, fallback: provider }, { parts, pageCount: parts.length });
    expect(server?.mismatches() ?? []).toEqual([]);
    // A local model is checked for a finished ladder only; the recorded ones must read the invoice right.
    if (ollama) return;
    expect(outcome.step).not.toBe('needs_review');
    expectRead(outcome.invoices, truth);
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
  } finally {
    await server?.close();
  }
}, 120_000);

// Twenty pages are too slow for a local model.
(ollama ? test.skip : test)('gemini-long-scan: a 20-page scan goes to Gemini in one call under its request size limit and reads right', async () => {
  const { pdf, truth } = await longScan(20);
  const parts = await readPages(pdf, 100);
  expect(parts.map((part) => 'jpeg' in part)).toEqual(Array(20).fill(true));
  const server = await cassetteServer('gemini-long-scan', GEMINI.upstream);
  try {
    const provider = client(GEMINI, server.url);
    const outcome = await extractInvoices({ primary: provider, text: provider, fallback: provider }, { parts, pageCount: parts.length });
    expect(server.mismatches()).toEqual([]);
    expect(server.sizes()).toEqual([expect.any(Number)]);
    expect(server.sizes()[0]).toBeLessThan(GEMINI_REQUEST_BYTES);
    expect(outcome.step).toBe('first_pass');
    expectRead(outcome.invoices, truth);
  } finally {
    await server.close();
  }
}, 120_000);
