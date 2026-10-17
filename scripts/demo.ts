// The public demo's backend on this PC: compose project freightaudit-prod with the settings in .env.prod
// (docs/deploy.md). pnpm demo:init | demo:up | demo:down | db:backup | db:reset-demo. Prints no secret.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const envPath = join(cwd, '.env.prod');
const COMPOSE = ['compose', '--env-file', '.env.prod', '-f', 'infra/docker-compose.yml', '-f', 'infra/docker-compose.prod.yml'];
// The node's login lives here; resets never touch it.
const STATE_VOLUME = 'freightaudit-prod-tailscale-state';
const DATA_VOLUMES = ['freightaudit-prod_postgres-data', 'freightaudit-prod_minio-data'];

function docker(args: string[], capture = false) {
  const result = spawnSync('docker', args, { cwd, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`docker ${args.slice(args[0] === 'compose' ? 7 : 0).join(' ')} failed`);
  return result.stdout ?? '';
}
const compose = (...args: string[]) => docker([...COMPOSE, ...args]);
const settings = () => parseEnv(readFileSync(envPath, 'utf8'));

// .env.prod from the example, with random secrets; the provider keys and the Tailscale key are left for the user.
function init() {
  if (existsSync(envPath)) throw new Error('.env.prod exists already; edit it by hand (docs/deploy.md)');
  const example = readFileSync(join(cwd, '.env.prod.example'), 'utf8');
  const filled = example.replace(/^(API_KEYS|POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD)=$/gm, (_, key: string) => `${key}=${randomBytes(32).toString('hex')}`);
  writeFileSync(envPath, filled, { mode: 0o600 });
  console.log('Wrote .env.prod with random API_KEYS, POSTGRES_PASSWORD and MINIO_ROOT_PASSWORD.');
  console.log('Now set GEMINI_API_KEY, GROQ_API_KEY and TS_AUTHKEY in it with an editor, then run pnpm demo:up.');
}

// The public URL, from the tailscale container's own status.
function funnelUrl() {
  const status = JSON.parse(docker([...COMPOSE, 'exec', '-T', 'tailscale', 'tailscale', '--socket=/tmp/tailscaled.sock', 'status', '--json'], true)) as {
    BackendState?: string;
    Self?: { DNSName?: string };
  };
  const name = status.Self?.DNSName?.replace(/[.]$/, '');
  if (status.BackendState !== 'Running' || !name) throw new Error('the tailscale container is not logged in; set TS_AUTHKEY in .env.prod for its first start');
  return `https://${name}`;
}

// A new Funnel name can take up to 10 minutes to resolve publicly, and its first request issues the certificate.
async function smoke(url: string) {
  console.log(`Waiting for ${url}/healthz to answer from the internet.`);
  const deadline = Date.now() + 10 * 60_000;
  while (!(await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false))) {
    if (Date.now() > deadline) throw new Error(`${url}/healthz did not answer within 10 minutes`);
    await sleep(15_000);
  }
  const anonymous = await fetch(`${url}/v1/invoices`, { signal: AbortSignal.timeout(10_000) });
  if (anonymous.status !== 401) throw new Error(`${url}/v1/invoices without a key answered ${anonymous.status}, not 401`);
  console.log(`Live at ${url}: /healthz answers and a request without X-API-Key gets 401. This is the web's API_URL.`);
}

async function up() {
  if (!existsSync(envPath)) throw new Error('.env.prod is missing; run pnpm demo:init first');
  if (!docker(['volume', 'ls', '-q', '--filter', `name=^${STATE_VOLUME}$`], true).trim()) docker(['volume', 'create', STATE_VOLUME]);
  compose('pull', 'api', 'worker', 'egress-proxy', 'tailscale');
  compose('up', '-d', '--wait', 'postgres', 'redis', 'minio');
  compose('run', '--rm', 'migrate');
  compose('up', '-d', '--wait', 'api', 'worker', 'tailscale');
  const url = funnelUrl();
  if (settings().TS_AUTHKEY) console.log('The node is logged in: delete TS_AUTHKEY from .env.prod.');
  await smoke(url);
  return url;
}

function down() {
  // Containers and networks go; volumes stay, so the data and the node's login survive.
  compose('down');
}

async function backup() {
  if (!docker([...COMPOSE, 'ps', '-q', '--status', 'running', 'postgres'], true).trim()) {
    console.log('Postgres is not running, so there is nothing to back up.');
    return;
  }
  mkdirSync(join(cwd, 'backups'), { recursive: true });
  const path = join(cwd, 'backups', `freightaudit-${new Date().toISOString().replace(/[-:]|[.]\d{3}/g, '')}.dump`);
  const dump = spawn('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'freightaudit', '-d', 'freightaudit', '-Fc'], {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [[code]] = await Promise.all([once(dump, 'close') as Promise<[number | null]>, pipeline(dump.stdout, createWriteStream(path))]);
  if (code !== 0) {
    rmSync(path, { force: true });
    throw new Error('pg_dump failed; no backup was written');
  }
  console.log(`Backup: ${path} (${statSync(path).size} bytes). Restore with pg_restore, as docs/deploy.md shows.`);
}

// Sends the public sample's PDFs (golden-set invoices) through the live pipeline in one batch.
async function reload(url: string) {
  const key = settings().API_KEYS?.split(',')[0]?.trim();
  if (!key) throw new Error('API_KEYS is empty in .env.prod');
  const dir = join(cwd, 'apps/web/public/demo');
  const names = readdirSync(dir).filter((name) => name.endsWith('.pdf'));
  const body = new FormData();
  for (const name of names) body.append('files', new Blob([readFileSync(join(dir, name))], { type: 'application/pdf' }), name);
  const response = await fetch(`${url}/v1/invoice-batches`, { method: 'POST', headers: { 'x-api-key': key }, body, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`the sample upload answered ${response.status}`);
  const { results } = (await response.json()) as { results: { index: number; status: string; error?: { detail?: string } }[] };
  for (const { index, status, error } of results) console.log(`${names[index]}: ${status}${error?.detail ? ` (${error.detail})` : ''}`);
  console.log(`${names.length} sample invoices sent; the worker reads them over the next few minutes.`);
}

// Backs up, then empties the demo's data (database, queues, stored PDFs), reseeds it and loads the sample again.
async function reset() {
  await backup();
  compose('rm', '--stop', '--force', '-v', 'api', 'worker', 'postgres', 'redis', 'minio');
  docker(['volume', 'rm', '--force', ...DATA_VOLUMES]);
  await reload(await up());
}

const commands: Record<string, () => unknown> = { init, up, down, backup, reset };
const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error('usage: node scripts/demo.ts init|up|down|backup|reset');
  process.exit(2);
}
try {
  await command();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
