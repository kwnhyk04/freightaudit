import { readFileSync } from 'node:fs';
import { landingResults, namedReport } from './landing.ts';

// The landing page's results table (apps/web/lib/eval-results.json) is the official report's, the one the README's eval
// table names, so the page never shows a number the report does not hold.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test("the landing page's results are what landing.ts builds from the report the README names", () => {
  const name = namedReport(read('README.md'));
  expect(name).toBe('2026-10-27-v2');
  expect(JSON.parse(read('apps/web/lib/eval-results.json'))).toEqual(landingResults(JSON.parse(read(`evals/reports/${name}.json`)), name));
});

test('each row reads as the README does, a pair of metrics in one row, met only when both are', () => {
  const { report, date, cases, rows } = landingResults(JSON.parse(read('evals/reports/2026-10-15.json')), '2026-10-15');
  expect({ report, date, cases }).toEqual({ report: 'evals/reports/2026-10-15.md', date: '2026-10-15', cases: 90 });
  expect(rows).toEqual([
    { label: 'Header field accuracy (digital)', target: '98%', result: '99.5%', met: true },
    { label: 'Header field accuracy (scanned)', target: '93%', result: '100%', met: true },
    { label: 'Line-item F1 (scanned)', target: '0.88', result: '0.985', met: true },
    { label: 'Overcharge recall', target: '90%', result: '100%', met: true },
    { label: 'Overcharge precision', target: '95%', result: '94.4%', met: false },
    { label: 'False flag rate', target: '≤ 3%', result: '0.7%', met: true },
    { label: 'Extraction latency p50 / p95 (3 pages or fewer)', target: '≤ 5 s / 12 s', result: '2.3 s / 4.7 s', met: true },
    { label: 'Cost per invoice, paid-equivalent (digital / scanned)', target: '≤ $0.02 / $0.05', result: '$0.0005 / $0.0015', met: true },
  ]);
  // A metric the report lacks shows as n/a and is not met.
  const late = { date: '2026-11-01', cases: 90, metrics: [{ metric: 'extraction_latency_p50_ms', value: 2_000 }, { metric: 'extraction_latency_p95_ms', value: 12_500 }] };
  const rowsOf = landingResults(late, '2026-11-01').rows;
  expect(rowsOf.find((row) => row.label.startsWith('Extraction latency'))).toMatchObject({ result: '2 s / 12.5 s', met: false });
  expect(rowsOf[0]).toMatchObject({ result: 'n/a', met: false });
});
