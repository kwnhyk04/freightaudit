import { CHARGE_CODES } from '@freightaudit/db';
import { linesMatchTotal } from '@freightaudit/domain';
import { z } from 'zod';
import { PermanentError } from './errors.ts';

export type Usage = { inputTokens: number; outputTokens: number };
export type GenerateInput = { pdf: Uint8Array; pageCount: number; prompt: string };
// A model behind the provider layer. It only reads documents; code checks every amount it returns.
export type Provider = {
  name: string;
  model: string;
  generate(input: GenerateInput): Promise<{ text: string; usage: Usage }>;
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
  total_cents: z.int(),
});
const extractionSchema = z.object({ invoices: z.array(invoiceSchema).min(1) });
export type ExtractedInvoice = z.infer<typeof invoiceSchema>;

const PROMPT = `You read freight carrier invoices. The PDF holds one invoice or several in a row.
Reply with JSON only, in exactly this shape:
{"invoices":[{"first_page":1,"carrier":"","invoice_number":"","invoice_date":"YYYY-MM-DD","pro_number":null,"currency":"USD","line_items":[{"line_number":1,"description":"","charge_code":null,"amount_cents":0}],"total_cents":0}]}
- first_page is the 1-based page where each invoice starts; list the invoices in page order.
- Copy carrier, invoice_number and pro_number exactly as printed; pro_number is null when the invoice has none.
- Amounts are integer cents of the printed figure: 1,234.56 becomes 123456. Copy them; never compute or correct them.
- charge_code is one of ${codes.join(', ')} when a line is clearly that charge, otherwise null.`;

const repairPrompt = (previous: string, problems: string[]) => `${PROMPT}

Your previous reply was:
${previous.slice(0, 20_000)}

It failed these checks:
${problems.map((problem) => `- ${problem}`).join('\n')}
Read the document again and reply with corrected JSON only.`;

// Problems name fields, never document values, so they are safe in logs and dead letters.
function check(text: string, pageCount: number): { invoices: ExtractedInvoice[] } | { problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problems: ['output is not valid JSON'] };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`) };
  }
  const { invoices } = parsed.data;
  const problems: string[] = [];
  invoices.forEach((invoice, i) => {
    const previous = invoices[i - 1]?.first_page;
    if (previous === undefined ? invoice.first_page !== 1 : invoice.first_page <= previous) {
      problems.push(`invoices.${i}.first_page: invoices start on page 1 and in page order`);
    }
    if (invoice.first_page > pageCount) problems.push(`invoices.${i}.first_page: the document has ${pageCount} pages`);
    const lines = invoice.line_items.map((line) => BigInt(line.amount_cents));
    if (!linesMatchTotal(lines, BigInt(invoice.total_cents))) {
      problems.push(`invoices.${i}: line_items amount_cents do not add up to total_cents`);
    }
  });
  return problems.length > 0 ? { problems } : { invoices };
}

// One call, then one repair call that sees what failed, then a permanent failure.
export async function extractInvoices(provider: Provider, { pdf, pageCount }: { pdf: Uint8Array; pageCount: number }) {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const call = async (prompt: string) => {
    const output = await provider.generate({ pdf, pageCount, prompt });
    usage.inputTokens += output.usage.inputTokens;
    usage.outputTokens += output.usage.outputTokens;
    return output.text;
  };
  const first = await call(PROMPT);
  let result = check(first, pageCount);
  if ('problems' in result) result = check(await call(repairPrompt(first, result.problems)), pageCount);
  if ('problems' in result) throw new PermanentError(`schema invalid after repair: ${result.problems.slice(0, 5).join('; ')}`);
  return { invoices: result.invoices, model: `${provider.name}/${provider.model}`, usage };
}
