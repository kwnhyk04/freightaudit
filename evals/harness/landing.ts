// The landing page's results table: the rows the approved design shows, from the official report the README's eval
// table names, written to apps/web/lib/eval-results.json so the web reads only its own files. report.ts writes it on
// each full run; `node evals/harness/landing.ts` writes it again from the README's report.
import { readFile, writeFile } from 'node:fs/promises';
import { meets, type Metric, METRICS } from './metrics.ts';

type Report = { date?: string; cases?: number; metrics: { metric: string; value?: number | null }[] };

// As drawn: six metrics, then latency and cost, each a pair in one row.
const ROWS: { metrics: string[]; label?: string }[] = [
  { metrics: ['header_accuracy_digital'] },
  { metrics: ['header_accuracy_scanned'] },
  { metrics: ['line_f1_scanned'] },
  { metrics: ['overcharge_recall'] },
  { metrics: ['overcharge_precision'] },
  { metrics: ['false_flag_rate'] },
  { metrics: ['extraction_latency_p50_ms', 'extraction_latency_p95_ms'], label: 'Extraction latency p50 / p95 (3 pages or fewer)' },
  { metrics: ['cost_per_invoice_digital_usd', 'cost_per_invoice_scanned_usd'], label: 'Cost per invoice, paid-equivalent (digital / scanned)' },
];

// A value as the page shows it: shares as percents, F1 as a fraction, ms as seconds, dollars to a hundredth of a cent.
function show({ metric, unit }: Metric, value: number) {
  if (unit === 'ms') return `${Number((value / 1000).toFixed(1))} s`;
  if (unit === 'usd') return `$${Number(value.toFixed(4))}`;
  if (metric.startsWith('line_f1')) return String(Number(value.toFixed(3)));
  return `${Number((value * 100).toFixed(1))}%`;
}

export function landingResults(report: Report, name: string) {
  const measured = new Map(report.metrics.map((each) => [each.metric, each.value ?? undefined]));
  const rows = ROWS.map(({ metrics, label }) => {
    const defs = metrics.map((metric) => METRICS.find((def) => def.metric === metric)!);
    const values = defs.map((def) => measured.get(def.metric));
    return {
      label: label ?? defs[0]!.label,
      target: `${defs[0]!.target!.op === '<=' ? '≤ ' : ''}${defs.map((def) => show(def, def.target!.value)).join(' / ')}`,
      result: values.every((value) => value !== undefined) ? defs.map((def, i) => show(def, values[i]!)).join(' / ') : 'n/a',
      met: defs.every((def, i) => meets(values[i], def.target!)),
    };
  });
  return { report: `evals/reports/${name}.md`, date: report.date, cases: report.cases, rows };
}

// The report the README's eval table names, as in "Full report: `evals/reports/2026-10-15.md`".
export function namedReport(readme: string) {
  const name = /Full report: `evals\/reports\/([^`]+)\.md`/.exec(readme)?.[1];
  if (!name) throw new Error('the README names no full report');
  return name;
}

const root = new URL('../../', import.meta.url);
export async function writeLandingResults() {
  const name = namedReport(await readFile(new URL('README.md', root), 'utf8'));
  const report = JSON.parse(await readFile(new URL(`evals/reports/${name}.json`, root), 'utf8')) as Report;
  await writeFile(new URL('apps/web/lib/eval-results.json', root), `${JSON.stringify(landingResults(report, name), null, 2)}\n`);
}

if (import.meta.main) await writeLandingResults();
