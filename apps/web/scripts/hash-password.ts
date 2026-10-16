// Prints the argon2id hash of a password read from stdin, for DEMO_PASSWORD_HASH. Reading stdin keeps the password out
// of shell history: pnpm --filter @freightaudit/web hash-password, then type it and press Ctrl+D (Ctrl+Z, Enter on
// Windows).
import { text } from 'node:stream/consumers';
import { hashPassword } from '../lib/password.ts';

const password = (await text(process.stdin)).replace(/\r?\n$/, '');
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}
console.log(await hashPassword(password));
