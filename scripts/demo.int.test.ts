import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// pnpm db:reset-demo for real, from a copy of scripts/demo.ts in an empty folder (so no .env.prod or backup of this
// machine is touched), against the faked Docker and public URL of demo-fakes.ts. Returns each docker call in order,
// without the compose prefix.
async function reset(stores: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'freightaudit-demo-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'apps/web/public/demo'), { recursive: true });
    copyFileSync(new URL('demo.ts', import.meta.url), join(root, 'scripts/demo.ts'));
    writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(join(root, '.env.prod'), 'API_KEYS=k\n');
    writeFileSync(join(root, 'apps/web/public/demo/a.pdf'), '%PDF-1.7\n');
    const log = join(root, 'docker.log');
    const child = spawn(process.execPath, ['--import', new URL('demo-fakes.ts', import.meta.url).href, join(root, 'scripts/demo.ts'), 'reset'], {
      env: { ...process.env, FAKE_DOCKER_LOG: log, ...stores },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const [code] = await once(child, 'close');
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
      .map((args) => (args[0] === 'compose' ? args.slice(7) : args).join(' '));
    return { code, output, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const carries = (call: string) => call.includes('INSERT INTO claude_spend_carryover') || (call.includes('redis-cli') && call.includes(' SET '));

test("a demo reset carries Claude's total over the wipe: the larger of Redis's and Postgres's, read once nothing bills, written back before the worker starts", async () => {
  // Redis holds more than Postgres recorded (1,200,000 in calls and 300,000 an earlier reset carried): calls in flight.
  const { code, output, calls } = await reset({ FAKE_REDIS_SPENT: '2500000', FAKE_CLAUDE_CALLS: '1200000', FAKE_CLAUDE_CARRIED: '300000' });
  expect([code, output]).toEqual([0, expect.stringContaining('1 sample invoices sent')]);
  expect(calls.filter(carries)).toEqual([expect.stringMatching(/VALUES \(2500000\)/), expect.stringMatching(/ SET freightaudit:llm:claude:spent 2500000$/)]);

  const at = (pattern: RegExp) => {
    const index = calls.findIndex((call) => pattern.test(call));
    expect([pattern, index]).not.toEqual([pattern, -1]);
    return index;
  };
  // Read after the api and worker stop, so no call bills after it, and before the volumes go.
  const reads = [at(/redis-cli .*GET freightaudit:llm:claude:spent/), at(/FROM llm_calls/), at(/FROM claude_spend_carryover/)];
  expect(Math.min(...reads)).toBeGreaterThan(at(/^stop api worker$/));
  expect(Math.max(...reads)).toBeLessThan(at(/^volume rm --force freightaudit-prod_postgres-data/));
  // Written into the migrated empty database and Redis before the worker starts, which seeds its total from them.
  expect(at(/INSERT INTO claude_spend_carryover/)).toBeGreaterThan(at(/^run --rm migrate$/));
  expect(at(/redis-cli SET /)).toBeLessThan(at(/^up -d --wait api worker tailscale$/));
});

// A queue left in the volume would keep a finished job's id, which is the content hash, so the sample's new upload would
// never run.
test('a demo reset empties the queues: the Redis volume goes with the database and the stored PDFs', async () => {
  const { code, calls } = await reset({ FAKE_CLAUDE_CALLS: '0' });
  expect(code).toBe(0);
  expect(calls).toContain('volume rm --force freightaudit-prod_postgres-data freightaudit-prod_minio-data freightaudit-prod_redis-data');
});

test('Postgres decides when it recorded more, as when Redis lost its total, and a database from before migration 0018 carries its calls alone', async () => {
  const { code, calls } = await reset({ FAKE_CLAUDE_CALLS: '1200000' });
  expect(code).toBe(0);
  expect(calls.filter(carries)).toEqual([expect.stringMatching(/VALUES \(1200000\)/), expect.stringMatching(/ SET freightaudit:llm:claude:spent 1200000$/)]);
  expect(calls.filter((call) => call.includes('FROM claude_spend_carryover'))).toEqual([]);
});
