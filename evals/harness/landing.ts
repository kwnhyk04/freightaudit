// The landing page's results table: the rows the approved design shows, for the latest official report of each run,
// Claude first and the free models alone (the two the README's eval table names), written to
// apps/web/lib/eval-results.json so the web reads only its own files. report.ts writes it on each full run of the default
// set; `node evals/harness/landing.ts` writes it again from the reports on disk.
import { writeFile } from 'node:fs/promises';
import { meets, type Metric, METRICS } from './metrics.ts';

type Report = { date?: string; cases?: number; metrics: { metric: string; value?: number | null; ci?: [number, number] | null }[] };
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
  return { cases: (claudeFirst ?? free)?.json.cases, claudeFirst: run(claudeFirst), free: run(free), rows, notes: notes(claudeFirst, free) };
}

const lower = (label: string) => `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// The sentences under the table, from the same two reports: for each one-metric row a run misses, whether the two runs'
// 95% intervals overlap (then the difference is within the margin of error); then where each run is ahead, by the rows
// whose every metric favours it.
export function notes(claudeFirst?: Official, free?: Official) {
  if (!claudeFirst || !free) return [];
  const get = (official: Official, metric: string) => official.json.metrics.find((each) => each.metric === metric);
  const said: string[] = [];
  for (const { metrics } of ROWS.filter((row) => row.metrics.length === 1)) {
    const def = METRICS.find((each) => each.metric === metrics[0])!;
    const [a, b] = [get(claudeFirst, def.metric), get(free, def.metric)];
    if (a?.value == null || b?.value == null || !a.ci || !b.ci) continue;
    const missed = [meets(a.value, def.target!) ? null : 'Claude first', meets(b.value, def.target!) ? null : 'the free models alone'].filter(Boolean);
    if (missed.length === 0) continue;
    const range = (ci: [number, number]) => `${show(def, ci[0])} to ${show(def, ci[1])}`;
    const overlap = a.ci[0] <= b.ci[1] && b.ci[0] <= a.ci[1];
    said.push(
      `${def.label} is below target for ${list(missed as string[])}. Claude first measured ${show(def, a.value)} (95% interval ${range(a.ci)}), the free models alone ${show(def, b.value)} (${range(b.ci)}). ${overlap ? 'The intervals overlap, so the difference is within the margin of error.' : 'The intervals do not overlap, so the difference is larger than the margin of error.'}`,
    );
  }
  const ahead = { claudeFirst: [] as string[], free: [] as string[] };
  for (const { metrics, label } of ROWS) {
    const defs = metrics.map((metric) => METRICS.find((each) => each.metric === metric)!);
    const sides = defs.map((def) => {
      const [a, b] = [get(claudeFirst, def.metric)?.value, get(free, def.metric)?.value];
      if (a == null || b == null || a === b) return null;
      return a > b === def.higherIsBetter ? 'claudeFirst' : 'free';
    });
    if (sides[0] && sides.every((side) => side === sides[0])) ahead[sides[0]].push(lower(label ?? defs[0]!.label));
  }
  if (ahead.claudeFirst.length > 0 || ahead.free.length > 0) {
    said.push(
      `On these runs Claude first is ahead on ${list(ahead.claudeFirst) || 'no row'}, and the free models alone on ${list(ahead.free) || 'no row'}.`,
    );
  }
  return said;
}

// The reports the eval card's table names (evals/README.md), in order, as in
// "Full report: [`evals/reports/2026-10-27-v2.md`](reports/2026-10-27-v2.md)".
export const namedReports = (card: string) => [...card.matchAll(/Full report: \[?`evals\/reports\/([^`]+)\.md`/g)].map((match) => match[1]!);

export async function writeLandingResults(at: URL, officials: Parameters<typeof landingResults>[0]) {
  await writeFile(new URL('apps/web/lib/eval-results.json', at), `${JSON.stringify(landingResults(officials), null, 2)}\n`);
}

if (import.meta.main) {
  const root = new URL('../../', import.meta.url);
  const { officialReports } = await import('./report.ts');
  await writeLandingResults(root, await officialReports(root));
}
