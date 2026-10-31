// LLM_RECORD=1 pnpm --filter @freightaudit/llm record:anthropic [bad-key] [unknown-model] records Anthropic refusals that
// cost nothing: a 401 for a made-up key (bad-key), and a 404 for a model that does not exist, asked with
// ANTHROPIC_API_KEY from .env (unknown-model); both without names. Each becomes fixtures/anthropic/<name>.json with the
// status, the response headers and the response body only: never the request, its headers or a key. The headers that
// name the account (anthropic-organization-id, anthropic-workspace-id) are left out; a file that would hold a key or set
// a cookie is not written.
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';

// Plainly not a key anyone holds, and no variation of a real one.
const FAKE_KEY = 'sk-ant-FAKE-recording-401-not-a-real-key';
const key = process.env.ANTHROPIC_API_KEY;
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['bad-key', 'unknown-model'];
if (process.env.LLM_RECORD !== '1' || (names.includes('unknown-model') && !key) || names.some((name) => name !== 'bad-key' && name !== 'unknown-model')) {
  console.error('usage: LLM_RECORD=1 record:anthropic [bad-key] [unknown-model]; unknown-model needs ANTHROPIC_API_KEY in .env');
  process.exit(1);
}

// One request Anthropic refuses before any model runs, so nothing is billed, and its answer as Anthropic sent it.
async function refusal(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  try {
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'x' }] });
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status !== undefined) {
      return { recorded_at: new Date().toISOString().slice(0, 10), status: err.status, headers: Object.fromEntries(err.headers?.entries() ?? []), body: err.error };
    }
    throw err;
  }
  throw new Error(`${model} answered instead of refusing`);
}

// Left out of every file (user, 2026-11-01): they name the organization and the workspace behind the key.
const ACCOUNT = /^(anthropic-organization-id|anthropic-workspace-id)$/i;
let refused = 0;
for (const name of names) {
  const answer = name === 'bad-key' ? await refusal(FAKE_KEY, 'claude-haiku-5-5') : await refusal(key!, 'claude-haiku-5-5-no-such-model');
  const file = { ...answer, headers: Object.fromEntries(Object.entries(answer.headers).filter(([header]) => !ACCOUNT.test(header))) };
  // Header names only, never their values, so the log shows what the file keeps.
  const leftOut = Object.keys(answer.headers).filter((header) => ACCOUNT.test(header));
  console.log(`${name}: HTTP ${file.status}, headers: ${Object.keys(file.headers).sort().join(', ')}; left out: ${leftOut.join(', ') || 'none'}`);
  const problems = [
    ...[key, FAKE_KEY].flatMap((value) => (value && JSON.stringify(file).includes(value) ? [`${name} would hold a key`] : [])),
    ...(Object.hasOwn(file.headers, 'set-cookie') ? [`${name}: a set-cookie header`] : []),
  ];
  if (problems.length > 0) {
    console.error(`Not written:\n${problems.join('\n')}`);
    refused++;
    continue;
  }
  writeFileSync(new URL(`../fixtures/anthropic/${name}.json`, import.meta.url), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Written: fixtures/anthropic/${name}.json`);
}
process.exit(refused > 0 ? 2 : 0);
