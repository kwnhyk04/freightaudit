import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GoldenCase } from '../golden/build.ts';
import { landingResults, namedReport } from './landing.ts';
import type { Score } from './metrics.ts';
import { byKindAndTrait, DEFAULT_GOLDEN, latestOfficial, readmeIntro, report, reportName, thresholdsFile, writesReadme } from './report.ts';
import type { Run } from './run.ts';

test('report names keep v1 as it was, and give v2 its version, dev its prompt and repeated reads their count', () => {
  expect(reportName('full', '2026-10-26')).toBe('2026-10-26');
  expect(reportName('ci', '2026-10-26')).toBe('2026-10-26-ci');
  expect(reportName('test', '2026-10-26', 'claude-primary')).toBe('2026-10-26-test-claude-primary');
  const v2 = { version: 'v2', promptHash: '19f0c19627c4' };
  expect(reportName('full', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2');
  expect(reportName('ci', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2-ci');
  expect(reportName('dev', '2026-10-26', undefined, v2)).toBe('2026-10-26-v2-dev-19f0c1');
  expect(reportName('dev', '2026-10-26', 'claude-primary', { ...v2, repeat: 3 })).toBe('2026-10-26-v2-dev-19f0c1-claude-primary-x3');
  expect(reportName('test', '2026-10-26', 'claude-primary', v2)).toBe('2026-10-26-v2-test-claude-primary');
});

test('each version has its own floors, and a labelled run sits beside the newest official run of its own version', () => {
  expect(thresholdsFile('v1')).toBe('thresholds.json');
  expect(thresholdsFile('v2')).toBe('thresholds-v2.json');
  const files = ['2026-10-15.json', '2026-10-15-ci.json', '2026-10-17-test-haiku.json', '2026-11-01-v2-ci.json', '2026-11-02-v2.json', '2026-10-26-v2-dev-19f0c1.json'];
  expect(latestOfficial(files, 'v1')).toBe('2026-10-15.json');
  expect(latestOfficial(files, 'v2')).toBe('2026-11-02-v2.json');
  expect(latestOfficial(['2026-10-15.json'], 'v2')).toBeUndefined();
});

test('the README names the set version and its case count, and only a full run of the default set writes it', () => {
  // v1's words stay as the README has them.
  expect(readmeIntro({ version: 'v1', cases: 90, date: '2026-10-15', served: 'primary p', name: '2026-10-15' })).toBe(
    'Golden set v1 (90 synthetic invoices, ground truth from the generator), measured 2026-10-15 with primary p. 90 cases give wide intervals; misses are listed as misses. Full report: `evals/reports/2026-10-15.md`.',
  );
  expect(readmeIntro({ version: 'v2', cases: 98, date: '2026-11-02', served: 'primary p', name: '2026-11-02-v2' })).toMatch(/^Golden set v2 \(98 synthetic invoices.* 98 cases give wide intervals;.*`evals\/reports\/2026-11-02-v2\.md`\.$/);
  // v2 is the default set since its official run set its floors; v1's reports stay, and its full runs no longer write.
  expect(writesReadme({ subset: 'full', version: 'v2' })).toBe(true);
  expect(writesReadme({ subset: 'full', version: 'v1' })).toBe(false);
  expect(writesReadme({ subset: 'full', version: 'v2', config: 'claude-primary' })).toBe(false);
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
// A full run of the default set over these cases, with a result for each one it read.
const fullRun = (cases: GoldenCase[], read: GoldenCase[]) =>
  ({
    label: 'pinned',
    version: DEFAULT_GOLDEN,
    roles: { primary: role('gemini', 'p'), text: role('groq', 't'), fallback: role('groq', 'f') },
    cases,
    results: new Map(read.map((golden) => [golden.id, { id: golden.id, status: 'reconciled', error: null, e2eMs: 1_000, invoices: [], calls: [] }])),
    stopped: undefined,
    computed: 0,
    key: 'k',
    promptHash: 'p',
  }) as Run;
// report() on such a run in a temp folder that holds an older README table: its exit code and the files it left there.
async function reportIn(run: Run) {
  const dir = await mkdtemp(join(tmpdir(), 'freightaudit-report-'));
  const root = pathToFileURL(`${dir}/`);
  const log = console.log;
  const read = (path: string) => readFile(new URL(path, root), 'utf8').catch(() => undefined);
  try {
    await mkdir(new URL('evals/reports/', root), { recursive: true });
    await mkdir(new URL('apps/web/lib/', root), { recursive: true });
    await writeFile(new URL('README.md', root), OLDER_README);
    console.log = () => {};
    const code = await report({ subset: 'full', runs: [run], durationMs: 1, setFloors: false, root });
    console.log = log;
    const files = await readdir(new URL('evals/reports/', root));
    const reports = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await read(`evals/reports/${file}`)] as const)));
    return { code, readme: await read('README.md'), landing: await read('apps/web/lib/eval-results.json'), reports };
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
}

// The landing page's results are built from the report the README names, so that report must be on disk first.
test('a full run of the default set writes its report, then the README table and the landing results that name it', async () => {
  const golden = await goldenCase('g2-001');
  const { code, readme, landing, reports } = await reportIn(fullRun([golden], [golden]));
  expect(code).toBe(0);
  const name = namedReport(readme!);
  const written = JSON.parse(reports[`${name}.json`]!);
  // The name carries the date report() took, so the test never reads a clock of its own that 00:00 UTC could move.
  expect(name).toBe(`${written.date}-v2`);
  expect(JSON.parse(landing!)).toEqual(landingResults(written, name));
});

test('a full run that left a case unread, as --cached does on a partial cache, writes its report but not the README table or the landing results', async () => {
  const [read, unread] = await Promise.all([goldenCase('g2-001'), goldenCase('g2-002')]);
  const { code, readme, landing, reports } = await reportIn(fullRun([read, unread], [read]));
  expect(code).toBe(0);
  const json = Object.entries(reports).find(([file]) => file.endsWith('.json'))![1]!;
  expect([Object.keys(reports).length, JSON.parse(json).cases]).toEqual([2, 1]);
  expect([readme, landing]).toEqual([OLDER_README, undefined]);
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
