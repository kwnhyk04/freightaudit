import type { GoldenCase } from '../golden/build.ts';
import type { Score } from './metrics.ts';
import { byKindAndTrait, latestOfficial, readmeIntro, reportName, thresholdsFile, writesReadme } from './report.ts';

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
  expect(writesReadme({ subset: 'full', version: 'v1' })).toBe(true);
  expect(writesReadme({ subset: 'full', version: 'v2' })).toBe(false);
  expect(writesReadme({ subset: 'full', version: 'v1', config: 'claude-primary' })).toBe(false);
  expect(writesReadme({ subset: 'full', version: 'v1', stopped: 'g001: HTTP 429' })).toBe(false);
  expect(writesReadme({ subset: 'ci', version: 'v1' })).toBe(false);
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
