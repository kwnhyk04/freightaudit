// Preloaded (node --import) into a run of scripts/demo.ts by demo.int.test.ts: Docker and the public URL are faked, so
// a reset runs end to end on any machine and touches none of its containers or volumes. Every docker call is appended
// to FAKE_DOCKER_LOG as a JSON line. The stores answer the reads demo.ts sends: Redis's total FAKE_REDIS_SPENT (unset:
// none), Claude's calls in Postgres FAKE_CLAUDE_CALLS, and the total an earlier reset carried over FAKE_CLAUDE_CARRIED
// (unset: a database from before migration 0018, without its table).
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';

const { FAKE_DOCKER_LOG, FAKE_REDIS_SPENT = '', FAKE_CLAUDE_CALLS = '0', FAKE_CLAUDE_CARRIED } = process.env;

function answer(args: string[]) {
  appendFileSync(FAKE_DOCKER_LOG!, `${JSON.stringify(args)}\n`);
  const command = args.join(' ');
  if (command.includes('redis-cli') && args.includes('GET')) return FAKE_REDIS_SPENT;
  if (command.includes('to_regclass')) return FAKE_CLAUDE_CARRIED === undefined ? 'f' : 't';
  if (command.includes('INSERT INTO')) return 'INSERT 0 1';
  if (command.includes('FROM claude_spend_carryover')) return FAKE_CLAUDE_CARRIED ?? '';
  if (command.includes('FROM llm_calls')) return FAKE_CLAUDE_CALLS;
  if (command.includes('ps -q --status running postgres')) return 'c0ffee';
  if (command.includes('volume ls')) return 'freightaudit-prod-tailscale-state';
  if (command.includes('status --json')) return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'demo.example.ts.net.' } });
  return '';
}

childProcess.spawnSync = ((_: string, args: string[]) => ({ status: 0, stdout: `${answer(args)}\n` })) as unknown as typeof childProcess.spawnSync;
// pg_dump's stream for the backup.
childProcess.spawn = ((_: string, args: string[]) => {
  answer(args);
  const child = Object.assign(new EventEmitter(), { stdout: Readable.from(['PGDMP']) });
  child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
  return child;
}) as unknown as typeof childProcess.spawn;
syncBuiltinESMExports();

// The public URL: healthy, refusing a request without a key, and taking the sample batch.
globalThis.fetch = (async (url: string | URL) => {
  const { pathname } = new URL(url);
  if (pathname === '/v1/invoices') return new Response(null, { status: 401 });
  if (pathname === '/v1/invoice-batches') return Response.json({ results: [{ index: 0, status: 'accepted' }] }, { status: 202 });
  return new Response('ok');
}) as typeof fetch;
