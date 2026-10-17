import { settings } from '@freightaudit/config/env';
import { readdirSync, readFileSync } from 'node:fs';
import { configuredRoles } from './run.ts';

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
