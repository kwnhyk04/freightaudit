// The landing page's results table: the rows the approved design shows, for the latest official report of each run,
// Claude first and the free models alone (the two the README's eval table names), written to
// apps/web/lib/eval-results.json so the web reads only its own files. report.ts writes it on each full run of the default
// set; `node evals/harness/landing.ts` writes it again from the reports on disk.
import { writeFile } from 'node:fs/promises';
import { meets, type Metric, METRICS } from './metrics.ts';

type Report = { date?: string; cases?: number; metrics: { metric: string; value?: number | null }[] };
type Official = { name: string; json: Report };

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

// Each row's target, and each run's result and whether it meets the target; a run not measured yet has no cells.
export function landingResults({ claudeFirst, free }: { claudeFirst?: Official | undefined; free?: Official | undefined }) {
  const measuredOf = (official?: Official) => official && new Map(official.json.metrics.map((each) => [each.metric, each.value ?? undefined]));
  const [first, alone] = [measuredOf(claudeFirst), measuredOf(free)];
  const rows = ROWS.map(({ metrics, label }) => {
    const defs = metrics.map((metric) => METRICS.find((def) => def.metric === metric)!);
    const cell = (measured?: Map<string, number | undefined>) => {
      if (!measured) return null;
      const values = defs.map((def) => measured.get(def.metric));
      return {
        result: values.every((value) => value !== undefined) ? defs.map((def, i) => show(def, values[i]!)).join(' / ') : 'n/a',
        met: defs.every((def, i) => meets(values[i], def.target!)),
      };
    };
    return {
      label: label ?? defs[0]!.label,
      target: `${defs[0]!.target!.op === '<=' ? '≤ ' : ''}${defs.map((def) => show(def, def.target!.value)).join(' / ')}`,
      claudeFirst: cell(first),
      free: cell(alone),
    };
  });
  const run = (official?: Official) => (official ? { report: `evals/reports/${official.name}.md`, date: official.json.date } : null);
  return { cases: (claudeFirst ?? free)?.json.cases, claudeFirst: run(claudeFirst), free: run(free), rows };
}

// The reports the README's eval table names, in order, as in "Full report: `evals/reports/2026-10-27-v2.md`".
export const namedReports = (readme: string) => [...readme.matchAll(/Full report: `evals\/reports\/([^`]+)\.md`/g)].map((match) => match[1]!);

export async function writeLandingResults(at: URL, officials: Parameters<typeof landingResults>[0]) {
  await writeFile(new URL('apps/web/lib/eval-results.json', at), `${JSON.stringify(landingResults(officials), null, 2)}\n`);
}

if (import.meta.main) {
  const root = new URL('../../', import.meta.url);
  const { officialReports } = await import('./report.ts');
  await writeLandingResults(root, await officialReports(root));
}
