import { settings } from '@freightaudit/config/env';
import { readdirSync, readFileSync } from 'node:fs';
import { reportName } from './report.ts';
import { claudeFirst, configOf, configuredRoles, evalRoles } from './run.ts';

// CI never calls Claude: no workflow or action names its key, provider or setting, every eval there runs the free models
// alone, turbo hands no task an Anthropic or LLM_ variable, and the defaults keep every role on the free models. GitHub
// holds no Anthropic secret.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const CLAUDE = /anthropic|claude/i;
const WORKFLOWS = readdirSync(new URL('.github/workflows/', root)).map((name) => `.github/workflows/${name}`);

test('no workflow or action could select Claude', () => {
  const files = [...WORKFLOWS, ...readdirSync(new URL('.github/actions/', root)).map((name) => `.github/actions/${name}/action.yml`)];
  expect(files.length).toBeGreaterThan(3);
  for (const file of files) expect({ file, matches: read(file).match(CLAUDE) }).toEqual({ file, matches: null });
});

test('every eval in a workflow runs the free models alone, as CI floors are set', () => {
  const evals = WORKFLOWS.flatMap((file) => read(file).split('\n').flatMap((line) => (/\bpnpm eval\b/.test(line) ? [{ file, line: line.trim() }] : [])));
  expect(evals.length).toBeGreaterThanOrEqual(2);
  for (const { file, line } of evals) expect({ file, line, free: /--config free\b/.test(line) }).toEqual({ file, line, free: true });
});

test('turbo passes no task an Anthropic or LLM_ setting, and passes CI to the eval, so its guard sees a CI run', () => {
  const turbo = JSON.parse(read('turbo.json')) as { globalEnv?: string[]; globalPassThroughEnv?: string[]; tasks: Record<string, { env?: string[]; passThroughEnv?: string[] }> };
  const names = [...(turbo.globalEnv ?? []), ...(turbo.globalPassThroughEnv ?? []), ...Object.values(turbo.tasks).flatMap((task) => [...(task.env ?? []), ...(task.passThroughEnv ?? [])])];
  expect(names.filter((name) => CLAUDE.test(name) || name.startsWith('LLM_'))).toEqual([]);
  expect(turbo.tasks.eval?.passThroughEnv).toContain('CI');
});

const FREE = { GEMINI_API_KEY: 'gemini-key', GROQ_API_KEY: 'groq-key' };
const CLAUDE_FIRST = { LLM_CLAUDE_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'anthropic-key', LLM_CLAUDE_FIRST_UNTIL: '2026-11-10', LLM_CLAUDE_SPEND_CAP_USD: '15.00' };

test('by default no role is on Claude and Claude is off; LLM_CLAUDE_MODEL needs its key, its end date and its spend cap, and no role may be Claude', () => {
  expect(settings.LLM_CLAUDE_MODEL.parse(undefined)).toBe('');
  for (const role of ['PRIMARY', 'TEXT', 'FALLBACK'] as const) expect(settings[`LLM_${role}_PROVIDER`].parse(undefined)).not.toBe('anthropic');
  expect(configuredRoles(FREE)).toMatchObject({ claude: undefined, claudeFirst: undefined, problems: [] });
  expect(configuredRoles({ ...FREE, LLM_CLAUDE_MODEL: 'claude-haiku-5-5' }).problems).toEqual([
    'LLM_CLAUDE_MODEL is set, which needs ANTHROPIC_API_KEY',
    'LLM_CLAUDE_MODEL is set, which needs LLM_CLAUDE_FIRST_UNTIL',
    'LLM_CLAUDE_MODEL is set, which needs LLM_CLAUDE_SPEND_CAP_USD',
  ]);
  expect(configuredRoles({ ...FREE, ...CLAUDE_FIRST })).toMatchObject({
    claude: { provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'anthropic-key', rpm: 50, tpm: 50_000 },
    claudeFirst: { until: '2026-11-10' },
    claudeSpendCap: '15.00',
    problems: [],
  });
  // Claude's gate, with its end date, caps and spend cap, is the only way to Claude.
  expect(configuredRoles({ ...FREE, LLM_PRIMARY_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'anthropic-key' }).problems).toEqual([
    'LLM_PRIMARY_PROVIDER cannot be anthropic: Claude reads first through LLM_CLAUDE_MODEL',
  ]);
});

test('Claude first needs a real end date and a spend cap in dollars and cents, and keeps its own daily budget', () => {
  expect(settings.LLM_CLAUDE_FIRST_UNTIL.parse(undefined)).toBe('');
  expect(settings.DAILY_CLAUDE_TOKEN_BUDGET.parse(undefined)).toBe(1_400_000);
  expect(() => settings.LLM_CLAUDE_FIRST_UNTIL.parse('next week')).toThrow();
  expect(() => settings.LLM_CLAUDE_FIRST_UNTIL.parse('2026-02-30')).toThrow();
  expect(settings.LLM_CLAUDE_SPEND_CAP_USD.parse(undefined)).toBe('');
  for (const cap of ['15', '15.00', '0.5', '120.25']) expect(settings.LLM_CLAUDE_SPEND_CAP_USD.parse(cap)).toBe(cap);
  for (const cap of ['15.001', '-1', '1e3', '$15', 'fifteen', '15,00']) expect(() => settings.LLM_CLAUDE_SPEND_CAP_USD.parse(cap)).toThrow();
  expect(configuredRoles({ ...FREE, LLM_CLAUDE_FIRST_UNTIL: '2026-11-10' }).problems).toEqual(['LLM_CLAUDE_FIRST_UNTIL is set, which needs LLM_CLAUDE_MODEL']);
});

test("on the demo only the worker gets Claude's settings, and squid lets only the worker reach api.anthropic.com", () => {
  // A Windows checkout may hold CRLF.
  const compose = read('infra/docker-compose.prod.yml').replaceAll('\r\n', '\n');
  // Each service's block: from its two-space name line to the next one.
  const services = Object.fromEntries(compose.split(/\n(?= {2}[a-z][a-z-]*:\n)/).map((block) => [block.match(/^ {2}([a-z][a-z-]*):/)?.[1] ?? '', block]));
  for (const name of ['ANTHROPIC_API_KEY', 'LLM_CLAUDE_MODEL', 'LLM_CLAUDE_FIRST_UNTIL', 'LLM_CLAUDE_SPEND_CAP_USD', 'DAILY_CLAUDE_TOKEN_BUDGET']) expect(services.worker).toContain(`${name}: \${${name}`);
  const others = Object.entries(services).filter(([name]) => name !== 'worker');
  expect(others.filter(([, block]) => /ANTHROPIC|LLM_CLAUDE|DAILY_CLAUDE/.test(block)).map(([name]) => name)).toEqual([]);
  const squid = read('infra/squid.conf');
  expect(squid).toMatch(/^acl worker_hosts dstdomain -n .*\bapi\.anthropic\.com\b/m);
  expect(squid).not.toMatch(/^acl tailscale_hosts .*anthropic/m);
});

test('an eval reads Claude first by default; the free models alone run with --config free, the only config that sets floors, and the comparison of free primaries', () => {
  expect(configOf({ subset: 'full', flag: undefined, setFloors: false })).toBe('claude-first');
  expect(configOf({ subset: 'dev', flag: 'claude-first', setFloors: false })).toBe('claude-first');
  expect(configOf({ subset: 'ci', flag: 'free', setFloors: true })).toBe('free');
  expect(configOf({ subset: 'compare', flag: undefined, setFloors: false })).toBe('free');
  expect(() => configOf({ subset: 'full', flag: undefined, setFloors: true })).toThrow(/--set-floors needs --config free/);
  expect(() => configOf({ subset: 'compare', flag: 'claude-first', setFloors: false })).toThrow(/--config free/);
  expect(() => configOf({ subset: 'full', flag: 'claude-primary', setFloors: false })).toThrow(/--config must be claude-first or free/);
});

test('the Claude-first eval runs only on this PC, with a key, pinned to Haiku; a local .env with part of the demo settings blocks no eval', () => {
  const local = { ANTHROPIC_API_KEY: 'anthropic-key' };
  expect(claudeFirst(local)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'anthropic-key' });
  expect(claudeFirst({ ...local, LLM_CLAUDE_MODEL: 'claude-sonnet-5-5' })).toMatchObject({ model: 'claude-haiku-5-5' });
  expect(() => claudeFirst({ ...local, CI: 'true' })).toThrow(/never in CI/);
  expect(() => claudeFirst({})).toThrow(/ANTHROPIC_API_KEY.*--config free/);
  // The demo's Claude settings never block an eval, which pins Claude itself; a role on Claude still does.
  expect(evalRoles({ ...FREE, LLM_CLAUDE_MODEL: 'claude-haiku-5-5' }).problems).toEqual([]);
  expect(evalRoles({ ...FREE, LLM_TEXT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).problems).toEqual(['LLM_TEXT_PROVIDER cannot be anthropic: Claude reads first through LLM_CLAUDE_MODEL']);
  // Claude-first reports say so in their names; the free models alone keep the names CI and the floors know.
  expect(reportName('full', '2026-10-31', 'claude-first', { version: 'v2' })).toBe('2026-10-31-v2-full-claude-first');
  expect(reportName('test', '2026-10-31', 'claude-first', { version: 'v2' })).toBe('2026-10-31-v2-test-claude-first');
  expect(reportName('full', '2026-10-31', 'free', { version: 'v2' })).toBe('2026-10-31-v2');
  expect(reportName('ci', '2026-10-31', 'free', { version: 'v2' })).toBe('2026-10-31-v2-ci');
});
