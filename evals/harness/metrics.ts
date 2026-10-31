// Scores eval cases against the golden ground truth and aggregates them into the metrics of docs/context.md, each with a
// 95% bootstrap interval over cases. Pure functions: no I/O.
import { checkArithmetic } from '@freightaudit/domain';
import type { GoldenCase } from '../golden/build.ts';

type Line = { charge_code: string | null; amount_cents: number };
// What the model returned for one invoice: header fields and lines (the accepted extraction, or the last output of one
// that ended in needs_review).
export type Read = {
  carrier?: unknown;
  invoice_number?: unknown;
  invoice_date?: unknown;
  pro_number?: unknown;
  currency?: unknown;
  total_cents?: unknown;
  subtotal_cents?: unknown;
  tax_cents?: unknown;
  line_items?: Line[];
};
export type Finding = { line_number: number; type: string; expected_cents: number; billed_cents: number };
// One invoice as the pipeline left it, in page order.
export type PredictedInvoice = { status: string; step: string | null; reviewReason: string | null; read: Read | null; findings: Finding[] };
// waitMs is the time the call waited on its role's rate limit; null or absent for calls recorded before migration 0011.
export type CallRow = {
  // The invoice the call read for (the upload, for a split); absent in results cached before 2026-10-31.
  invoiceId?: string;
  role: string;
  step: string;
  provider: string;
  model: string;
  servedModel: string | null;
  outcome: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  waitMs?: number | null;
  // Why a failed call failed (migration 0012); null for a reply, absent in results cached before 0012.
  errorClass?: string | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
  costMicroUsd: number;
  paidMicroUsd: number;
};
// A call that got a reply, valid or not; the others failed (429s, timeouts, other errors).
export const replied = (call: CallRow) => call.outcome === 'valid' || call.outcome === 'invalid';
// Every call that got no reply, in case order; calls cached before migration 0012 have no class, status or message.
export const failuresOf = (ids: string[], results: Map<string, CaseResult>) =>
  ids.flatMap((id) =>
    (results.get(id)?.calls ?? [])
      .filter((call) => !replied(call))
      .map(({ provider, model, errorClass, httpStatus, errorMessage }) => ({ id, provider, model, class: errorClass ?? null, status: httpStatus ?? null, message: errorMessage ?? null })),
  );
// One case as the harness caches it.
export type CaseResult = { id: string; status: string; error: string | null; e2eMs: number; invoices: PredictedInvoice[]; calls: CallRow[] };

const FIELDS = ['carrier', 'invoice_number', 'invoice_date', 'pro_number', 'currency', 'total_cents'] as const;
export type Score = {
  id: string;
  path: 'digital' | 'scanned';
  pages: number;
  header: { correct: number; total: number };
  // Right readings of each header field, out of header.total / 6, so a misread shows which field it was.
  fields: Record<(typeof FIELDS)[number], number>;
  // Invoices the truth holds and the pipeline ended with: a repeated page read twice shows as 1 against 2.
  invoices: { truth: number; read: number };
  lines: { tp: number; fp: number; fn: number };
  arithmetic: { ok: number; total: number };
  overcharges: { tp: number; fp: number; fn: number; recovered: number; planted: number; cleanLines: number };
  outcomes: { ok: number; total: number };
  escalated: number;
  // Undefined when no call returned a reply.
  latencyMs: number | undefined;
  // Calls that waited on a rate limit and their total wait; undefined when any call predates the wait record.
  waits: number | undefined;
  waitMs: number | undefined;
  failedCalls: number;
  e2eMs: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  costMicroUsd: number;
  paidMicroUsd: number;
};

const norm = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);

// Header fields compared one by one: the carrier without regard to case or spacing, the rest exactly.
function headerHits(truth: GoldenCase['invoices'][number], read: Read | null): Record<(typeof FIELDS)[number], boolean> {
  return {
    carrier: !!read && norm(read.carrier) === norm(truth.carrier),
    invoice_number: !!read && String(read.invoice_number ?? '') === truth.invoice_number,
    invoice_date: !!read && String(read.invoice_date ?? '') === truth.invoice_date,
    pro_number: !!read && (read.pro_number ?? null) === truth.pro_number,
    currency: !!read && String(read.currency ?? '') === truth.currency,
    total_cents: !!read && int(read.total_cents) === truth.total_cents,
  };
}

// Multiset match of items by key: how many of `found` match `wanted`, and what is left on each side.
export function match<T, U>(wanted: T[], found: U[], keyOfWanted: (item: T) => string, keyOfFound: (item: U) => string) {
  const open = new Map<string, T[]>();
  for (const item of wanted) open.set(keyOfWanted(item), [...(open.get(keyOfWanted(item)) ?? []), item]);
  const hits: T[] = [];
  let extra = 0;
  for (const item of found) {
    const bucket = open.get(keyOfFound(item));
    if (bucket?.length) hits.push(bucket.pop()!);
    else extra += 1;
  }
  return { hits, extra, missed: wanted.length - hits.length };
}
// A line is right only with both its charge code and its amount, since reconciliation prices by both.
const lineKey = (line: Line) => `${line.charge_code ?? ''}|${line.amount_cents}`;
const findingKey = (finding: { type: string; billed_cents: number }) => `${finding.type}|${finding.billed_cents}`;

function arithmeticHolds(read: Read | null) {
  const total = int(read?.total_cents);
  if (!read?.line_items?.length || total === null || read.line_items.some((line) => int(line.amount_cents) === null)) return false;
  const cents = (value: unknown) => (int(value) === null ? null : BigInt(value as number));
  const { linesMatchSubtotal, subtotalPlusTaxIsTotal } = checkArithmetic({
    lines: read.line_items.map((line) => BigInt(line.amount_cents)),
    subtotal: cents(read.subtotal_cents),
    tax: cents(read.tax_cents),
    total: BigInt(total),
  });
  return linesMatchSubtotal && subtotalPlusTaxIsTotal;
}

// One case's contribution to every metric. Truth and prediction pair up by page order; a missing invoice scores
// nothing, and an extra one counts its lines and findings as false. Extraction latency sums the calls that returned a
// reply (first pass, repairs, fallback), each from request to answer; failed calls and rate-limit waits count apart,
// since on free tiers they measure the provider plan, not the pipeline.
export function scoreCase(truth: GoldenCase, result: CaseResult): Score {
  const answered = result.calls.filter(replied);
  const waitsKnown = result.calls.every((call) => typeof call.waitMs === 'number');
  const score: Score = {
    id: truth.id,
    path: truth.path,
    pages: truth.pages,
    header: { correct: 0, total: 0 },
    fields: { carrier: 0, invoice_number: 0, invoice_date: 0, pro_number: 0, currency: 0, total_cents: 0 },
    invoices: { truth: truth.invoices.length, read: result.invoices.length },
    lines: { tp: 0, fp: 0, fn: 0 },
    arithmetic: { ok: 0, total: 0 },
    overcharges: { tp: 0, fp: 0, fn: 0, recovered: 0, planted: 0, cleanLines: 0 },
    outcomes: { ok: 0, total: 0 },
    escalated: result.calls.some((call) => call.role === 'fallback') ? 1 : 0,
    latencyMs: answered.length > 0 ? answered.reduce((sum, call) => sum + call.latencyMs, 0) : undefined,
    waits: waitsKnown ? result.calls.filter((call) => (call.waitMs ?? 0) > 0).length : undefined,
    waitMs: waitsKnown ? result.calls.reduce((sum, call) => sum + (call.waitMs ?? 0), 0) : undefined,
    failedCalls: result.calls.length - answered.length,
    e2eMs: result.e2eMs,
    inputTokens: result.calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: result.calls.reduce((sum, call) => sum + call.outputTokens, 0),
    calls: result.calls.length,
    costMicroUsd: result.calls.reduce((sum, call) => sum + call.costMicroUsd, 0),
    paidMicroUsd: result.calls.reduce((sum, call) => sum + call.paidMicroUsd, 0),
  };
  const count = Math.max(truth.invoices.length, result.invoices.length);
  for (let i = 0; i < count; i++) {
    const want = truth.invoices[i];
    const got = result.invoices[i];
    const read = got?.read ?? null;
    const lines = match(want?.line_items ?? [], read?.line_items ?? [], lineKey, lineKey);
    score.lines.tp += lines.hits.length;
    score.lines.fp += lines.extra;
    score.lines.fn += lines.missed;
    const planted = want?.expected.overcharges ?? [];
    const flags = match(planted, got?.findings ?? [], findingKey, findingKey);
    score.overcharges.tp += flags.hits.length;
    score.overcharges.fp += flags.extra;
    score.overcharges.fn += flags.missed;
    score.overcharges.recovered += flags.hits.reduce((sum, hit) => sum + hit.billed_cents - hit.expected_cents, 0);
    score.overcharges.planted += planted.reduce((sum, over) => sum + over.billed_cents - over.expected_cents, 0);
    if (!want) continue;
    score.overcharges.cleanLines += want.line_items.length - planted.length;
    score.header.total += FIELDS.length;
    const hits = headerHits(want, read);
    for (const field of FIELDS) {
      score.fields[field] += hits[field] ? 1 : 0;
      score.header.correct += hits[field] ? 1 : 0;
    }
    score.arithmetic.total += 1;
    score.arithmetic.ok += arithmeticHolds(read) ? 1 : 0;
    score.outcomes.total += 1;
    const reasonOk = want.expected.status !== 'needs_review' || !want.expected.reason || got?.reviewReason === want.expected.reason;
    score.outcomes.ok += got?.status === want.expected.status && reasonOk ? 1 : 0;
  }
  return score;
}

const ratio = (num: number, den: number) => (den === 0 ? undefined : num / den);
const total = (scores: Score[], pick: (score: Score) => number) => scores.reduce((sum, score) => sum + pick(score), 0);
// The q-quantile by linear interpolation between the order statistics.
export function quantile(values: number[], q: number) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  return sorted[below]! + (sorted[Math.min(below + 1, sorted.length - 1)]! - sorted[below]!) * (at - below);
}

type Target = { op: '>=' | '<='; value: number };
export type Metric = {
  // The metric's name in reports and floors, such as header_accuracy_digital.
  metric: string;
  label: string;
  unit: 'ratio' | 'ms' | 'tokens' | 'usd' | 'per_hour' | 'waits' | 'calls';
  // Which cases it is computed over; the bootstrap resamples only those.
  path?: 'digital' | 'scanned';
  where?: (score: Score) => boolean;
  higherIsBetter: boolean;
  target?: Target;
  compute: (scores: Score[]) => number | undefined;
};
const f1 = (scores: Score[]) => {
  const tp = total(scores, (s) => s.lines.tp);
  return ratio(2 * tp, 2 * tp + total(scores, (s) => s.lines.fp) + total(scores, (s) => s.lines.fn));
};
const perCase = (pick: (score: Score) => number) => (scores: Score[]) => ratio(total(scores, pick), scores.length);
// Cases of 3 pages or fewer where some call returned a reply.
const pages3 = (score: Score) => score.pages <= 3 && score.latencyMs !== undefined;
const latencies = (scores: Score[]) => scores.map((x) => x.latencyMs ?? 0);
// A total over every case, or undefined when a case has no wait record.
const waitTotal = (pick: (score: Score) => number | undefined) => (scores: Score[]) =>
  scores.some((x) => pick(x) === undefined) ? undefined : total(scores, (x) => pick(x) ?? 0);

export const METRICS: Metric[] = [
  { metric: 'header_accuracy_digital', label: 'Header field accuracy (digital)', unit: 'ratio', path: 'digital', higherIsBetter: true, target: { op: '>=', value: 0.98 }, compute: (s) => ratio(total(s, (x) => x.header.correct), total(s, (x) => x.header.total)) },
  { metric: 'header_accuracy_scanned', label: 'Header field accuracy (scanned)', unit: 'ratio', path: 'scanned', higherIsBetter: true, target: { op: '>=', value: 0.93 }, compute: (s) => ratio(total(s, (x) => x.header.correct), total(s, (x) => x.header.total)) },
  { metric: 'line_f1_digital', label: 'Line-item F1 (digital)', unit: 'ratio', path: 'digital', higherIsBetter: true, target: { op: '>=', value: 0.95 }, compute: f1 },
  { metric: 'line_f1_scanned', label: 'Line-item F1 (scanned)', unit: 'ratio', path: 'scanned', higherIsBetter: true, target: { op: '>=', value: 0.88 }, compute: f1 },
  { metric: 'arithmetic_consistency', label: 'Arithmetic consistency (after repair)', unit: 'ratio', higherIsBetter: true, target: { op: '>=', value: 0.99 }, compute: (s) => ratio(total(s, (x) => x.arithmetic.ok), total(s, (x) => x.arithmetic.total)) },
  { metric: 'overcharge_precision', label: 'Overcharge precision', unit: 'ratio', higherIsBetter: true, target: { op: '>=', value: 0.95 }, compute: (s) => ratio(total(s, (x) => x.overcharges.tp), total(s, (x) => x.overcharges.tp + x.overcharges.fp)) },
  { metric: 'overcharge_recall', label: 'Overcharge recall', unit: 'ratio', higherIsBetter: true, target: { op: '>=', value: 0.9 }, compute: (s) => ratio(total(s, (x) => x.overcharges.tp), total(s, (x) => x.overcharges.tp + x.overcharges.fn)) },
  { metric: 'dollar_recovery', label: 'Dollar recovery', unit: 'ratio', higherIsBetter: true, target: { op: '>=', value: 0.9 }, compute: (s) => ratio(total(s, (x) => x.overcharges.recovered), total(s, (x) => x.overcharges.planted)) },
  { metric: 'false_flag_rate', label: 'False flag rate', unit: 'ratio', higherIsBetter: false, target: { op: '<=', value: 0.03 }, compute: (s) => ratio(total(s, (x) => x.overcharges.fp), total(s, (x) => x.overcharges.cleanLines)) },
  { metric: 'escalation_rate', label: 'Escalation rate', unit: 'ratio', higherIsBetter: false, target: { op: '<=', value: 0.1 }, compute: perCase((x) => x.escalated) },
  { metric: 'extraction_latency_p50_ms', label: 'Extraction latency p50 (3 pages or fewer)', unit: 'ms', where: pages3, higherIsBetter: false, target: { op: '<=', value: 5_000 }, compute: (s) => quantile(latencies(s), 0.5) },
  { metric: 'extraction_latency_p95_ms', label: 'Extraction latency p95 (3 pages or fewer)', unit: 'ms', where: pages3, higherIsBetter: false, target: { op: '<=', value: 12_000 }, compute: (s) => quantile(latencies(s), 0.95) },
  { metric: 'rate_limit_waits', label: 'Rate-limit waits (calls that waited for their per-minute limit)', unit: 'waits', higherIsBetter: false, compute: waitTotal((x) => x.waits) },
  { metric: 'rate_limit_wait_ms', label: 'Rate-limit wait time (total, outside extraction latency)', unit: 'ms', higherIsBetter: false, compute: waitTotal((x) => x.waitMs) },
  { metric: 'failed_calls', label: 'Failed or timed-out calls (429s, timeouts, other errors)', unit: 'calls', higherIsBetter: false, compute: (s) => total(s, (x) => x.failedCalls) },
  { metric: 'e2e_latency_p95_ms', label: 'End-to-end latency p95 (under eval throttling, not normal load)', unit: 'ms', higherIsBetter: false, target: { op: '<=', value: 30_000 }, compute: (s) => quantile(s.map((x) => x.e2eMs), 0.95) },
  { metric: 'input_tokens_per_page_digital', label: 'Input tokens per page (text path)', unit: 'tokens', path: 'digital', higherIsBetter: false, target: { op: '<=', value: 4_000 }, compute: (s) => ratio(total(s, (x) => x.inputTokens), total(s, (x) => x.pages)) },
  { metric: 'output_tokens_per_page_digital', label: 'Output tokens per page (text path)', unit: 'tokens', path: 'digital', higherIsBetter: false, target: { op: '<=', value: 1_200 }, compute: (s) => ratio(total(s, (x) => x.outputTokens), total(s, (x) => x.pages)) },
  { metric: 'tokens_per_invoice_digital', label: 'Tokens per invoice (digital, in + out)', unit: 'tokens', path: 'digital', higherIsBetter: false, compute: perCase((x) => x.inputTokens + x.outputTokens) },
  { metric: 'tokens_per_invoice_scanned', label: 'Tokens per invoice (scanned, in + out)', unit: 'tokens', path: 'scanned', higherIsBetter: false, compute: perCase((x) => x.inputTokens + x.outputTokens) },
  { metric: 'cost_per_invoice_digital_usd', label: 'Cost per invoice, paid-equivalent (digital)', unit: 'usd', path: 'digital', higherIsBetter: false, target: { op: '<=', value: 0.02 }, compute: perCase((x) => x.paidMicroUsd / 1e6) },
  { metric: 'cost_per_invoice_scanned_usd', label: 'Cost per invoice, paid-equivalent (scanned)', unit: 'usd', path: 'scanned', higherIsBetter: false, target: { op: '<=', value: 0.05 }, compute: perCase((x) => x.paidMicroUsd / 1e6) },
  { metric: 'free_tier_cost_per_invoice_usd', label: 'Cost per invoice, as billed (free tiers)', unit: 'usd', higherIsBetter: false, compute: perCase((x) => x.costMicroUsd / 1e6) },
  { metric: 'outcome_accuracy', label: 'Expected outcome (status and review reason)', unit: 'ratio', higherIsBetter: true, compute: (s) => ratio(total(s, (x) => x.outcomes.ok), total(s, (x) => x.outcomes.total)) },
];

// A seeded generator (mulberry32), so every run draws the same resamples.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// The 95% percentile bootstrap interval: cases resampled with replacement, the metric recomputed on each resample.
export function bootstrap(scores: Score[], compute: Metric['compute'], resamples = 2_000, seed = 42): [number, number] | undefined {
  if (scores.length === 0) return undefined;
  const next = random(seed);
  const values: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const sample = Array.from({ length: scores.length }, () => scores[Math.floor(next() * scores.length)]!);
    const value = compute(sample);
    if (value !== undefined && Number.isFinite(value)) values.push(value);
  }
  const [lo, hi] = [quantile(values, 0.025), quantile(values, 0.975)];
  return lo === undefined || hi === undefined ? undefined : [lo, hi];
}

export type Measured = { metric: string; value: number | undefined; ci: [number, number] | undefined; n: number };
export function measure(scores: Score[]): Measured[] {
  return METRICS.map((def) => {
    const cases = scores.filter((score) => (!def.path || score.path === def.path) && (!def.where || def.where(score)));
    return { metric: def.metric, value: def.compute(cases), ci: bootstrap(cases, def.compute), n: cases.length };
  });
}

// Whether a value meets a bound such as a design target or a regression floor.
export const meets = (value: number | undefined, bound: Target) => value !== undefined && (bound.op === '>=' ? value >= bound.value : value <= bound.value);
