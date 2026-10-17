import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { setEnvValue } from './env-file.ts';
import { SAMPLES } from './samples.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('setEnvValue replaces or appends a single-quoted value that parseEnv reads back exactly, $ included', () => {
  const hash = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$Ab+/cd';
  const replaced = setEnvValue('A=1\r\nDEMO_PASSWORD_HASH=old\r\nB=2\r\n', 'DEMO_PASSWORD_HASH', hash);
  expect(replaced).toBe(`A=1\r\nDEMO_PASSWORD_HASH='${hash}'\r\nB=2\r\n`);
  expect(parseEnv(replaced)).toEqual({ A: '1', DEMO_PASSWORD_HASH: hash, B: '2' });
  expect(setEnvValue('A=1', 'K', 'v')).toBe("A=1\nK='v'\n");
  expect(setEnvValue('', 'K', 'v')).toBe("K='v'\n");
  expect(() => setEnvValue('', 'K', "it's")).toThrow('quote');
});

test('each upload-page sample is a golden-set PDF that db:reset-demo does not load', () => {
  const manifest = JSON.parse(read('../../../evals/golden/v1/manifest.json').toString()) as { cases: { sha256: string }[] };
  const golden = new Set(manifest.cases.map(({ sha256 }) => sha256));
  const loaded = readdirSync(new URL('../public/demo/', import.meta.url)).filter((file) => file.endsWith('.pdf'));
  const reset = new Set(loaded.map((file) => sha256(read(`../public/demo/${file}`))));
  expect(reset.size).toBeGreaterThan(0);
  for (const { file } of SAMPLES) {
    const digest = sha256(read(`../public/samples/${file}`));
    expect(golden.has(digest)).toBe(true);
    expect(reset.has(digest)).toBe(false);
  }
});
