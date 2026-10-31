// Turns eval runs into evals/reports/<date>[-<version>][-<subset>].json and .md: every target of docs/context.md met or
// missed, the regression floors of evals/thresholds[-<version>].json beside them, and on a full run of the default set
// the eval table that opens the README. The exit code is 2 when a quota stop left cases unrun, 1 when a metric breaks
// its floor, else 0.
import { existsSync } from 'node:fs';
import { CLAUDE_EXTRACTION_CAP, CLAUDE_FIRST_MAX_TOKENS, CLAUDE_INPUT_CAP } from '@freightaudit/llm';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import type { GoldenCase } from '../golden/build.ts';
import { writeLandingResults } from './landing.ts';
import { failuresOf, type Measured, measure, meets, type Metric, METRICS, replied, scoreCase, type Score } from './metrics.ts';
import type { Roles, Run, Subset } from './run.ts';

// Floors per subset: a minimum for metrics where higher is better, a maximum for the others. Floors only tighten;
// loosening one needs a written reason in docs/memory.md naming the run that justified it. `from` names the run that
// set the floor, or is "design target" for a floor set to the target by such a reason.
type Floor = { min?: number; max?: number; from: string };
type Thresholds = { _rules?: string } & Partial<Record<Subset, Record<string, Floor>>>;
const RULES =
  "Regression floors per subset, set from that subset's own run. Accuracy and failed calls: the looser of the run's 95% bound and the design target (a minimum takes the lower of the two, a maximum the higher); without a target, the bound with a 0.02 margin, at most 0.98 for a minimum and at least 0.02 for a maximum. Tokens, cost, latency and rate-limit waits: the upper bound times 1.5, capped at the design target unless the run already exceeds it. Cost as billed: 0. Each is rounded away from the run to its unit's step (one call for failed calls). The ci subset reports its extraction latency p95 and end-to-end latency p95 against their floors but does not gate on them: with n = 20 a p95 is the slowest one or two cases, which one slow provider call moves past any floor (docs/memory.md, 2026-10-28); the full run gates both. Floors only tighten; loosening one needs a written reason in docs/memory.md naming the run that justified it.";
// Rows the ci subset reports against their floors without gating on them (RULES); the full run gates them.
const NOT_GATED_IN_CI = new Set(['extraction_latency_p95_ms', 'e2e_latency_p95_ms']);
// The repository root, under which a report reads floors and the k6 results and writes its files; a test points it elsewhere.
const ROOT = new URL('../../', import.meta.url);

const metricOf = (name: string) => METRICS.find((def) => def.metric === name)!;
const fmt = (unit: string, value: number | undefined) => {
  if (value === undefined) return 'n/a';
  if (unit === 'ratio') return value.toFixed(3);
  if (unit === 'usd') return `$${value.toFixed(4)}`;
  return `${Math.round(value).toLocaleString('en-US')}${unit === 'ms' ? ' ms' : ''}`;
};
const ci = (unit: string, interval: [number, number] | undefined) => (interval ? `${fmt(unit, interval[0])} to ${fmt(unit, interval[1])}` : 'n/a');
const bound = (op: string, unit: string, value: number) => `${op === '>=' ? '≥' : '≤'} ${fmt(unit, value)}`;
const yes = (ok: boolean) => (ok ? 'met' : 'missed');
// A floor from this run (user rules). Accuracy: the looser of the run's 95% bound and the design target, so a perfect
// run's degenerate interval (1.000 to 1.000) never makes a floor that one miss would break; without a target, the bound
// with a 0.02 margin, at most 0.98 for a minimum, at least 0.02 for a maximum. Failed calls are outcomes like these, so
// a run without any gets a floor of one call. Efficiency (tokens, cost, latency, rate-limit waits): the upper bound times
// 1.5, so a 50% regression breaks it, capped at the design target unless the run already exceeds it (end-to-end latency
// under the eval's throttling), where a cap would break the floor with no regression. Cost as billed stays 0: any
// billed cost means a paid key was used by mistake. Rounded away from the run to the unit's step.
export function floorFrom({ metric, unit, higherIsBetter, target }: Metric, [lo, hi]: [number, number]) {
  if (metric === 'free_tier_cost_per_invoice_usd') return 0;
  const step = { ratio: 0.01, ms: 100, tokens: 10, usd: 0.0001, per_hour: 1, waits: 1, calls: 1 }[unit];
  const efficiency = !higherIsBetter && (unit === 'ms' || unit === 'tokens' || unit === 'usd' || unit === 'waits');
  const raw = efficiency
    ? target && target.value >= hi ? Math.min(hi * 1.5, target.value) : hi * 1.5
    : higherIsBetter
      ? target ? Math.min(lo, target.value) : Math.min(lo - 0.02, 0.98)
      : target ? Math.max(hi, target.value) : Math.max(hi + 0.02, 0.02);
  // The epsilon keeps 0.93 at 0.93 despite binary fractions; toFixed drops artifacts such as 0.9500000000000001.
  return Number((higherIsBetter ? Math.floor(raw / step + 1e-9) * step : Math.ceil(raw / step - 1e-9) * step).toFixed(4));
}

// The most invoices an hour the pinned roles' per-minute limits allow at the measured calls and tokens per invoice,
// digital ones on the text model and scans on the primary, both providers working at once on this set's mix.
function throughput(scores: Score[], roles: Roles) {
  const minutes = (path: 'digital' | 'scanned', role: 'text' | 'primary') => {
    const cases = scores.filter((score) => score.path === path);
    if (cases.length === 0) return 0;
    const calls = cases.reduce((sum, score) => sum + score.calls, 0) / cases.length;
    const tokens = cases.reduce((sum, score) => sum + score.inputTokens + score.outputTokens, 0) / cases.length;
    return Math.max(calls / roles[role].rpm, tokens / roles[role].tpm) * cases.length;
  };
  const busiest = Math.max(minutes('digital', 'text'), minutes('scanned', 'primary'));
  return busiest > 0 ? (60 * scores.length) / busiest : undefined;
}

// The k6 load test's results (README, Load test), which replace the eval's throttled end-to-end latency and free-tier
// ceiling in the README table: part 2 gives end-to-end latency at low load on the real models, part 1 throughput on the
// recorded-fixture provider. Neither measures real models at the design rate, which needs paid tiers.
type E2eResults = { date: string; n: number; e2e_ms: { p50: number; p90: number; max: number } };
type SystemResults = { date: string; accepted: number; lost: number; offered_per_hour: number; drain_s: number };
const results = async <T>(root: URL, name: string) => {
  const file = new URL(`loadtest/${name}`, root);
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as T) : undefined;
};

export async function loadTestRows(root = ROOT) {
  const e2e = await results<E2eResults>(root, 'e2e-results.json');
  const system = await results<SystemResults>(root, 'system-results.json');
  const rows: string[] = [];
  // n = 20 cannot give a meaningful p95, so max stands in for it: the target is met only if every invoice made it.
  if (e2e) {
    const { p50, p90, max } = e2e.e2e_ms;
    rows.push(
      `| End-to-end latency at low load with real free-tier models (k6, n = ${e2e.n}, one every 15 s; p95 is not meaningful at this n) | p95 ≤ 30,000 ms | p50 ${fmt('ms', p50)}, p90 ${fmt('ms', p90)}, max ${fmt('ms', max)} | n/a | ${max <= 30_000 ? 'yes' : 'no'} | all roles | ${e2e.date} |`,
    );
  }
  if (system) {
    // k6's drain starts 5 s after the last upload, so its time plus 5 s bounds when the last invoice finished.
    const { offered_per_hour: offered, accepted, lost, drain_s: drain } = system;
    rows.push(
      `| Throughput (k6: recorded-fixture model provider at 3x the 2,000/h normal rate, 2 workers x 8) | ≥ 2,000 / h | ${fmt('per_hour', offered)} / h sustained for 10 min: ${fmt('per_hour', accepted)} accepted, ${lost} lost, all final within ${drain + 5} s of the last upload | n/a | ${lost === 0 && offered >= 2_000 ? 'yes' : 'no'} | recorded fixtures | ${system.date} |`,
    );
  }
  return rows;
}

// Which models actually read the run: each one's calls, the failed ones among them, its tokens, the versions it reported
// serving, and its share of all the run's calls, most calls first.
const usage = (runs: Run[]) => {
  const rows = new Map<string, { calls: number; failed: number; input: number; output: number; served: Set<string> }>();
  for (const run of runs)
    for (const result of run.results.values())
      for (const call of result.calls) {
        const row = rows.get(`${call.provider}/${call.model}`) ?? { calls: 0, failed: 0, input: 0, output: 0, served: new Set<string>() };
        row.calls += 1;
        if (!replied(call)) row.failed += 1;
        row.input += call.inputTokens;
        row.output += call.outputTokens;
        if (call.servedModel) row.served.add(call.servedModel);
        rows.set(`${call.provider}/${call.model}`, row);
      }
  const total = [...rows.values()].reduce((sum, row) => sum + row.calls, 0);
  return [...rows]
    .sort(([, a], [, b]) => b.calls - a.calls)
    .map(([model, row]) => ({ model, servedAs: [...row.served], calls: row.calls, share: total ? Number((row.calls / total).toFixed(4)) : 0, failed: row.failed, inputTokens: row.input, outputTokens: row.output }));
};
export type ModelUse = ReturnType<typeof usage>[number];
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
// As in "anthropic/claude-haiku-5-5 90.0% of calls, groq/qwen/qwen3.8-27b 10.0%".
const servedBy = (use: Pick<ModelUse, 'model' | 'share'>[]) => use.map(({ model, share }, i) => `${model} ${percent(share)}${i === 0 ? ' of calls' : ''}`).join(', ');
// Claude first at every step when the run reads it so, then each role's free model.
const pins = (roles: Roles, claude?: { provider: string; model: string }) =>
  `${claude ? `${claude.provider}/${claude.model} first at every step, then ` : ''}${Object.entries(roles)
    .map(([role, { provider, model }]) => `${role} ${provider}/${model}`)
    .join(', ')}`;

// A full run of the free models alone is the official free report and has the date alone, the names CI and the floors
// know; a Claude-first run always names its subset and itself. A later set version follows the date, its dev reports
// carry the prompt they read with, so a before and an after on one day never overwrite each other, and repeated reads
// (--repeat) add their count.
export function reportName(subset: Subset, date: string, config?: string, { version = 'v1', promptHash, repeat = 1 }: { version?: string; promptHash?: string; repeat?: number } = {}) {
  const label = config === 'free' ? undefined : config;
  const times = repeat > 1 ? `-x${repeat}` : '';
  if (version === 'v1') return `${label ? `${date}-${subset}-${label}` : subset === 'full' ? date : `${date}-${subset}`}${times}`;
  const prompt = subset === 'dev' && promptHash ? [promptHash.slice(0, 6)] : [];
  return `${[date, version, ...(subset === 'full' && !label ? [] : [subset]), ...prompt, ...(label ? [label] : [])].join('-')}${times}`;
}
// The set CI gates on, whose full runs write the README's table and the landing page's results.
export const DEFAULT_GOLDEN = 'v2';
// v1's floors keep their file; each later version has its own, under the same rules.
export const thresholdsFile = (version: string) => (version === 'v1' ? 'thresholds.json' : `thresholds-${version}.json`);
// The newest official report of a set version for a run, Claude first or the free models alone: a full run's, by name.
export const latestOfficial = (files: string[], version: string, config?: string) => {
  const name = new RegExp(`^${reportName('full', '\\d{4}-\\d{2}-\\d{2}', config, { version })}\\.json$`);
  return files.filter((file) => name.test(file)).sort().at(-1);
};
// Whether a run rewrites the README's table and the landing results: a full run of the default set, Claude first or the
// free models alone, that read every case; never a quota stop or a run that left cases unread (--cached on a partial
// cache).
export const writesReadme = ({ subset, version, stopped, unread = 0 }: { subset: Subset; version: string; config?: string | undefined; stopped?: string | undefined; unread?: number }) =>
  subset === 'full' && !stopped && version === DEFAULT_GOLDEN && unread === 0;

type Official = { name: string; json: { date: string; cases: number; pins: string; metrics: Measured[]; modelUse?: Pick<ModelUse, 'model' | 'share'>[] } };
export type Officials = { claudeFirst?: Official | undefined; free?: Official | undefined };
// The latest official report of each run of a set version, as written.
export async function officialReports(root = ROOT, version = DEFAULT_GOLDEN): Promise<Officials> {
  const reports = new URL('evals/reports/', root);
  const files = existsSync(reports) ? await readdir(reports) : [];
  const load = async (config: 'claude-first' | 'free') => {
    const file = latestOfficial(files, version, config);
    return file ? { name: file.slice(0, -'.json'.length), json: JSON.parse(await readFile(new URL(file, reports), 'utf8')) as Official['json'] } : undefined;
  };
  return { claudeFirst: await load('claude-first'), free: await load('free') };
}

// The README's eval table: the Claude-first run first, labelled, and the free models alone beside it, labelled as what CI
// checks and what reads once Claude stops; then the k6 load test's rows. End-to-end latency comes from k6 alone.
export function readmeSection({ claudeFirst, free }: Officials, loadRows: string[]) {
  const cases = (claudeFirst ?? free)?.json.cases ?? 0;
  const byMetric = (official?: Official) => new Map((official?.json.metrics ?? []).map((m) => [m.metric, m]));
  const [first, alone] = [byMetric(claudeFirst), byMetric(free)];
  const cells = (official: Official | undefined, m: Measured | undefined, metric: Metric) =>
    official ? `${fmt(metric.unit, m?.value ?? undefined)} | ${ci(metric.unit, m?.ci ?? undefined)} | ${meets(m?.value ?? undefined, metric.target!) ? 'yes' : 'no'}` : 'not measured | - | -';
  const line = (label: string, about: string, official?: Official) =>
    official
      ? `- **${label}** (${about}): measured ${official.json.date}${official.json.modelUse ? `; served: ${servedBy(official.json.modelUse)}` : ` with ${official.json.pins}`}. Full report: \`evals/reports/${official.name}.md\`.`
      : `- **${label}**: not measured yet.`;
  return [
    '<!-- eval:start -->',
    '## Eval results',
    '',
    `Golden set ${DEFAULT_GOLDEN} (${cases} synthetic invoices, ground truth from the generator), read two ways. ${cases} cases give wide intervals; misses are listed as misses.`,
    '',
    line('Claude first', "Claude Haiku 5.5 reads first at every step, with the free models behind it: the demo's chain while Claude reads first", claudeFirst),
    line('Free models only', 'what CI checks on every change to extraction, and what reads once Claude stops at its end date, its spend cap or its credit', free),
    '',
    '| Metric | Target | Claude first | 95% CI | Met | Free models only | 95% CI | Met |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...METRICS.filter((metric) => metric.target && metric.metric !== 'e2e_latency_p95_ms').map(
      (metric) => `| ${metric.label} | ${bound(metric.target!.op, metric.unit, metric.target!.value)} | ${cells(claudeFirst, first.get(metric.metric), metric)} | ${cells(free, alone.get(metric.metric), metric)} |`,
    ),
    ...(loadRows.length > 0 ? ['', 'Under load, from the k6 load test:', '', '| Metric | Target | Measured | 95% CI | Met | Model | Date |', '| --- | --- | --- | --- | --- | --- | --- |', ...loadRows] : []),
    '<!-- eval:end -->',
  ].join('\n');
}

async function writeReadme(root: URL, officials: Officials) {
  const table = readmeSection(officials, await loadTestRows(root));
  const readmeUrl = new URL('README.md', root);
  const readme = await readFile(readmeUrl, 'utf8');
  const marked = /<!-- eval:start -->[\s\S]*<!-- eval:end -->/;
  // A function, so a "$1" in a dollar amount is never read as a capture group.
  await writeFile(readmeUrl, marked.test(readme) ? readme.replace(marked, () => table) : readme.replace(/^(# .*\n)/, (heading) => `${heading}\n${table}\n`));
}

export type Breakdown = { by: 'kind' | 'trait'; name: string; cases: number; header: [number, number]; carrier: [number, number]; count: [number, number]; outcome: [number, number] };
// Per kind, then per trait: cases (reads, with --repeat), header fields, the carrier, invoices read against the truth and
// outcomes, so a fix for one kind of miss shows where it lands.
export function byKindAndTrait(cases: Pick<GoldenCase, 'id' | 'kind' | 'traits'>[], scores: Score[]): Breakdown[] {
  const scoreOf = new Map(scores.map((score) => [score.id, score]));
  const rows = new Map<string, Breakdown>();
  const add = (by: Breakdown['by'], name: string, score: Score) => {
    const row: Breakdown = rows.get(`${by}:${name}`) ?? { by, name, cases: 0, header: [0, 0], carrier: [0, 0], count: [0, 0], outcome: [0, 0] };
    row.cases += 1;
    row.header = [row.header[0] + score.header.correct, row.header[1] + score.header.total];
    row.carrier = [row.carrier[0] + score.fields.carrier, row.carrier[1] + score.outcomes.total];
    row.count = [row.count[0] + (score.invoices.read === score.invoices.truth ? 1 : 0), row.count[1] + 1];
    row.outcome = [row.outcome[0] + score.outcomes.ok, row.outcome[1] + score.outcomes.total];
    rows.set(`${by}:${name}`, row);
  };
  for (const golden of cases) {
    const score = scoreOf.get(golden.id);
    if (!score) continue;
    add('kind', golden.kind, score);
    for (const trait of golden.traits ?? []) add('trait', trait, score);
  }
  const all = [...rows.values()];
  return [...all.filter((row) => row.by === 'kind'), ...all.filter((row) => row.by === 'trait').sort((a, b) => a.name.localeCompare(b.name))];
}

const largest = (values: number[]) => (values.length > 0 ? Math.max(...values).toLocaleString('en-US') : 'none');

// A labelled run beside the latest official free run of its own set version on the cases both read, then Claude's
// largest calls and invoices against the caps it ran under.
async function beside(scores: Score[], run: Run, reports: URL) {
  const official = latestOfficial(await readdir(reports), run.version);
  const lines = ['', `## Beside the official free run (${official ?? 'none found'})`, ''];
  if (official) {
    const ids = new Set(scores.map((score) => score.id));
    const theirs = (JSON.parse(await readFile(new URL(official, reports), 'utf8')) as { scores: Score[] }).scores.filter((score) => ids.has(score.id));
    const free = new Map(measure(theirs).map((m) => [m.metric, m]));
    lines.push(`On the ${theirs.length} cases both runs read, measured from each report's per-case scores.`, '', '| Metric | Free models (official) | This run |', '| --- | --- | --- |');
    for (const m of measure(scores)) {
      const metric = metricOf(m.metric);
      lines.push(`| ${metric.label} | ${fmt(metric.unit, free.get(m.metric)?.value)} | ${fmt(metric.unit, m.value)} |`);
    }
  }
  const calls = [...run.results.values()].flatMap((result) => result.calls).filter((call) => call.provider === 'anthropic' && replied(call));
  // An invoice's Claude tokens in one attempt, as the cap counts them: from its Claude first pass to the next one, since a
  // job retry starts the ladder over.
  const tokens = new Map<string, number>();
  const attempts = new Map<string, number>();
  for (const call of calls) {
    const invoice = call.invoiceId ?? '';
    if (call.step === 'first_pass') attempts.set(invoice, (attempts.get(invoice) ?? 0) + 1);
    const key = `${invoice}#${attempts.get(invoice) ?? 1}`;
    tokens.set(key, (tokens.get(key) ?? 0) + call.inputTokens + call.outputTokens);
  }
  const perInvoice = [...tokens.values()];
  lines.push(
    '',
    '## Claude against its caps',
    '',
    '| Per | Largest in this run | Cap |',
    '| --- | --- | --- |',
    `| Output tokens per call | ${largest(calls.map((call) => call.outputTokens))} | ${CLAUDE_FIRST_MAX_TOKENS.toLocaleString('en-US')} |`,
    `| Input tokens per call | ${largest(calls.map((call) => call.inputTokens))} | ${CLAUDE_INPUT_CAP.toLocaleString('en-US')}, estimated before sending |`,
    `| Claude tokens per invoice attempt | ${largest(perInvoice)} | ${CLAUDE_EXTRACTION_CAP.toLocaleString('en-US')}, with the next call reserved |`,
  );
  return lines;
}

export async function report({
  subset,
  runs,
  durationMs,
  setFloors,
  config,
  root = ROOT,
}: {
  subset: Subset;
  runs: Run[];
  durationMs: number;
  setFloors: boolean;
  config?: string | undefined;
  root?: URL;
}) {
  const date = new Date().toISOString().slice(0, 10);
  const { version, promptHash, repeat } = runs[0]!;
  const name = reportName(subset, date, config, { version, promptHash, repeat });
  const thresholdsUrl = new URL(`evals/${thresholdsFile(version)}`, root);
  const reports = new URL('evals/reports/', root);
  const stopped = runs.find((run) => run.stopped)?.stopped;
  // A comparison scores only the cases every run finished, so both columns cover the same invoices.
  const done = (golden: { id: string }) => (subset === 'compare' ? runs.every((run) => run.results.has(golden.id)) : true);
  const scored = runs.map((run) => ({ run, scores: run.cases.filter((golden) => run.results.has(golden.id) && done(golden)).map((golden) => scoreCase(golden, run.results.get(golden.id)!)) }));
  const rewrites = writesReadme({ subset, version, config, stopped, unread: scored.reduce((sum, { run, scores }) => sum + run.cases.length - scores.length, 0) });
  const used = usage(runs);
  const usageTable = [
    '| Model | Served as | Calls | Share of calls | Failed | Input tokens | Output tokens |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...used.map(
      (row) =>
        `| ${row.model} | ${row.servedAs.join(', ')} | ${row.calls} | ${percent(row.share)} | ${row.failed} | ${row.inputTokens.toLocaleString('en-US')} | ${row.outputTokens.toLocaleString('en-US')} |`,
    ),
  ];
  // A Claude-first run is never held to the floors, which come from the free models alone, and never sets them.
  const labelled = config !== undefined && config !== 'free';
  const head = (run: Run, scores: Score[]) =>
    `${scores.length} of ${run.cases.length} cases (${run.computed} run now, the rest from the cache), prompt ${run.promptHash}, models: ${pins(run.roles, run.claude)}.`;
  const lines: string[] = [];
  let code = stopped ? 2 : 0;
  const json: Record<string, unknown> = { suite: 'extraction', subset, date, durationMs, stopped: stopped ?? null };

  if (subset === 'compare') {
    const keys = ['header_accuracy_scanned', 'line_f1_scanned', 'extraction_latency_p50_ms', 'extraction_latency_p95_ms', 'tokens_per_invoice_scanned', 'outcome_accuracy'];
    const measured = scored.map(({ scores }) => new Map(measure(scores).map((m) => [m.metric, m])));
    lines.push(`# Primary model comparison (${date})`, '', 'On evals/comparison/v1: 15 scans drawn with seed 7 from shipments the golden set does not bill, outside golden/v1, so the choice never looks at the test split. 15 cases give wide intervals.', '');
    for (const { run, scores } of scored) lines.push(`- ${run.label}: ${head(run, scores)}`);
    lines.push('', `| Metric | ${scored.map(({ run }) => run.label).join(' | ')} |`, `| --- | ${scored.map(() => '---').join(' | ')} |`);
    for (const key of keys) {
      const metric = metricOf(key);
      lines.push(`| ${metric.label} | ${measured.map((m) => `${fmt(metric.unit, m.get(key)?.value)} (${ci(metric.unit, m.get(key)?.ci)})`).join(' | ')} |`);
    }
    lines.push('', '## Model use', '', ...usageTable);
    json.runs = scored.map(({ run, scores }, i) => ({ label: run.label, pins: pins(run.roles, run.claude), promptHash: run.promptHash, cases: scores.length, metrics: [...measured[i]!.values()] }));
    json.modelUse = used;
  } else {
    const [{ run, scores }] = scored as [(typeof scored)[number]];
    const measured: Measured[] = measure(scores);
    const ceiling = throughput(scores, run.roles);
    const thresholds: Thresholds = existsSync(thresholdsUrl) ? (JSON.parse(await readFile(thresholdsUrl, 'utf8')) as Thresholds) : {};
    const floors = labelled ? {} : (thresholds[subset] ??= {});
    const suggestions: string[] = [];
    const rows = measured.map((m) => {
      const metric = metricOf(m.metric);
      const floor = floors[m.metric];
      const floorBound = floor && (floor.min !== undefined ? { op: '>=' as const, value: floor.min } : { op: '<=' as const, value: floor.max! });
      const floorOk = floorBound ? meets(m.value, floorBound) : undefined;
      const gated = !(subset === 'ci' && NOT_GATED_IN_CI.has(m.metric));
      if (floorOk === false && gated) code = Math.max(code, 1);
      // A run that clears its floor by more than its own interval's width earns a tighter floor, when the rule gives one.
      const proposed = m.ci && floorFrom(metric, m.ci);
      // A floor pinned to the design target by a written decision is never proposed for tightening.
      const tighter = floor?.from !== 'design target' && proposed !== undefined && floorBound && (metric.higherIsBetter ? proposed > floorBound.value : proposed < floorBound.value);
      if (gated && tighter && m.value !== undefined && m.ci && Math.abs(m.value - floorBound.value) > m.ci[1] - m.ci[0] && floorOk)
        suggestions.push(`${metric.label}: measured ${fmt(metric.unit, m.value)} clears the floor ${fmt(metric.unit, floorBound.value)} by more than the interval's width; consider tightening it to ${fmt(metric.unit, proposed)}.`);
      if (setFloors && !floor && m.value !== undefined && m.ci) {
        floors[m.metric] = { [metric.higherIsBetter ? 'min' : 'max']: floorFrom(metric, m.ci), from: name };
      }
      return { m, metric, floorBound, floorOk, gated };
    });
    if (setFloors) {
      thresholds._rules ??= RULES;
      await writeFile(thresholdsUrl, `${JSON.stringify(thresholds, null, 2)}\n`);
    }
    const wide =
      subset === 'full'
        ? `${scores.length} cases give wide intervals: read each measurement with its 95% interval.`
        : `${scores.length} ${(repeat ?? 1) > 1 ? 'reads' : 'cases'} give very wide intervals; this subset guards against regressions, it does not measure the targets.${subset === 'ci' ? ' Its two latency p95 rows are shown against their floors without gating: a p95 of so few cases is the slowest one or two, which one slow provider call moves.' : ''}`;
    const reads = (repeat ?? 1) > 1 ? ` Each case read ${repeat} times, each read in its own environment; the tables count reads.` : '';
    lines.push(
      `# Extraction eval: ${subset} (${date})`,
      '',
      `Golden set ${version}, ${head(run, scores)} Took ${Math.round(durationMs / 1000)} s.${reads}`,
      '',
      `Served: ${used.length > 0 ? servedBy(used) : 'no model call'}.`,
      '',
      wide,
      '',
    );
    if (stopped) lines.push(`**Stopped early on a spent quota (${stopped}); rerun the same command to resume from the cache.**`, '');
    lines.push('| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const { m, metric, floorBound, floorOk, gated } of rows) {
      const target = metric.target ? `${bound(metric.target.op, metric.unit, metric.target.value)} | ${yes(meets(m.value, metric.target))}` : '- | -';
      const floor = floorBound ? `${bound(floorBound.op, metric.unit, floorBound.value)} | ${floorOk ? 'kept' : 'broken'}${gated ? '' : ', not gated in ci'}` : '- | -';
      lines.push(`| ${metric.label} | ${target} | ${floor} | ${fmt(metric.unit, m.value)} | ${ci(metric.unit, m.ci)} | ${m.n} |`);
    }
    lines.push(
      `| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | ${yes((ceiling ?? 0) >= 2_000)} | - | - | ${fmt('per_hour', ceiling)} / h | computed, no interval | ${scores.length} |`,
      '',
      "Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).",
    );
    if (suggestions.length > 0) lines.push('', '## Floors to tighten', '', ...suggestions.map((text) => `- ${text}`));
    const misses = scores.filter((s) => s.header.correct < s.header.total || s.lines.fp + s.lines.fn > 0 || s.overcharges.fp + s.overcharges.fn > 0 || s.outcomes.ok < s.outcomes.total || s.invoices.read !== s.invoices.truth);
    const kinds = new Map(run.cases.map((golden) => [golden.id, golden.kind]));
    const traits = new Map(run.cases.map((golden) => [golden.id, golden.traits?.join(', ') || '-']));
    const share = ([ok, all]: [number, number]) => `${ok}/${all}`;
    const failures = failuresOf(
      run.cases.map((golden) => golden.id),
      run.results,
    );
    const cell = (text: string | null) => (text ?? 'unknown').replaceAll('|', '\\|');
    lines.push('', '## Model use', '', ...usageTable, '', '## Failed calls', '');
    if (failures.length === 0) lines.push('None.');
    else
      lines.push(
        '| Case | Provider | Model | Class | HTTP | Error |',
        '| --- | --- | --- | --- | --- | --- |',
        ...failures.map((f) => `| ${f.id} | ${f.provider} | ${f.model} | ${cell(f.class)} | ${f.status ?? '-'} | ${cell(f.message)} |`),
      );
    const breakdown = byKindAndTrait(run.cases, scores);
    lines.push(
      '',
      '## By kind and trait',
      '',
      'Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.',
      '',
      '| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...breakdown.map((row) => `| ${row.by} | ${row.name} | ${row.cases} | ${share(row.header)} | ${share(row.carrier)} | ${share(row.count)} | ${share(row.outcome)} |`),
    );
    lines.push('', '## Cases with any miss', '', '| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of misses) {
      const result = run.results.get(s.id)!;
      lines.push(
        `| ${s.id} | ${kinds.get(s.id)} | ${traits.get(s.id)} | ${s.path} | ${s.header.correct}/${s.header.total} | ${s.invoices.read} of ${s.invoices.truth} | ${s.lines.tp}/${s.lines.fp}/${s.lines.fn} | ${s.overcharges.tp}/${s.overcharges.fp}/${s.overcharges.fn} | ${s.outcomes.ok}/${s.outcomes.total} | ${result.status}${result.error ? ` (${result.error})` : ''} |`,
      );
    }
    if (labelled) lines.push(...(await beside(scores, run, reports)));
    Object.assign(json, {
      config: config ?? null,
      golden: version,
      repeat: repeat ?? 1,
      promptHash: run.promptHash,
      pins: pins(run.roles, run.claude),
      cases: scores.length,
      computed: run.computed,
      modelUse: used,
      metrics: measured,
      throughputPerHour: ceiling ?? null,
      floors,
      failures,
      breakdown,
      scores,
    });
  }
  await writeFile(new URL(`${name}.json`, reports), `${JSON.stringify(json, null, 2)}\n`);
  await writeFile(new URL(`${name}.md`, reports), `${lines.join('\n')}\n`);
  // The README's eval table and the landing page's results follow the latest official report of each run, read back once
  // this one is written.
  if (rewrites) {
    const officials = await officialReports(root, version);
    await writeReadme(root, officials);
    await writeLandingResults(root, officials);
  }
  console.log(lines.join('\n'));
  return code;
}
