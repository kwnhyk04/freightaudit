import { readFileSync, statSync } from 'node:fs';
import { ENGINEERING, MASKED_LOG, RATE_CHECK, REPOSITORY, sourceLink } from './engineering.ts';
import evidence from './evidence.json';

const root = new URL('../../../', import.meta.url);

test('every engineering link names a file or folder that exists, on main', () => {
  for (const path of ENGINEERING.flatMap((each) => each.paths)) {
    const stat = statSync(new URL(path, root));
    expect([path, stat.isDirectory()]).toEqual([path, path.endsWith('/')]);
    expect(sourceLink(path)).toBe(`${REPOSITORY}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}`);
  }
});

test("the Features code window shows the rate-card check's lines as they stand in the file, at their line numbers", () => {
  const source = readFileSync(new URL(RATE_CHECK.path, root), 'utf8').split(/\r?\n/);
  expect(source.slice(RATE_CHECK.first - 1, RATE_CHECK.first - 1 + RATE_CHECK.lines.length)).toEqual(RATE_CHECK.lines);
});

test('every field the Features log line masks is one the services redact, written as pino writes it', () => {
  const telemetry = readFileSync(new URL('packages/telemetry/src/index.ts', root), 'utf8');
  for (const { path } of MASKED_LOG.masked) expect(telemetry).toContain(`'${path}'`);
});

test('the proofs show the figures lib/evidence.json holds', () => {
  const text = ENGINEERING.map((each) => each.proof).join(' ');
  const count = new Intl.NumberFormat('en-US');
  const { load, evals, propertyTests } = evidence;
  for (const figure of [
    `${count.format(load.accepted)} accepted`,
    `${load.lost} lost`,
    `p95 ${load.uploadP95Ms} ms`,
    `${evals.ci} of the ${evals.cases}`,
    `${count.format(propertyTests.runs)} cases each`,
  ]) {
    expect(text).toContain(figure);
  }
});
