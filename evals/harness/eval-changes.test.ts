import { CHARGE_CODES } from '@freightaudit/db';
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT } from '@freightaudit/llm';
import { readFileSync } from 'node:fs';

// CI's eval-changes job runs the eval smoke only when a pull request changes what it measures. The extraction prompt and
// schema, the key the eval caches its results under, live in packages/llm/src/extract.ts and carry every charge code of
// packages/db/src/reference.ts.
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const paths = /git diff --name-only HEAD\^1 HEAD -- ([^)\n]+)\)/.exec(ci)![1]!.trim().split(/\s+/);
// A git pathspec without wildcards matches its own path and everything under it.
const runs = (file: string) => paths.some((path) => file === path || file.startsWith(`${path}/`));

test('a change to the extraction prompt or schema, the charge codes they carry included, runs the eval smoke', () => {
  const schema = JSON.stringify(EXTRACTION_JSON_SCHEMA);
  for (const code of Object.keys(CHARGE_CODES)) expect([code, EXTRACTION_PROMPT.includes(code), schema.includes(`"${code}"`)]).toEqual([code, true, true]);
  expect(['packages/llm/src/extract.ts', 'packages/db/src/reference.ts'].filter((file) => !runs(file))).toEqual([]);
});
