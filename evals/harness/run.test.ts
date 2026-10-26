import { rm } from 'node:fs/promises';
import { checkRepeat, evaluate, mergeReads, type Roles } from './run.ts';

const role = (provider: 'gemini' | 'groq', model: string) => ({ provider, model, baseUrl: 'http://127.0.0.1:9', apiKey: 'test-key', rpm: 1, tpm: 1 });
// Pins no real run uses, so the cache folders this test makes are its own.
const roles: Roles = { primary: role('gemini', 'run-test-primary'), text: role('groq', 'run-test-text'), fallback: role('groq', 'run-test-fallback') };
const never = () => Promise.reject(new Error('a cached-only run starts no environment'));

test('a v2 run reads golden/v2 and keys its cache apart from v1 and from its other reads, starting nothing when only the cache is read', async () => {
  const runs = [];
  try {
    const base = { set: 'golden' as const, subset: 'dev' as const, label: 'test', roles, cachedOnly: true, environment: never };
    const v2 = await evaluate({ ...base, version: 'v2' });
    runs.push(v2);
    expect(v2.version).toBe('v2');
    expect(v2.cases.length).toBeGreaterThan(0);
    expect(v2.cases.every((golden) => golden.id.startsWith('g2-') && golden.split === 'dev')).toBe(true);
    const v1 = await evaluate(base);
    runs.push(v1);
    expect(v1.cases[0]!.id).toBe('g001');
    expect(v2.key).not.toBe(v1.key);
    // The first read keeps the plain key, so it reuses a run's cache; each later read has its own.
    const second = await evaluate({ ...base, version: 'v2', repeat: 2 });
    runs.push(second);
    expect(second.key).not.toBe(v2.key);
    expect((await evaluate({ ...base, version: 'v2', repeat: 1 })).key).toBe(v2.key);
  } finally {
    for (const run of runs) await rm(new URL(`../.cache/golden-${run.version}/${run.key}/`, import.meta.url), { recursive: true, force: true });
  }
});

test('--repeat reads the dev split only and never sets floors', () => {
  expect(() => checkRepeat({ repeat: 3, subset: 'dev', setFloors: false })).not.toThrow();
  expect(() => checkRepeat({ repeat: 1, subset: 'full', setFloors: true })).not.toThrow();
  expect(() => checkRepeat({ repeat: 3, subset: 'test', setFloors: false })).toThrow(/dev/);
  expect(() => checkRepeat({ repeat: 3, subset: 'dev', setFloors: true })).toThrow(/floors/);
  expect(() => checkRepeat({ repeat: 0, subset: 'dev', setFloors: false })).toThrow(/whole number/);
});

test('repeated reads merge into one run, each later read under its case id with #2, #3', () => {
  const golden = { id: 'g2-001', kind: 'clean' };
  const read = (n: number) => ({
    label: 'test',
    version: 'v2',
    roles,
    cases: [golden],
    results: new Map([['g2-001', { id: 'g2-001', status: 'reconciled', error: null, e2eMs: n, invoices: [], calls: [] }]]),
    stopped: undefined,
    computed: 1,
    key: `k${n}`,
    promptHash: 'p',
  });
  const merged = mergeReads([read(1), read(2), read(3)] as unknown as Parameters<typeof mergeReads>[0]);
  expect(merged.cases.map((each) => each.id)).toEqual(['g2-001', 'g2-001#2', 'g2-001#3']);
  expect([...merged.results.keys()]).toEqual(['g2-001', 'g2-001#2', 'g2-001#3']);
  expect(merged.results.get('g2-001#3')).toMatchObject({ id: 'g2-001#3', e2eMs: 3 });
  expect(merged).toMatchObject({ computed: 3, key: 'k1', repeat: 3 });
});
