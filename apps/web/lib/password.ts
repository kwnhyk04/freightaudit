import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// The reviewer's password hash: argon2id from node:crypto (Node 24.7 and later) in standard PHC form, so another argon2
// library, such as @node-rs/argon2 on an older runtime, verifies the same strings (docs/todo.md, step 10).
const PHC = /^[$]argon2id[$]v=19[$]m=([0-9]+),t=([0-9]+),p=([0-9]+)[$]([A-Za-z0-9+/]+)[$]([A-Za-z0-9+/]+)$/;
// OWASP's minimum for argon2id: 19 MiB, 2 passes, 1 lane.
const COST = { memory: 19_456, passes: 2, parallelism: 1 };
const derive = promisify(argon2);
const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string) {
  const nonce = randomBytes(16);
  const tag = await derive('argon2id', { message: password, nonce, tagLength: 32, ...COST });
  return `$argon2id$v=19$m=${COST.memory},t=${COST.passes},p=${COST.parallelism}$${b64(nonce)}$${b64(tag)}`;
}

export async function verifyPassword(password: string, phc: string) {
  const match = PHC.exec(phc);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash!, 'base64');
  const tag = await derive('argon2id', {
    message: password,
    nonce: Buffer.from(salt!, 'base64'),
    tagLength: expected.length,
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
  });
  return timingSafeEqual(tag, expected);
}
