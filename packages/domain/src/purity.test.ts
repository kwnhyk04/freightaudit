import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

// Lints probe code through this package's real eslint.config.js.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function ruleIds(code: string) {
  const [result] = await eslint.lintText(code, { filePath: 'src/probe.ts' });
  return result?.messages.map((m) => m.ruleId);
}

test('rejects I/O and package imports', async () => {
  expect(await ruleIds("import { readFile } from 'node:fs/promises';\nexport { readFile };\n")).toContain('no-restricted-imports');
  expect(await ruleIds("export { Pool } from 'pg';\n")).toContain('no-restricted-imports');
  expect(await ruleIds("export { z } from 'a/b';")).toContain('no-restricted-imports');
  expect(await ruleIds("export const load = () => import('./money.ts');\n")).toContain('no-restricted-syntax');
});

test('allows relative imports', async () => {
  expect(await ruleIds("import { add } from './money.ts';\nexport { add };\n")).toEqual([]);
});
