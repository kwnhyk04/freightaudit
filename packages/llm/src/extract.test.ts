import { setTimeout } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';
import { classify, failureOf, httpError, PermanentError, ProviderConfigError, RateLimitError, TransientError } from './errors.ts';
import { type Call, extractInvoices, type Models, type Part, type Provider } from './extract.ts';
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
  subtotal_cents: null,
  tax_cents: null,
  total_cents,
});
const reply = (...invoices: object[]) => JSON.stringify({ invoices });
const scan: Part[] = [{ page: 1, jpeg: new Uint8Array() }];
const text: Part[] = [{ page: 1, text: 'INVOICE' }];

// A model that answers with the scripted replies in order (an Error is thrown) and keeps every prompt it was sent.
function scripted(name: string, ...replies: (string | Error)[]) {
  const prompts: string[] = [];
  const provider: Provider = {
    name,
    model: `${name}-model`,
    generate: async ({ prompt }) => {
      prompts.push(prompt);
      const next = replies[prompts.length - 1] ?? '';
      if (next instanceof Error) throw next;
      return { text: next, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, servedModel: `${name}-served` };
    },
  };
  return { provider, prompts };
}

// The three roles from scripts; unscripted roles answer nothing valid.
function ladder(scripts: { primary?: (string | Error)[]; text?: (string | Error)[]; fallback?: (string | Error)[] }) {
  const roles = { primary: scripted('gemini', ...(scripts.primary ?? [])), text: scripted('groq', ...(scripts.text ?? [])), fallback: scripted('mistral', ...(scripts.fallback ?? [])) };
  const models: Models = { primary: roles.primary.provider, text: roles.text.provider, fallback: roles.fallback.provider };
  const calls: Call[] = [];
  const run = (parts = scan, options = {}) => extractInvoices(models, { parts, pageCount: parts.length }, { onCall: (call) => void calls.push(call), ...options });
  return { roles, calls, run };
}
const steps = (calls: Call[]) => calls.map(({ role, step, outcome }) => `${role} ${step} ${outcome}`);

test('valid output passes on the first call, and the call is recorded with tokens, latency and the served model', async () => {
  const { calls, run } = ladder({ primary: [reply(invoice())] });
  expect(await run()).toEqual({
    step: 'first_pass',
    invoices: [invoice()],
    problems: [],
    output: null,
    model: 'gemini/gemini-model',
    fallbackReason: null,
    claudeHandoff: null,
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  expect(calls).toEqual([
    { role: 'primary', step: 'first_pass', provider: 'gemini', model: 'gemini-model', servedModel: 'gemini-served', outcome: 'valid', usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 7, waitMs: 0, errorClass: null, httpStatus: null, errorMessage: null },
  ]);
});

test.each([
  [httpError(429, 'groq HTTP 429 rate_limit_exceeded'), '429', 429, 'groq HTTP 429 rate_limit_exceeded'],
  [httpError(503, 'gemini HTTP 503 UNAVAILABLE'), '5xx', 503, 'gemini HTTP 503 UNAVAILABLE'],
  [classify(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), 'timeout', null, 'request timed out'],
  [classify(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })), 'network', null, 'connection failed: ECONNRESET'],
  [httpError(400, 'groq HTTP 400 json_validate_failed'), 'parse_or_schema', 400, 'groq HTTP 400 json_validate_failed'],
  [new SyntaxError('Unexpected token \'<\', "<html>Halcyon" is not valid JSON'), 'parse_or_schema', null, 'SyntaxError: the response is not valid JSON'],
  [httpError(400, 'gemini HTTP 400 INVALID_ARGUMENT'), 'other', 400, 'gemini HTTP 400 INVALID_ARGUMENT'],
  [new Error('sent with gsk_0123456789abcdefghijklmn and Bearer abc.def\nsecond line'), 'other', null, 'Error: sent with [redacted] and [redacted]'],
])('a failed call is recorded as %s: class %s, HTTP %s, first message line without keys', (err, errorClass, httpStatus, errorMessage) => {
  expect(failureOf(err)).toEqual({ errorClass, httpStatus, errorMessage });
});

test('the ladder records why a call failed', async () => {
  const { calls, run } = ladder({ primary: [httpError(503, 'gemini HTTP 503 UNAVAILABLE')] });
  await expect(run()).rejects.toBeInstanceOf(TransientError);
  expect(calls[0]).toMatchObject({ outcome: 'error', errorClass: '5xx', httpStatus: 503, errorMessage: 'gemini HTTP 503 UNAVAILABLE' });
});

test('each call records its rate-limit wait apart from its latency, a failed call included', async () => {
  const { roles, calls, run } = ladder({ text: [new RateLimitError('groq HTTP 429')], fallback: [reply(invoice())] });
  // A text model that waits 200 ms on its bucket, then gets a 429 at once.
  const generate = roles.text.provider.generate;
  roles.text.provider.generate = async (input) => {
    await setTimeout(200);
    input.onWait?.(200);
    return generate(input);
  };
  await run(text);
  expect(calls.map(({ role, outcome, waitMs }) => `${role} ${outcome} ${waitMs}`)).toEqual(['text rate_limited 200', 'fallback valid 0']);
  expect(calls[0]!.latencyMs).toBeLessThan(200);
});

test('a document whose every page has a text layer goes to the text model, any other to the primary', async () => {
  const digital = ladder({ text: [reply(invoice())] });
  expect((await digital.run(text)).model).toBe('groq/groq-model');
  const scanned = ladder({ primary: [reply(invoice())] });
  expect((await scanned.run([...text, ...scan].map((part, i) => ({ ...part, page: i + 1 })))).model).toBe('gemini/gemini-model');
});

test('an arithmetic failure triggers one repair that sees the exact problem, and a fixed reply passes', async () => {
  const { roles, calls, run } = ladder({ primary: [reply(invoice(1, 999)), reply(invoice())] });
  const result = await run();
  expect(result).toMatchObject({ step: 'repair', fallbackReason: null, usage: { inputTokens: 20, outputTokens: 10 } });
  expect(roles.primary.prompts[1]).toContain(
    '- invoices.0: line_items amount_cents do not add up to subtotal_cents (without one, total_cents less tax_cents) within 1 cent',
  );
  expect(steps(calls)).toEqual(['primary first_pass invalid', 'primary repair valid']);
});

test('lines within a cent of a printed subtotal pass; a subtotal and tax that miss the total do not', async () => {
  const printed = { ...invoice(), subtotal_cents: 143_751, tax_cents: 1_000, total_cents: 144_751 };
  expect((await ladder({ primary: [reply(printed)] }).run()).step).toBe('first_pass');
  const missed = ladder({ primary: [reply({ ...printed, total_cents: 144_750 }), reply(printed)] });
  expect((await missed.run()).step).toBe('repair');
  expect(missed.roles.primary.prompts[1]).toContain('- invoices.0: subtotal_cents plus tax_cents is not total_cents');
});

test('schema-invalid output gets exactly one repair, then one fresh pass on the fallback, then needs_review', async () => {
  const bad = reply({ ...invoice(), invoice_date: '09/01/2026', currency: 'usd' });
  const { roles, calls, run } = ladder({ primary: [bad, bad, reply(invoice())], fallback: [bad, reply(invoice())] });
  const result = await run();
  expect(result).toMatchObject({ step: 'needs_review', invoices: [], model: 'mistral/mistral-model', fallbackReason: 'invalid_output' });
  expect(result.problems).toEqual([expect.stringMatching(/^invoices\.0\.invoice_date: /), expect.stringMatching(/^invoices\.0\.currency: /)]);
  // Problems name fields, never document values; the output itself is kept for a reviewer.
  expect(result.problems.join(' ')).not.toMatch(/09\/01\/2026|usd|Halcyon|1000000000/);
  expect(result.output).toEqual(JSON.parse(bad));
  expect(steps(calls)).toEqual(['primary first_pass invalid', 'primary repair invalid', 'fallback fallback invalid']);
  // The repair sees what failed; the fallback starts fresh from the plain prompt.
  expect(roles.primary.prompts[1]).toContain('It failed these checks');
  expect(roles.fallback.prompts[0]).not.toContain('It failed these checks');
  expect(roles.fallback.prompts[0]).toBe(roles.primary.prompts[0]);
});

test('a fallback that reads the document right ends the ladder at the fallback step', async () => {
  const { calls, run } = ladder({ primary: ['not json', 'not json'], fallback: [reply(invoice())] });
  expect(await run()).toMatchObject({ step: 'fallback', fallbackReason: 'invalid_output', invoices: [invoice()], usage: { inputTokens: 30, outputTokens: 15 } });
  expect(steps(calls)).toEqual(['primary first_pass invalid', 'primary repair invalid', 'fallback fallback valid']);
});

test('a 429 on the first pass moves it to the fallback model and is recorded; in evals it stays a retryable error', async () => {
  const limited = () => new RateLimitError('gemini HTTP 429', { retryAfterMs: 37_000 });
  const { calls, run } = ladder({ primary: [limited()], fallback: [reply(invoice())] });
  expect(await run()).toMatchObject({ step: 'first_pass', fallbackReason: 'rate_limited', model: 'mistral/mistral-model' });
  expect(steps(calls)).toEqual(['primary first_pass rate_limited', 'fallback first_pass valid']);
  expect(calls[0]).toMatchObject({ usage: { inputTokens: 0, outputTokens: 0 }, servedModel: null, latencyMs: expect.any(Number) });

  // The text path falls back the same way.
  const digital = ladder({ text: [limited()], fallback: [reply(invoice())] });
  expect(await digital.run(text)).toMatchObject({ step: 'first_pass', fallbackReason: 'rate_limited' });

  const evals = ladder({ primary: [limited()], fallback: [reply(invoice())] });
  await expect(evals.run(scan, { fallbackOnRateLimit: false })).rejects.toMatchObject({ name: 'RateLimitError', retryAfterMs: 37_000 });
  expect(evals.roles.fallback.prompts).toHaveLength(0);
});

test('after a 429 fallback, invalid output gets its repair on the fallback and no second escalation', async () => {
  const { calls, run } = ladder({ primary: [new RateLimitError('gemini HTTP 429')], fallback: ['not json', 'not json', reply(invoice())] });
  expect(await run()).toMatchObject({ step: 'needs_review', fallbackReason: 'rate_limited', problems: ['output is not valid JSON'], output: null });
  expect(steps(calls)).toEqual(['primary first_pass rate_limited', 'fallback first_pass invalid', 'fallback repair invalid']);
});

test('a scan longer than the fallback takes never goes to it: a 429 or output still invalid ends needs_review with fallback_page_cap', async () => {
  const pages = (count: number): Part[] => Array.from({ length: count }, (_, i) => ({ page: i + 1, jpeg: new Uint8Array() }));
  const capped = (scripts: Parameters<typeof ladder>[0]) => {
    const run = ladder(scripts);
    run.roles.fallback.provider.maxImages = 8;
    return run;
  };
  const cap = 'fallback_page_cap: 9 page images, more than the 8 mistral/mistral-model takes';

  const limited = capped({ primary: [new RateLimitError('gemini HTTP 429')], fallback: [reply(invoice())] });
  expect(await limited.run(pages(9))).toMatchObject({ step: 'needs_review', fallbackReason: 'rate_limited', model: 'gemini/gemini-model', problems: [cap], output: null });
  expect(steps(limited.calls)).toEqual(['primary first_pass rate_limited']);

  const invalid = capped({ primary: ['not json', 'not json'], fallback: [reply(invoice())] });
  expect(await invalid.run(pages(9))).toMatchObject({ step: 'needs_review', fallbackReason: 'invalid_output', problems: ['output is not valid JSON', cap] });
  expect(steps(invalid.calls)).toEqual(['primary first_pass invalid', 'primary repair invalid']);

  // Eight page images still go to the fallback.
  const fits = capped({ primary: [new RateLimitError('gemini HTTP 429')], fallback: [reply(invoice())] });
  expect(await fits.run(pages(8))).toMatchObject({ step: 'first_pass', model: 'mistral/mistral-model' });
});

test('a free model rate limited on its repair or on the third pass is never passed on: the job retries', async () => {
  const repair = ladder({ primary: ['not json', new RateLimitError('gemini HTTP 429')], fallback: [reply(invoice())] });
  await expect(repair.run()).rejects.toBeInstanceOf(RateLimitError);
  expect(steps(repair.calls)).toEqual(['primary first_pass invalid', 'primary repair rate_limited']);
  const third = ladder({ primary: ['not json', 'not json'], fallback: [new RateLimitError('mistral HTTP 429')] });
  await expect(third.run()).rejects.toBeInstanceOf(RateLimitError);
  expect(steps(third.calls)).toEqual(['primary first_pass invalid', 'primary repair invalid', 'fallback fallback rate_limited']);
});

test('a provider error other than a 429 is recorded and ends the ladder', async () => {
  const { calls, run } = ladder({ primary: [new ProviderConfigError('gemini HTTP 401')], fallback: [reply(invoice())] });
  await expect(run()).rejects.toBeInstanceOf(ProviderConfigError);
  expect(steps(calls)).toEqual(['primary first_pass error']);
});

test('invoices start on page 1, ascend and fit inside the document', async () => {
  const pages: Part[] = [1, 2, 3].map((page) => ({ page, jpeg: new Uint8Array() }));
  for (const bad of [reply(invoice(2)), reply(invoice(1), invoice(1)), reply(invoice(1), invoice(4))]) {
    const result = await ladder({ primary: [bad, bad], fallback: [bad] }).run(pages);
    expect(result.problems.join(' ')).toMatch(/first_page/);
  }
  expect((await ladder({ primary: [reply(invoice(1), invoice(3))] }).run(pages)).invoices).toHaveLength(2);
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
  for (const textBytes of ['plain text', '%PDF-1.7 no objects']) {
    await expect(readPdf(new TextEncoder().encode(textBytes))).rejects.toBeInstanceOf(PermanentError);
  }
  const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
  await expect(readPdf(empty)).rejects.toThrow('PDF has no pages');
});
