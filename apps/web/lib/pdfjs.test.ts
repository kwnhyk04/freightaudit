import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// pdf.js 6.4.299 has no isEvalSupported option, so these guards stand in for it: the version is pinned exactly, the
// builds the app loads hold no eval and no Function constructor beyond core-js's fixed global fallback, and nothing
// loads the scripting sandbox (whose build holds one eval) or turns scripting on.
const PIN = '6.4.299';
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjs = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

test('pdfjs-dist is pinned to exactly the version installed', () => {
  const pinned = (JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies['pdfjs-dist'];
  expect(pinned).toBe(PIN);
  expect((JSON.parse(readFileSync(join(pdfjs, 'package.json'), 'utf8')) as { version: string }).version).toBe(PIN);
});

// The app loads the legacy builds, which also run where Map.prototype.getOrInsertComputed and Math.sumPrecise are
// missing. They carry core-js, whose lookup of the global object ends in Function("return this")() only after
// globalThis, which every browser that runs modules has; no other call of the Function constructor may appear.
test.each(['legacy/build/pdf.mjs', 'legacy/build/pdf.min.mjs', 'legacy/build/pdf.worker.min.mjs'])("%s holds no eval( and no Function constructor but core-js's global fallback", (file) => {
  const code = readFileSync(join(pdfjs, file), 'utf8');
  expect(code.includes('eval(')).toBe(false);
  expect(code.match(/(?<![\w$.])Function\s*\((?!\s*["']return this["']\s*\))/g)).toBeNull();
});

test('no app file imports the scripting sandbox or the viewer, or turns scripting on', () => {
  const files = ['app', 'components', 'lib'].flatMap((folder) =>
    readdirSync(join(web, folder), { recursive: true, encoding: 'utf8' })
      .filter((file) => /[.]tsx?$/.test(file) && !file.endsWith('pdfjs.test.ts'))
      .map((file) => join(folder, file)),
  );
  expect(files.length).toBeGreaterThan(10);
  const offenders = files.filter((file) => /pdf[.]sandbox|pdfjs-dist\/web|enableScripting/.test(readFileSync(join(web, file), 'utf8')));
  expect(offenders).toEqual([]);
});
