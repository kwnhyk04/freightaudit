import { createLimiter, MAX_FAILURES, WINDOW_MS } from './limiter.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createToken, readToken, safeNext, sameOrigin, START_PAGE } from './session.ts';

test('a password hash is standard argon2id PHC: the reference vector verifies, and our own hashes round-trip', async () => {
  // phc-winner-argon2's test vector (argon2id, v19, m=65536, t=2, p=1, "password", salt "somesalt"), so any argon2
  // library reads the hashes this module writes.
  const reference = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';
  expect(await verifyPassword('password', reference)).toBe(true);
  expect(await verifyPassword('Password', reference)).toBe(false);
  const hash = await hashPassword('correct horse');
  expect(hash).toMatch(/^[$]argon2id[$]v=19[$]m=19456,t=2,p=1[$]/);
  expect(await verifyPassword('correct horse', hash)).toBe(true);
  expect(await verifyPassword('correct horse', 'not a hash')).toBe(false);
});

test('a session token holds only while signed with the secret and unexpired', () => {
  const secret = 's'.repeat(40);
  const now = Date.UTC(2026, 9, 16, 12);
  const token = createToken('reviewer', secret, now);
  expect(readToken(token, secret, now)).toMatchObject({ sub: 'reviewer' });
  expect(readToken(token, 't'.repeat(40), now)).toBeUndefined();
  expect(readToken(`${token}x`, secret, now)).toBeUndefined();
  expect(readToken(token, secret, now + 9 * 3600_000)).toBeUndefined();
  const [payload] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9e9 })).toString('base64url');
  expect(readToken(token.replace(payload!, forged), secret, now)).toBeUndefined();
  expect(readToken(undefined, secret, now)).toBeUndefined();
});

test('after sign-in only a path on this site is followed, and never the landing page, which needs no sign-in', () => {
  expect(START_PAGE).toBe('/dashboard');
  expect(safeNext('/invoices/1?status=open')).toBe('/invoices/1?status=open');
  for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '', undefined, '/', '/?ref=home']) expect(safeNext(next)).toBe(START_PAGE);
});

test('sign-out takes a post from this site, or one without an Origin, as Next takes its actions', () => {
  const from = (headers: Record<string, string>) => sameOrigin(new Headers(headers));
  expect(from({ origin: 'https://demo.example', host: 'demo.example' })).toBe(true);
  expect(from({ host: 'demo.example' })).toBe(true);
  expect(from({ origin: 'https://demo.example', 'x-forwarded-host': 'demo.example, edge.internal', host: 'fn.internal' })).toBe(true);
  for (const origin of ['https://evil.example', 'https://demo.example:8443', 'null', 'not a url']) expect(from({ origin, host: 'demo.example' })).toBe(false);
  expect(from({ origin: 'https://demo.example' })).toBe(false);
  expect(from({ origin: 'https://demo.example', 'x-forwarded-host': 'evil.example', host: 'demo.example' })).toBe(false);
});

test('five failed sign-ins in 15 minutes lock a client out until the oldest leaves the window; a success clears them', () => {
  let now = 0;
  const limiter = createLimiter(() => now);
  for (let i = 0; i < MAX_FAILURES; i++) {
    expect(limiter.retryAfter('a')).toBe(0);
    limiter.fail('a');
    now += 1_000;
  }
  expect(limiter.retryAfter('a')).toBe(WINDOW_MS - MAX_FAILURES * 1_000);
  expect(limiter.retryAfter('b')).toBe(0);
  now = WINDOW_MS + 1;
  expect(limiter.retryAfter('a')).toBe(0);
  limiter.fail('a');
  limiter.clear('a');
  expect(limiter.retryAfter('a')).toBe(0);
});
