import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fails on breaking changes in openapi.yaml compared to the base branch, using oasdiff in Docker.
const ref = process.env.OASDIFF_BASE_REF ?? 'origin/main';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const attempt = (run: () => string) => {
  try {
    return run();
  } catch {
    return undefined;
  }
};

if (attempt(() => git('rev-parse', '--is-inside-work-tree')) === undefined) {
  console.log('contracts:breaking skipped: not a git repository.');
  process.exit(0);
}
if (attempt(() => git('rev-parse', '--verify', '--quiet', ref + '^{commit}')) === undefined) {
  console.error('contracts:breaking failed: base ref ' + ref + ' not found. Fetch it first, for example git fetch origin main.');
  process.exit(1);
}
const base = attempt(() => git('show', ref + ':packages/contracts/openapi.yaml'));
if (base === undefined) {
  console.log('contracts:breaking skipped: ' + ref + ' has no packages/contracts/openapi.yaml yet.');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'oasdiff-'));
writeFileSync(join(dir, 'base.yaml'), base);
copyFileSync(new URL('../openapi.yaml', import.meta.url), join(dir, 'head.yaml'));
const oasdiff = spawnSync(
  'docker',
  ['run', '--rm', '-v', dir + ':/specs:ro', 'tufin/oasdiff:v1.33.0', 'breaking', '/specs/base.yaml', '/specs/head.yaml', '--fail-on', 'ERR'],
  { stdio: 'inherit' },
);
rmSync(dir, { recursive: true, force: true });
if (oasdiff.error) console.error('contracts:breaking failed: ' + oasdiff.error.message);
process.exit(oasdiff.status ?? 1);
