import { statSync } from 'node:fs';
import { ENGINEERING, REPOSITORY, sourceLink } from './engineering.ts';
import evidence from './evidence.json';

const root = new URL('../../../', import.meta.url);

test('every engineering link names a file or folder that exists, on main', () => {
  for (const path of ENGINEERING.flatMap((each) => each.paths)) {
    const stat = statSync(new URL(path, root));
    expect([path, stat.isDirectory()]).toEqual([path, path.endsWith('/')]);
    expect(sourceLink(path)).toBe(`${REPOSITORY}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}`);
  }
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
