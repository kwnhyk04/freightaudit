import { readFileSync } from 'node:fs';
import { landingResults, namedReports } from './landing.ts';
import { officialReports } from './report.ts';

// The landing page's results table (apps/web/lib/eval-results.json) holds the latest official report of each run, the two
// the README's eval table names, so the page never shows a number a report does not hold.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test("the landing page's results are landing.ts's from the latest official report of each run, the two the README names", async () => {
  const officials = await officialReports(root);
  expect(officials.free?.name).toBe('2026-10-27-v2');
  expect(officials.claudeFirst?.name).toMatch(/^\d{4}-\d{2}-\d{2}-v2-full-claude-first$/);
  expect(namedReports(read('README.md'))).toEqual([officials.claudeFirst!.name, officials.free!.name]);
  expect(JSON.parse(read('apps/web/lib/eval-results.json'))).toEqual(landingResults(officials));
});

test('each row reads as the README does, a pair of metrics in one row, met only when both are, and a run not measured has no cells', () => {
  const free = { name: '2026-10-15', json: JSON.parse(read('evals/reports/2026-10-15.json')) };
  const { cases, claudeFirst, free: run, rows } = landingResults({ free });
  expect({ cases, claudeFirst, run }).toEqual({ cases: 90, claudeFirst: null, run: { report: 'evals/reports/2026-10-15.md', date: '2026-10-15' } });
  expect(rows.map(({ label, target, free: cell, claudeFirst: none }) => ({ label, target, ...cell, none }))).toEqual([
    { label: 'Header field accuracy (digital)', target: '98%', result: '99.5%', met: true, none: null },
    { label: 'Header field accuracy (scanned)', target: '93%', result: '100%', met: true, none: null },
    { label: 'Line-item F1 (scanned)', target: '0.88', result: '0.985', met: true, none: null },
    { label: 'Overcharge recall', target: '90%', result: '100%', met: true, none: null },
    { label: 'Overcharge precision', target: '95%', result: '94.4%', met: false, none: null },
    { label: 'False flag rate', target: '≤ 3%', result: '0.7%', met: true, none: null },
    { label: 'Extraction latency p50 / p95 (3 pages or fewer)', target: '≤ 5 s / 12 s', result: '2.3 s / 4.7 s', met: true, none: null },
    { label: 'Cost per invoice, paid-equivalent (digital / scanned)', target: '≤ $0.02 / $0.05', result: '$0.0005 / $0.0015', met: true, none: null },
  ]);
  // A metric a report lacks shows as n/a and is not met.
  const late = { name: '2026-11-01-v2-full-claude-first', json: { date: '2026-11-01', cases: 90, metrics: [{ metric: 'extraction_latency_p50_ms', value: 2_000 }, { metric: 'extraction_latency_p95_ms', value: 12_500 }] } };
  const rowsOf = landingResults({ claudeFirst: late }).rows;
  expect(rowsOf.find((row) => row.label.startsWith('Extraction latency'))!.claudeFirst).toEqual({ result: '2 s / 12.5 s', met: false });
  expect(rowsOf[0]!.claudeFirst).toEqual({ result: 'n/a', met: false });
  expect(rowsOf[0]!.free).toBeNull();
});
