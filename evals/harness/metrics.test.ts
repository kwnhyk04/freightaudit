import type { GoldenCase } from '../golden/build.ts';
import { bootstrap, type CaseResult, measure, quantile, scoreCase } from './metrics.ts';

const lines = [
  { line_number: 1, description: 'Linehaul', charge_code: 'LINEHAUL', amount_cents: 100_000, expected_cents: 100_000 },
  { line_number: 2, description: 'Fuel surcharge', charge_code: 'FUEL', amount_cents: 20_000, expected_cents: 15_000 },
];
// One digital invoice whose fuel line is overbilled by $50.
const golden = {
  id: 'g001',
  path: 'digital',
  pages: 1,
  invoices: [
    {
      carrier: 'Halcyon Ridge Freight',
      invoice_number: '58204617',
      invoice_date: '2026-09-14',
      pro_number: '7316402985',
      currency: 'USD',
      total_cents: 120_000,
      line_items: lines,
      expected: { status: 'reconciled', overcharges: [{ line_number: 2, type: 'rate_mismatch', expected_cents: 15_000, billed_cents: 20_000 }] },
    },
  ],
} as unknown as GoldenCase;
const read = { ...golden.invoices[0]!, carrier: 'HALCYON RIDGE FREIGHT', subtotal_cents: null, tax_cents: null };
const result = (overrides: Partial<CaseResult['invoices'][number]> = {}): CaseResult => ({
  id: 'g001',
  status: 'reconciled',
  error: null,
  e2eMs: 4_000,
  calls: [{ role: 'text', step: 'first_pass', provider: 'groq', model: 'm', servedModel: 'm', outcome: 'valid', inputTokens: 800, outputTokens: 400, latencyMs: 2_000, costMicroUsd: 0, paidMicroUsd: 360 }],
  invoices: [{ status: 'reconciled', step: 'first_pass', reviewReason: null, read, findings: [{ line_number: 2, type: 'rate_mismatch', expected_cents: 15_000, billed_cents: 20_000 }], ...overrides }],
});

test('a right reading scores every field, line and finding; the carrier is compared without regard to case', () => {
  const score = scoreCase(golden, result());
  expect(score).toMatchObject({ header: { correct: 6, total: 6 }, lines: { tp: 2, fp: 0, fn: 0 }, arithmetic: { ok: 1, total: 1 }, outcomes: { ok: 1, total: 1 } });
  expect(score.overcharges).toEqual({ tp: 1, fp: 0, fn: 0, recovered: 5_000, planted: 5_000, cleanLines: 1 });
  const metrics = Object.fromEntries(measure([score]).map((m) => [m.metric, m.value]));
  expect(metrics).toMatchObject({ header_accuracy_digital: 1, line_f1_digital: 1, dollar_recovery: 1, false_flag_rate: 0, cost_per_invoice_digital_usd: 0.00036 });
});

test('a misread line, a missed finding and a false one each count against the right metric', () => {
  const misread = { ...read, line_items: [lines[0]!, { ...lines[1]!, charge_code: null }] };
  const score = scoreCase(golden, result({ read: misread, findings: [{ line_number: 1, type: 'rate_mismatch', expected_cents: 90_000, billed_cents: 100_000 }] }));
  expect(score.lines).toEqual({ tp: 1, fp: 1, fn: 1 });
  expect(score.overcharges).toMatchObject({ tp: 0, fp: 1, fn: 1, recovered: 0 });
  // Nothing read at all: every field and line is missed, and the arithmetic cannot hold.
  expect(scoreCase(golden, result({ read: null, findings: [] }))).toMatchObject({ header: { correct: 0 }, lines: { tp: 0, fn: 2 }, arithmetic: { ok: 0 } });
});

test('extraction latency sums only the calls that returned a reply, repairs included; waits and failed calls count apart', () => {
  const call = result().calls[0]!;
  const calls = [
    { ...call, outcome: 'rate_limited', latencyMs: 300, waitMs: 5_000 },
    { ...call, outcome: 'error', latencyMs: 60_000, waitMs: 0 },
    { ...call, outcome: 'invalid', latencyMs: 1_500, waitMs: 0 },
    { ...call, step: 'repair', outcome: 'valid', latencyMs: 2_000, waitMs: 3_000 },
  ];
  const score = scoreCase(golden, { ...result(), calls });
  expect(score).toMatchObject({ latencyMs: 3_500, waits: 2, waitMs: 8_000, failedCalls: 2 });
  const metrics = Object.fromEntries(measure([score]).map((m) => [m.metric, m.value]));
  expect(metrics).toMatchObject({ extraction_latency_p95_ms: 3_500, rate_limit_waits: 2, rate_limit_wait_ms: 8_000, failed_calls: 2 });

  // Calls recorded before waits were leave the wait metrics unknown, never zero.
  const before = Object.fromEntries(measure([scoreCase(golden, result())]).map((m) => [m.metric, m.value]));
  expect(before).toMatchObject({ rate_limit_waits: undefined, rate_limit_wait_ms: undefined, failed_calls: 0 });
  // A case where no call returned a reply has no extraction latency.
  const failed = scoreCase(golden, { ...result(), calls: [calls[1]!] });
  expect(failed.latencyMs).toBeUndefined();
  expect(measure([failed]).find((m) => m.metric === 'extraction_latency_p95_ms')).toMatchObject({ value: undefined, n: 0 });
});

test('the bootstrap interval is seeded, so it repeats, and it brackets the value', () => {
  const scores = [1, 0, 1, 1, 0, 1, 1, 1].map((ok, i) => ({ ...scoreCase(golden, result()), id: `g${i}`, escalated: 1 - ok }));
  const compute = (s: typeof scores) => s.reduce((sum, x) => sum + x.escalated, 0) / s.length;
  const interval = bootstrap(scores, compute)!;
  expect(bootstrap(scores, compute)).toEqual(interval);
  expect(interval[0]).toBeLessThanOrEqual(0.25);
  expect(interval[1]).toBeGreaterThanOrEqual(0.25);
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
});
