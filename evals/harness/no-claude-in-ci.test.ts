import { settings } from '@freightaudit/config/env';
import { readdirSync, readFileSync } from 'node:fs';
import { reportName } from './report.ts';
import { claudePrimary, configuredRoles } from './run.ts';

// CI never calls Claude: no workflow or action names its key, provider or setting, turbo hands no task an Anthropic or
// LLM_ variable, and the defaults keep every role and the backup on the free models. GitHub holds no Anthropic secret.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const CLAUDE = /anthropic|claude/i;

test('no workflow or action could select Claude', () => {
  const files = [
    ...readdirSync(new URL('.github/workflows/', root)).map((name) => `.github/workflows/${name}`),
    ...readdirSync(new URL('.github/actions/', root)).map((name) => `.github/actions/${name}/action.yml`),
  ];
  expect(files.length).toBeGreaterThan(3);
  for (const file of files) expect({ file, matches: read(file).match(CLAUDE) }).toEqual({ file, matches: null });
});

test('turbo passes no task an Anthropic or LLM_ setting, so a workflow env could not reach the eval', () => {
  const turbo = JSON.parse(read('turbo.json')) as { globalEnv?: string[]; globalPassThroughEnv?: string[]; tasks: Record<string, { env?: string[]; passThroughEnv?: string[] }> };
  const names = [...(turbo.globalEnv ?? []), ...(turbo.globalPassThroughEnv ?? []), ...Object.values(turbo.tasks).flatMap((task) => [...(task.env ?? []), ...(task.passThroughEnv ?? [])])];
  expect(names.filter((name) => CLAUDE.test(name) || name.startsWith('LLM_'))).toEqual([]);
});

test('by default no role is on Claude and the Claude backup is off; once LLM_CLAUDE_MODEL names a model it needs its key', () => {
  expect(settings.LLM_CLAUDE_MODEL.parse(undefined)).toBe('');
  for (const role of ['PRIMARY', 'TEXT', 'FALLBACK'] as const) expect(settings[`LLM_${role}_PROVIDER`].parse(undefined)).not.toBe('anthropic');
  const free = { GEMINI_API_KEY: 'gemini-key', GROQ_API_KEY: 'groq-key' };
  expect(configuredRoles(free)).toMatchObject({ claude: undefined, problems: [] });
  expect(configuredRoles({ ...free, LLM_CLAUDE_MODEL: 'claude-haiku-5-5' }).problems).toEqual(['LLM_CLAUDE_MODEL is set, which needs ANTHROPIC_API_KEY']);
  expect(configuredRoles({ ...free, LLM_CLAUDE_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'anthropic-key' })).toMatchObject({
    claude: { provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'anthropic-key', rpm: 50, tpm: 50_000 },
    problems: [],
  });
});

test('Claude first is off by default, needs a model, a key and a real date, and has its own daily budget', () => {
  expect(settings.LLM_CLAUDE_FIRST_UNTIL.parse(undefined)).toBe('');
  expect(settings.DAILY_CLAUDE_TOKEN_BUDGET.parse(undefined)).toBe(1_400_000);
  expect(() => settings.LLM_CLAUDE_FIRST_UNTIL.parse('next week')).toThrow();
  expect(() => settings.LLM_CLAUDE_FIRST_UNTIL.parse('2026-02-30')).toThrow();
  const free = { GEMINI_API_KEY: 'gemini-key', GROQ_API_KEY: 'groq-key' };
  expect(configuredRoles(free)).toMatchObject({ claudeFirst: undefined });
  expect(configuredRoles({ ...free, LLM_CLAUDE_FIRST_UNTIL: '2026-11-10' }).problems).toEqual(['LLM_CLAUDE_FIRST_UNTIL is set, which needs LLM_CLAUDE_MODEL']);
  expect(configuredRoles({ ...free, LLM_CLAUDE_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'anthropic-key', LLM_CLAUDE_FIRST_UNTIL: '2026-11-10' })).toMatchObject({
    claudeFirst: { until: '2026-11-10' },
    problems: [],
  });
});

test("on the demo only the worker gets Claude's settings, and squid lets only the worker reach api.anthropic.com", () => {
  // A Windows checkout may hold CRLF.
  const compose = read('infra/docker-compose.prod.yml').replaceAll('\r\n', '\n');
  // Each service's block: from its two-space name line to the next one.
  const services = Object.fromEntries(compose.split(/\n(?= {2}[a-z][a-z-]*:\n)/).map((block) => [block.match(/^ {2}([a-z][a-z-]*):/)?.[1] ?? '', block]));
  for (const name of ['ANTHROPIC_API_KEY', 'LLM_CLAUDE_MODEL', 'LLM_CLAUDE_FIRST_UNTIL', 'DAILY_CLAUDE_TOKEN_BUDGET']) expect(services.worker).toContain(`${name}: \${${name}`);
  const others = Object.entries(services).filter(([name]) => name !== 'worker');
  expect(others.filter(([, block]) => /ANTHROPIC|LLM_CLAUDE|DAILY_CLAUDE/.test(block)).map(([name]) => name)).toEqual([]);
  const squid = read('infra/squid.conf');
  expect(squid).toMatch(/^acl worker_hosts dstdomain -n .*\bapi\.anthropic\.com\b/m);
  expect(squid).not.toMatch(/^acl tailscale_hosts .*anthropic/m);
});

test('the claude-primary eval runs only on this PC: never in CI, never setting floors, never on the comparison set, and only with a key', () => {
  const local = { ANTHROPIC_API_KEY: 'anthropic-key' };
  expect(claudePrimary({ subset: 'test', setFloors: false }, local)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'anthropic-key' });
  expect(() => claudePrimary({ subset: 'test', setFloors: false }, { ...local, CI: 'true' })).toThrow(/never in CI/);
  expect(() => claudePrimary({ subset: 'full', setFloors: true }, local)).toThrow(/never sets floors/);
  expect(() => claudePrimary({ subset: 'compare', setFloors: false }, local)).toThrow(/golden set/);
  expect(() => claudePrimary({ subset: 'test', setFloors: false }, {})).toThrow(/ANTHROPIC_API_KEY/);
  expect(reportName('test', '2026-10-21', 'claude-primary')).toBe('2026-10-21-test-claude-primary');
  expect(reportName('full', '2026-10-21', 'claude-primary')).toBe('2026-10-21-full-claude-primary');
  expect(reportName('full', '2026-10-21')).toBe('2026-10-21');
});
