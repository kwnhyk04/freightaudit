import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regenerates code and fails when a committed generated file was stale or missing.
const dir = new URL('../src/generated', import.meta.url);

function snapshot() {
  if (!existsSync(dir)) return new Map<string, string>();
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return new Map(
    files.map((entry): [string, string] => {
      const path = join(entry.parentPath, entry.name);
      return [path, readFileSync(path, 'utf8')];
    }),
  );
}

const before = snapshot();
execSync('pnpm run codegen', { stdio: 'inherit' });
const after = snapshot();
const stale = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));

if (stale.length > 0) {
  console.error('Generated files were stale. They are regenerated now; commit them:');
  for (const path of stale) console.error('  ' + path);
  process.exit(1);
}
console.log('Generated files are up to date.');
