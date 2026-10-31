import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GoldenCase } from '../golden/build.ts';
import { landingResults, namedReports } from './landing.ts';
import type { Measured, Score } from './metrics.ts';
import { byKindAndTrait, DEFAULT_GOLDEN, latestOfficial, readmeSection, report, reportName, thresholdsFile, writesReadme } from './report.ts';
import type { Run, Subset } from './run.ts';

test('report names keep v1 as it was, and give v2 its version, dev its prompt, a Claude-first run its config and repeated reads their count', () => {
  expect(reportName('full', '2026-10-26')).toBe('2026-10-26');
  expect(reportName('ci', '2026-10-26')).toBe('2026-10-26-ci');
  expect(reportName('test', '2026-10-26', 'claude-first')).toBe('2026-10-26-test-claude-first');
  const v2 = { version: 'v2', promptHash: '19f0c19627c4' };
  expect(reportName('full', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2');
  expect(reportName('ci', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2-ci');
  expect(reportName('dev', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2-dev-19f0c1');
  expect(reportName('dev', '2026-10-26', 'claude-first', { ...v2, repeat: 3 })).toBe('2026-10-26-v2-dev-19f0c1-claude-first-x3');
  expect(reportName('full', '2026-10-26', 'claude-first', v2)).toBe('2026-10-26-v2-full-claude-first');
  // The free models alone keep the names CI's artifacts and the floors' `from` know.
  expect(reportName('ci', '2026-10-26', 'free', v2)).toBe('2026-10-26-v2-ci');
});

test("each version has its own floors, and each run's newest official report is found by its own name", () => {
  expect(thresholdsFile('v1')).toBe('thresholds.json');
  expect(thresholdsFile('v2')).toBe('thresholds-v2.json');
  const files = [
    '2026-10-15.json',
    '2026-10-15-ci.json',
    '2026-10-17-test-haiku.json',
    '2026-11-01-v2-ci.json',
    '2026-11-02-v2.json',
    '2026-10-26-v2-dev-19f0c1.json',
    '2026-10-27-v2-test-claude-primary.json',
    '2026-11-01-v2-full-claude-first.json',
    '2026-11-03-v2-full-claude-first.json',
    '2026-11-04-v2-test-claude-first.json',
  ];
  expect(latestOfficial(files, 'v1')).toBe('2026-10-15.json');
  expect(latestOfficial(files, 'v2')).toBe('2026-11-02-v2.json');
  expect(latestOfficial(files, 'v2', 'free')).toBe('2026-11-02-v2.json');
  expect(latestOfficial(files, 'v2', 'claude-first')).toBe('2026-11-03-v2-full-claude-first.json');
  expect(latestOfficial(['2026-10-15.json'], 'v2')).toBeUndefined();
});

const measured = (metric: string, value: number): Measured => ({ metric, value, ci: [value - 0.01, value], n: 48 });
test('the README leads with the Claude-first run, labelled, with the free models beside it as what CI checks; only a complete full run of the default set writes it', () => {
  const claudeFirst = {
    name: '2026-11-01-v2-full-claude-first',
    json: {
      date: '2026-11-01',
      cases: 98,
      pins: 'anthropic/claude-haiku-5-5 first at every step, then primary gemini/g, text groq/t, fallback groq/f',
      metrics: [measured('header_accuracy_digital', 0.99)],
      modelUse: [
        { model: 'anthropic/claude-haiku-5-5', calls: 90, share: 0.9 },
        { model: 'groq/qwen/qwen3.8-27b', calls: 10, share: 0.1 },
      ],
    },
  };
  const free = { name: '2026-10-27-v2', json: { date: '2026-10-27', cases: 98, pins: 'primary gemini/g, text groq/t, fallback groq/f', metrics: [measured('header_accuracy_digital', 0.97)] } };
  const section = readmeSection({ claudeFirst, free }, ['| k6 row |']);
  expect(section).toMatch(/^<!-- eval:start -->\n## Eval results\n/);
  expect(section).toMatch(/<!-- eval:end -->$/);
  expect(section).toContain('Golden set v2 (98 synthetic invoices');
  expect(section).toContain('- **Claude first**');
  expect(section).toContain('measured 2026-11-01; served: anthropic/claude-haiku-5-5 90.0% of calls, groq/qwen/qwen3.8-27b 10.0%. Full report: `evals/reports/2026-11-01-v2-full-claude-first.md`.');
  expect(section).toContain('- **Free models only**');
  expect(section).toContain('what CI checks');
  expect(section).toContain('measured 2026-10-27 with primary gemini/g, text groq/t, fallback groq/f. Full report: `evals/reports/2026-10-27-v2.md`.');
  expect(section).toContain('| Metric | Target | Claude first | 95% CI | Met | Free models only | 95% CI | Met |');
  expect(section).toContain('| Header field accuracy (digital) | ≥ 0.980 | 0.990 | 0.980 to 0.990 | yes | 0.970 | 0.960 to 0.970 | no |');
  expect(section).toContain('| k6 row |');
  // The Claude-first line comes first, so the README leads with it.
  expect(section.indexOf('**Claude first**')).toBeLessThan(section.indexOf('**Free models only**'));
  expect(namedReports(section)).toEqual(['2026-11-01-v2-full-claude-first', '2026-10-27-v2']);
  // A run not measured yet says so.
  const freeOnly = readmeSection({ free }, []);
  expect(freeOnly).toContain('- **Claude first**: not measured yet.');
  expect(freeOnly).toContain('| Header field accuracy (digital) | ≥ 0.980 | not measured | - | - | 0.970 | 0.960 to 0.970 | no |');
  // v2 is the default set; v1's reports stay, and its full runs no longer write. Either run of the default set writes.
  expect(writesReadme({ subset: 'full', version: 'v2' })).toBe(true);
  expect(writesReadme({ subset: 'full', version: 'v2', config: 'claude-first' })).toBe(true);
  expect(writesReadme({ subset: 'full', version: 'v2', config: 'free' })).toBe(true);
  expect(writesReadme({ subset: 'full', version: 'v1' })).toBe(false);
  expect(writesReadme({ subset: 'full', version: 'v2', stopped: 'g2-001: HTTP 429' })).toBe(false);
  expect(writesReadme({ subset: 'ci', version: 'v2' })).toBe(false);
});

// CI's smoke and the weekly run read the default set's floors file; without it, or without a subset's floors, nothing gates.
test('the default set has floors for the ci subset and the full set', async () => {
  const thresholds = JSON.parse(await readFile(new URL(`../${thresholdsFile(DEFAULT_GOLDEN)}`, import.meta.url), 'utf8')) as Record<string, object>;
  expect([Object.keys(thresholds.ci ?? {}).length > 0, Object.keys(thresholds.full ?? {}).length > 0]).toEqual([true, true]);
});

const OLDER_README = '# FreightAudit\n\n<!-- eval:start -->\nan older table\n<!-- eval:end -->\n';
const goldenCase = async (id: string) => JSON.parse(await readFile(new URL(`../golden/v2/cases/${id}.json`, import.meta.url), 'utf8')) as GoldenCase;
const role = (provider: 'gemini' | 'groq', model: string) => ({ provider, model, baseUrl: 'http://127.0.0.1:9', apiKey: 'test-key', rpm: 30, tpm: 6_000 });
// A run of the default set over these cases, with a result holding these calls for each one it read.
const runOf = (cases: GoldenCase[], read: GoldenCase[], calls: object[] = []) =>
  ({
    label: 'pinned',
    version: DEFAULT_GOLDEN,
    roles: { primary: role('gemini', 'p'), text: role('groq', 't'), fallback: role('groq', 'f') },
    cases,
    results: new Map(read.map((golden) => [golden.id, { id: golden.id, status: 'reconciled', error: null, e2eMs: 1_000, invoices: [], calls }])),
    stopped: undefined,
    computed: 0,
    key: 'k',
    promptHash: 'p',
  }) as Run;
// A call on the text model that returned a reply after this long, or failed.
const call = (outcome: 'valid' | 'error', latencyMs: number) => ({
  invoiceId: 'i1',
  role: 'text',
  step: 'first_pass',
  provider: 'groq',
  model: 't',
  servedModel: null,
  outcome,
  inputTokens: 1_000,
  outputTokens: 100,
  latencyMs,
  waitMs: 0,
  errorClass: outcome === 'error' ? '5xx' : null,
  httpStatus: outcome === 'error' ? 503 : null,
  errorMessage: outcome === 'error' ? 'groq HTTP 503' : null,
  costMicroUsd: 0,
  paidMicroUsd: 0,
});
// report() on such a run in a temp folder that holds an older README table, these earlier reports and, when given, the
// set's floors: its exit code and the files it left there.
async function reportIn(
  run: Run,
  { subset = 'full', thresholds, config = 'free', files = {} }: { subset?: Subset; thresholds?: object; config?: 'free' | 'claude-first'; files?: Record<string, object> } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'freightaudit-report-'));
  const root = pathToFileURL(`${dir}/`);
  const log = console.log;
  const read = (path: string) => readFile(new URL(path, root), 'utf8').catch(() => undefined);
  try {
    await mkdir(new URL('evals/reports/', root), { recursive: true });
    await mkdir(new URL('apps/web/lib/', root), { recursive: true });
    await writeFile(new URL('README.md', root), OLDER_README);
    for (const [file, json] of Object.entries(files)) await writeFile(new URL(`evals/reports/${file}`, root), JSON.stringify(json));
    if (thresholds) await writeFile(new URL(`evals/${thresholdsFile(DEFAULT_GOLDEN)}`, root), JSON.stringify(thresholds));
    console.log = () => {};
    const code = await report({ subset, runs: [run], durationMs: 1, setFloors: false, config, root });
    console.log = log;
    const written = await readdir(new URL('evals/reports/', root));
    const reports = Object.fromEntries(await Promise.all(written.filter((file) => !Object.hasOwn(files, file)).map(async (file) => [file, await read(`evals/reports/${file}`)] as const)));
    return { code, readme: await read('README.md'), landing: await read('apps/web/lib/eval-results.json'), reports };
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
}

// The landing page's results are built from the reports the README names, so a run's report must be on disk first.
test('a full run of the default set writes its report, then the README table and the landing results that name it', async () => {
  const golden = await goldenCase('g2-001');
  const { code, readme, landing, reports } = await reportIn(runOf([golden], [golden]));
  expect(code).toBe(0);
  const [name, ...others] = namedReports(readme!);
  const written = JSON.parse(reports[`${name}.json`]!);
  // The name carries the date report() took, so the test never reads a clock of its own that 00:00 UTC could move.
  expect([name, others]).toEqual([`${written.date}-v2`, []]);
  expect(JSON.parse(landing!)).toEqual(landingResults({ free: { name: name!, json: written } }));
});

// A Claude call that returned a reply, on the same invoice as the free calls.
const claudeCall = { ...call('valid', 900), provider: 'anthropic', model: 'claude-haiku-5-5', servedModel: 'claude-haiku-5-5' };
test("a full Claude-first run is never held to floors nor sets them; its report gives each model's share of calls, and the README and landing results show it beside the free run", async () => {
  const golden = await goldenCase('g2-001');
  const run = { ...runOf([golden], [golden], [claudeCall, call('error', 0)]), claude: { provider: 'anthropic', model: 'claude-haiku-5-5' } } as Run;
  const free = { date: '2026-10-27', cases: 1, pins: 'primary gemini/p, text groq/t, fallback groq/f', metrics: [], scores: [] };
  const { code, readme, landing, reports } = await reportIn(run, { config: 'claude-first', thresholds: { full: { failed_calls: { max: 0, from: 'test' } } }, files: { '2026-10-27-v2.json': free } });
  // One failed call would break the free floor; a Claude-first run is never held to it.
  expect(code).toBe(0);
  const [name, freeName] = namedReports(readme!);
  expect([name, freeName]).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}-v2-full-claude-first$/), '2026-10-27-v2']);
  const md = reports[`${name}.md`]!;
  expect(md).toContain('Served: anthropic/claude-haiku-5-5 50.0% of calls, groq/t 50.0%.');
  expect(md).toContain('| Model | Served as | Calls | Share of calls | Failed | Input tokens | Output tokens |');
  expect(md).toContain('| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 1 | 50.0% | 0 | 1,000 | 100 |');
  expect(md).toContain('| groq/t |  | 1 | 50.0% | 1 | 1,000 | 100 |');
  expect(md).toContain('| Claude tokens per invoice attempt | 1,100 |');
  const json = JSON.parse(reports[`${name}.json`]!);
  expect(json).toMatchObject({
    config: 'claude-first',
    floors: {},
    pins: 'anthropic/claude-haiku-5-5 first at every step, then primary gemini/p, text groq/t, fallback groq/f',
    modelUse: [
      { model: 'anthropic/claude-haiku-5-5', servedAs: ['claude-haiku-5-5'], calls: 1, share: 0.5, failed: 0 },
      { model: 'groq/t', servedAs: [], calls: 1, share: 0.5, failed: 1 },
    ],
  });
  expect(JSON.parse(landing!)).toEqual(landingResults({ claudeFirst: { name: name!, json }, free: { name: '2026-10-27-v2', json: free } }));
});

test('a full run that left a case unread, as --cached does on a partial cache, writes its report but not the README table or the landing results', async () => {
  const [read, unread] = await Promise.all([goldenCase('g2-001'), goldenCase('g2-002')]);
  const { code, readme, landing, reports } = await reportIn(runOf([read, unread], [read]));
  expect(code).toBe(0);
  const json = Object.entries(reports).find(([file]) => file.endsWith('.json'))![1]!;
  expect([Object.keys(reports).length, JSON.parse(json).cases]).toEqual([2, 1]);
  expect([readme, landing]).toEqual([OLDER_README, undefined]);
});

// The report's two latency p95 rows, as its table prints them.
const p95Rows = (reports: Record<string, string | undefined>) =>
  Object.entries(reports)
    .find(([file]) => file.endsWith('.md'))![1]!
    .split('\n')
    .filter((line) => line.startsWith('| Extraction latency p95') || line.startsWith('| End-to-end latency p95'));
// Floors the one case's 5,000 ms reply and its 1,000 ms upload to final status both break.
const LATENCY_FLOORS = { extraction_latency_p95_ms: { max: 1_000, from: 'test' }, e2e_latency_p95_ms: { max: 500, from: 'test' } };

// With 20 cases a p95 is the slowest one or two, which one slow provider call moves past any floor; 98 cases hold it.
test('in the ci subset the latency p95 rows are reported against their floors without gating; the full run still gates them', async () => {
  const golden = await goldenCase('g2-001');
  const run = runOf([golden], [golden], [call('valid', 5_000)]);
  const ci = await reportIn(run, { subset: 'ci', thresholds: { ci: LATENCY_FLOORS } });
  expect(ci.code).toBe(0);
  expect(p95Rows(ci.reports)).toEqual([expect.stringContaining('| ≤ 1,000 ms | broken, not gated in ci |'), expect.stringContaining('| ≤ 500 ms | broken, not gated in ci |')]);
  const full = await reportIn(run, { subset: 'full', thresholds: { full: LATENCY_FLOORS } });
  expect(full.code).toBe(1);
  expect(p95Rows(full.reports)).toEqual([expect.stringContaining('| ≤ 1,000 ms | broken |'), expect.stringContaining('| ≤ 500 ms | broken |')]);
});

test('in the ci subset every other row still gates: a failed call over its floor exits 1', async () => {
  const golden = await goldenCase('g2-001');
  const { code } = await reportIn(runOf([golden], [golden], [call('error', 0), call('valid', 900)]), { subset: 'ci', thresholds: { ci: { failed_calls: { max: 0, from: 'test' } } } });
  expect(code).toBe(1);
});

test('the breakdown counts each kind and each trait: cases, header fields, carrier, invoices read and outcomes', () => {
  const cases = [
    { id: 'a', kind: 'clean', traits: ['title_line', 'fax'] },
    { id: 'b', kind: 'clean', traits: ['title_line'] },
    { id: 'c', kind: 'repeated_page', traits: ['fax'] },
  ] as GoldenCase[];
  const fields = { carrier: 1, invoice_number: 1, invoice_date: 1, pro_number: 1, currency: 1, total_cents: 1 };
  const score = (id: string, over: Partial<Score> = {}) => ({ id, header: { correct: 6, total: 6 }, fields, invoices: { truth: 1, read: 1 }, outcomes: { ok: 1, total: 1 }, ...over }) as Score;
  const scores = [
    score('a', { header: { correct: 5, total: 6 }, fields: { ...fields, carrier: 0 } }),
    score('b'),
    score('c', { invoices: { truth: 1, read: 2 }, outcomes: { ok: 0, total: 1 } }),
  ];
  expect(byKindAndTrait(cases, scores)).toEqual([
    { by: 'kind', name: 'clean', cases: 2, header: [11, 12], carrier: [1, 2], count: [2, 2], outcome: [2, 2] },
    { by: 'kind', name: 'repeated_page', cases: 1, header: [6, 6], carrier: [1, 1], count: [0, 1], outcome: [0, 1] },
    { by: 'trait', name: 'fax', cases: 2, header: [11, 12], carrier: [1, 2], count: [1, 2], outcome: [1, 2] },
    { by: 'trait', name: 'title_line', cases: 2, header: [11, 12], carrier: [1, 2], count: [2, 2], outcome: [2, 2] },
  ]);
  // A repeated read of a case (its id with #2) counts as one more read of the same kind and traits.
  expect(byKindAndTrait([...cases, { ...cases[2]!, id: 'c#2' }], [...scores, score('c#2')])[1]).toMatchObject({ name: 'repeated_page', cases: 2, count: [1, 2] });
});
