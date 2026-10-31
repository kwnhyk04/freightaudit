import { CHARGE_CODES } from '@freightaudit/db';
import { checkArithmetic } from '@freightaudit/domain';
import { z } from 'zod';
import {
  ClaudeSkippedError,
  type ClaudeSkipReason,
  ClaudeUnavailableError,
  type ClaudeUnavailableReason,
  type FailureClass,
  failureOf,
  PermanentError,
  RateLimitError,
  TransientError,
} from './errors.ts';

export type Usage = { inputTokens: number; outputTokens: number };
// A page as the model reads it: its text layer, or a JPEG render of a page without one.
export type Part = { page: number; text: string } | { page: number; jpeg: Uint8Array };
// step is for traces only; providers ignore it. onWait hears how long the call first waited on its role's rate limit.
// claudeTokens is what this extraction already spent on Claude, for its gate.
export type GenerateInput = { prompt: string; parts: Part[]; schema: object; step?: Step | undefined; onWait?: ((ms: number) => void) | undefined; claudeTokens?: number | undefined };
// finishReason as the provider reports it, such as Gemini's STOP or an OpenAI-compatible stop or length.
export type Reply = { text: string; usage: Usage; latencyMs: number; servedModel: string | undefined; finishReason?: string | undefined };
// A model behind the provider layer. It only reads documents; code checks every amount it returns. maxImages is the
// most page images one request may carry, for a provider that caps it.
export type Provider = { name: string; model: string; maxImages?: number | undefined; generate(input: GenerateInput): Promise<Reply> };

// The text model reads documents whose every page has a text layer, the primary reads the rest, and the fallback takes
// over when the first model is rate limited or its output stays invalid.
export type Role = 'primary' | 'text' | 'fallback';
// `claude`, when configured, comes first at every step, behind its gate (claude-first.ts), with the free model of that
// step behind it; its calls are recorded under the step's role, told apart by provider and model.
export type Models = Record<Role, Provider> & { claude?: Provider | undefined };
export type Step = 'first_pass' | 'repair' | 'fallback';
export type Call = {
  role: Role;
  step: Step;
  provider: string;
  model: string;
  // What the provider says it ran; Gemini answers some retired ids with a newer model.
  servedModel: string | null;
  outcome: 'valid' | 'invalid' | 'rate_limited' | 'error';
  usage: Usage;
  // The call's own time, and the time it waited on its role's rate limit before it was sent.
  latencyMs: number;
  waitMs: number;
  // Why a failed call failed (failureOf); null for a call that returned a reply.
  errorClass: FailureClass | null;
  httpStatus: number | null;
  errorMessage: string | null;
};

type Code = keyof typeof CHARGE_CODES;
const codes = Object.keys(CHARGE_CODES) as [Code, ...Code[]];

// Field names follow the eval ground truth (evals/fixtures), so results compare one to one.
const invoiceSchema = z.object({
  first_page: z.int().min(1),
  carrier: z.string().min(1),
  invoice_number: z.string().min(1),
  invoice_date: z.iso.date(),
  pro_number: z.string().min(1).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  line_items: z
    .array(
      z.object({
        line_number: z.int().min(1),
        description: z.string().min(1),
        charge_code: z.enum(codes).nullable(),
        amount_cents: z.int(),
      }),
    )
    .min(1),
  subtotal_cents: z.int().nullable(),
  tax_cents: z.int().nullable(),
  total_cents: z.int(),
});
const extractionSchema = z.object({ invoices: z.array(invoiceSchema).min(1) });
export type ExtractedInvoice = z.infer<typeof invoiceSchema>;

// The schema the model is held to: the zod schema's types, enums and required fields, without the checks that strict
// modes reject (patterns, formats, bounds). zod still applies those to every reply. No field is named like a keyword.
const VALIDATION_ONLY = new Set(['$schema', 'pattern', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
const modelSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(modelSchema);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).flatMap(([key, value]) => (VALIDATION_ONLY.has(key) ? [] : [[key, modelSchema(value)]])));
};
export const EXTRACTION_JSON_SCHEMA = modelSchema(z.toJSONSchema(extractionSchema, { target: 'draft-7' })) as object;

const PROMPT = `You read freight carrier invoices. The document holds one invoice or several in a row; each page comes as its text layer or as an image.
Reply with JSON that matches the schema.
- first_page is the 1-based page where each invoice starts; list the invoices in page order. The first invoice starts on page 1: pages before it, such as a bill of lading or a cover sheet, belong to it.
- A page that repeats an invoice already listed (the same invoice number again, as a second copy or a page scanned twice) belongs to that invoice; list each invoice once.
- Copy carrier, invoice_number and pro_number exactly as printed; pro_number is null when the invoice has none.
- invoice_date is the printed invoice date written as YYYY-MM-DD.
- Amounts are integer cents of the printed figure: 1,234.56 becomes 123456. Copy them; never compute or correct them.
- subtotal_cents and tax_cents are null when the invoice prints no subtotal or no tax.
- charge_code is one of ${codes.join(', ')} when a line is clearly that charge, otherwise null.`;
// Evals key their cached results on the prompt and the schema.
export { PROMPT as EXTRACTION_PROMPT };

const repairPrompt = (previous: string, problems: string[]) => `${PROMPT}

Your previous reply was:
${previous.slice(0, 20_000)}

It failed these checks:
${problems.map((problem) => `- ${problem}`).join('\n')}
Read the document again and reply with corrected JSON only.`;

type Checked = { invoices: ExtractedInvoice[] } | { problems: string[]; json: unknown };

// Problems name fields, never document values, so they are safe in logs and dead letters.
function check(text: string, pageCount: number): Checked {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problems: ['output is not valid JSON'], json: null };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`), json };
  }
  const { invoices } = parsed.data;
  const problems: string[] = [];
  invoices.forEach((invoice, i) => {
    const previous = invoices[i - 1]?.first_page;
    if (previous === undefined ? invoice.first_page !== 1 : invoice.first_page <= previous) {
      problems.push(`invoices.${i}.first_page: invoices start on page 1 and in page order`);
    }
    if (invoice.first_page > pageCount) problems.push(`invoices.${i}.first_page: the document has ${pageCount} pages`);
    const cents = (value: number | null) => (value === null ? null : BigInt(value));
    const arithmetic = checkArithmetic({
      lines: invoice.line_items.map((line) => BigInt(line.amount_cents)),
      subtotal: cents(invoice.subtotal_cents),
      tax: cents(invoice.tax_cents),
      total: BigInt(invoice.total_cents),
    });
    if (!arithmetic.linesMatchSubtotal) {
      problems.push(`invoices.${i}: line_items amount_cents do not add up to subtotal_cents (without one, total_cents less tax_cents) within 1 cent`);
    }
    if (!arithmetic.subtotalPlusTaxIsTotal) problems.push(`invoices.${i}: subtotal_cents plus tax_cents is not total_cents`);
  });
  return problems.length > 0 ? { problems, json } : { invoices };
}

export type ExtractOptions = {
  // Outside evals a 429 on the free read sends it to the free fallback, and a failed Claude call goes to the free model
  // behind it; an eval run pins its chain, so both throw and the job retries.
  fallbackOnRateLimit?: boolean;
  // Sees each call as it ends, failed ones included, so the caller can record it.
  onCall?: (call: Call) => Promise<void> | void;
};

export type Extraction = {
  // The step whose output passed every check, or needs_review when none did.
  step: Step | 'needs_review';
  invoices: ExtractedInvoice[];
  // For needs_review: the last output's problems (field names only) and that output, for a reviewer.
  problems: string[];
  output: unknown;
  // provider/model of the last call.
  model: string;
  // Why the ladder turned to the fallback, which did not run when the problems name fallback_page_cap.
  fallbackReason: 'rate_limited' | 'invalid_output' | null;
  // Why Claude, reading first, handed the invoice to the free models; null when it did not.
  claudeHandoff: ClaudeHandoff | null;
  usage: Usage;
};
// Skipped unsent (switched off, a cap, the day's budget), its account refused, or a call failed with this class. Past
// the end date Claude's window is over, so the free models reading is no hand-off.
export type ClaudeHandoff = Exclude<ClaudeSkipReason, 'end_date'> | ClaudeUnavailableReason | FailureClass;

// A read, one repair that sees the exact problems, one fresh read as a second opinion, then needs_review. Claude, when
// configured, comes first at each step, and a step it cannot take goes to the free model behind it; a rate-limited free
// read goes to the free fallback.
export async function extractInvoices(
  models: Models,
  { parts, pageCount }: { parts: Part[]; pageCount: number },
  { fallbackOnRateLimit = true, onCall }: ExtractOptions = {},
): Promise<Extraction> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let model = '';
  let fallbackReason: Extraction['fallbackReason'] = null;
  let handoff: Extraction['claudeHandoff'] = null;
  // The model of the last reply, so a hand-off is kept only when a free model wrote the reply the extraction ends on.
  let by: Provider | undefined;
  let claudeUsed = 0;
  const { claude, fallback } = models;
  const call = async (role: Role, step: Step, prompt: string, provider: Provider = models[role]) => {
    let waitMs = 0;
    // Only a call that was sent names the model: a Claude call its gate skipped never does.
    const record = (outcome: Call['outcome'], callUsage: Usage, latencyMs: number, servedModel: string | null, failure?: ReturnType<typeof failureOf>) => {
      model = `${provider.name}/${provider.model}`;
      return onCall?.({
        role,
        step,
        provider: provider.name,
        model: provider.model,
        servedModel,
        outcome,
        usage: callUsage,
        latencyMs,
        waitMs,
        errorClass: failure?.errorClass ?? null,
        httpStatus: failure?.httpStatus ?? null,
        errorMessage: failure?.errorMessage ?? null,
      });
    };
    const started = performance.now();
    let reply: Reply;
    try {
      const onWait = (ms: number) => {
        waitMs = ms;
      };
      reply = await provider.generate({ prompt, parts, schema: EXTRACTION_JSON_SCHEMA, step, onWait, claudeTokens: provider === claude ? claudeUsed : undefined });
    } catch (err) {
      // A skipped Claude call was never sent, so there is nothing to record.
      if (err instanceof ClaudeSkippedError) throw err;
      // A reply's latency is the provider's alone; a failed call's is everything after its rate-limit wait.
      const latencyMs = Math.max(0, Math.round(performance.now() - started) - waitMs);
      await record(err instanceof RateLimitError ? 'rate_limited' : 'error', { inputTokens: 0, outputTokens: 0 }, latencyMs, null, failureOf(err));
      throw err;
    }
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    if (provider === claude) claudeUsed += reply.usage.inputTokens + reply.usage.outputTokens;
    by = provider;
    const result = check(reply.text, pageCount);
    await record('invoices' in result ? 'valid' : 'invalid', reply.usage, reply.latencyMs, reply.servedModel ?? null);
    return { text: reply.text, result, provider };
  };
  const done = (step: Extraction['step'], invoices: ExtractedInvoice[], problems: string[] = [], output: unknown = null): Extraction => ({
    step,
    invoices,
    problems,
    output,
    model,
    fallbackReason,
    // Why a free model, not Claude, wrote the reply the extraction ends on.
    claudeHandoff: by !== undefined && by === claude ? null : handoff,
    usage,
  });

  // A scan with more page images than the fallback takes never goes to it: needing the fallback ends at needs_review.
  const images = parts.filter((part) => 'jpeg' in part).length;
  const pageCap =
    images > (fallback.maxImages ?? Infinity)
      ? `fallback_page_cap: ${images} page images, more than the ${fallback.maxImages} ${fallback.name}/${fallback.model} takes`
      : undefined;

  // Claude's turn at a step: its reply, or undefined when it cannot take the step and the free model behind it takes it,
  // which keeps why. It cannot when its gate skips the call, its account refuses it, or, outside evals, the call fails;
  // after a timeout or a lost connection it sits out the rest of this attempt. An eval run pins its chain, so there a
  // failed call throws and the job retries Claude.
  let claudeReplied = false;
  let claudeAway = false;
  const viaClaude = async (role: Role, step: Step, prompt: string) => {
    if (!claude || claudeAway) return undefined;
    try {
      const reply = await call(role, step, prompt, claude);
      claudeReplied = true;
      return reply;
    } catch (err) {
      if (err instanceof ClaudeSkippedError) handoff = err.reason === 'end_date' ? null : err.reason;
      else if (err instanceof ClaudeUnavailableError) handoff = err.reason;
      else if (fallbackOnRateLimit && (err instanceof TransientError || err instanceof PermanentError)) {
        handoff = failureOf(err).errorClass;
        claudeAway = err instanceof TransientError && err.kind !== undefined;
      } else throw err;
      return undefined;
    }
  };

  // The read: Claude, else the free model of the document's role; a rate-limited free read goes to the free fallback.
  let role: Role = parts.every((part) => 'text' in part) ? 'text' : 'primary';
  let read = await viaClaude(role, 'first_pass', PROMPT);
  if (!read) {
    try {
      read = await call(role, 'first_pass', PROMPT);
    } catch (err) {
      if (!(err instanceof RateLimitError) || !fallbackOnRateLimit) throw err;
      fallbackReason = 'rate_limited';
      role = 'fallback';
      if (pageCap) return done('needs_review', [], [pageCap]);
      read = await call(role, 'first_pass', PROMPT);
    }
  }
  if ('invoices' in read.result) return done('first_pass', read.result.invoices);
  // The repair: Claude, else the free model that read, or the role's free model when Claude read.
  const fixing = repairPrompt(read.text, read.result.problems);
  let last = (await viaClaude(role, 'repair', fixing)) ?? (await call(role, 'repair', fixing, read.provider === claude ? models[role] : read.provider));
  if ('invoices' in last.result) return done('repair', last.result.invoices);
  // Still invalid: a fresh read as a second opinion, by Claude unless it has replied already, then by the free fallback
  // unless it read already.
  if (role !== 'fallback') {
    fallbackReason ??= 'invalid_output';
    const fresh = claudeReplied ? undefined : await viaClaude('fallback', 'fallback', PROMPT);
    if (fresh) {
      last = fresh;
      if ('invoices' in last.result) return done('fallback', last.result.invoices);
    }
    if (pageCap) return done('needs_review', [], [...last.result.problems, pageCap], last.result.json);
    last = await call('fallback', 'fallback', PROMPT);
    if ('invoices' in last.result) return done('fallback', last.result.invoices);
  }
  return done('needs_review', [], last.result.problems, last.result.json);
}
