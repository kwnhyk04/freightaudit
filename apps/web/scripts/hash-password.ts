// The argon2id hash of a password, for DEMO_PASSWORD_HASH. On a terminal it asks twice without echoing; otherwise it
// reads the password from stdin. --write-env puts only the hash into the root .env and prints nothing secret:
// pnpm --filter @freightaudit/web hash-password --write-env
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { setEnvValue } from '../lib/env-file.ts';
import { hashPassword } from '../lib/password.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// One line typed without echo. Backspace erases; Ctrl+C quits.
function ask(prompt: string) {
  return new Promise<string>((resolve) => {
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    let typed = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003' || char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.off('data', onData);
          process.stdin.pause();
          process.stderr.write('\n');
          if (char === '\u0003') process.exit(130);
          return resolve(typed);
        }
        typed = char === '\u007f' || char === '\b' ? typed.slice(0, -1) : typed + char;
      }
    };
    process.stdin.on('data', onData).resume();
  });
}

const { values } = parseArgs({ options: { 'write-env': { type: 'boolean', default: false } } });
let password: string;
if (process.stdin.isTTY) {
  password = await ask('Demo password (12 characters or more): ');
  if ((await ask('Again: ')) !== password) fail('The two passwords differ.');
} else {
  password = (await text(process.stdin)).replace(/\r?\n$/, '');
}
if (password.length < 12) fail('Use a password of at least 12 characters.');
const hash = await hashPassword(password);

if (values['write-env']) {
  const file = new URL('../../../.env', import.meta.url);
  writeFileSync(file, setEnvValue(existsSync(file) ? readFileSync(file, 'utf8') : '', 'DEMO_PASSWORD_HASH', hash));
  console.log('DEMO_PASSWORD_HASH written to the root .env.');
} else {
  console.log(hash);
}
