import { createLimiter, MAX_FAILURES, WINDOW_MS } from './limiter.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy.ts';
import { checkToken, createToken, endedMessage, limitsFrom, readToken, renewToken, safeNext, sameOrigin, SESSION_COOKIE, START_PAGE } from './session.ts';
import { BACKGROUND_HEADER } from './uploads.ts';

const secret = 's'.repeat(40);
const limits = limitsFrom({ SESSION_IDLE_MINUTES: 30, SESSION_MAX_HOURS: 8 });
const signedIn = Date.UTC(2026, 10, 2, 9);
const MINUTE = 60_000;
// A payload signed with the secret, as an older build or a forger with the secret would write it.
const signed = (body: object) => {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};

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

test('the limits come from the settings, 30 idle minutes and 8 hours by default', () => {
  expect(limits).toEqual({ idleSeconds: 30 * 60, maxSeconds: 8 * 3600 });
});

test('a session token ends after 30 minutes without activity', () => {
  const token = createToken('reviewer', secret, signedIn);
  expect(readToken(token, secret, limits, signedIn + 29 * MINUTE)).toMatchObject({ sub: 'reviewer' });
  expect(readToken(token, secret, limits, signedIn + 30 * MINUTE)).toBeUndefined();
  expect(checkToken(token, secret, limits, signedIn + 31 * MINUTE)).toEqual({ ended: 'idle' });
});

test('activity renews the token at most every 5 minutes, which moves the idle window but never the sign-in time', () => {
  const token = createToken('reviewer', secret, signedIn);
  const first = readToken(token, secret, limits, signedIn + 4 * MINUTE)!;
  expect(renewToken(first, secret, signedIn + 4 * MINUTE)).toBeUndefined();
  const renewed = renewToken(first, secret, signedIn + 25 * MINUTE)!;
  expect(renewed).toBeDefined();
  // 50 minutes after sign-in, 25 after the renewal: still signed in, where the first token has ended.
  expect(readToken(renewed, secret, limits, signedIn + 50 * MINUTE)).toEqual({ sub: 'reviewer', iat: signedIn / 1000, at: signedIn / 1000 + 25 * 60 });
  expect(readToken(token, secret, limits, signedIn + 50 * MINUTE)).toBeUndefined();
});

test('a session ends 8 hours after sign-in however active it is', () => {
  let token = createToken('reviewer', secret, signedIn);
  for (let at = signedIn + 20 * MINUTE; at < signedIn + 8 * 60 * MINUTE; at += 20 * MINUTE) token = renewToken(readToken(token, secret, limits, at)!, secret, at)!;
  const last = signedIn + 7 * 60 * MINUTE + 40 * MINUTE;
  expect(readToken(token, secret, limits, last + MINUTE)).toBeDefined();
  expect(checkToken(token, secret, limits, signedIn + 8 * 60 * MINUTE)).toEqual({ ended: 'max' });
});

test('a tampered, foreign, malformed or missing token is no session and says nothing about why', () => {
  const token = createToken('reviewer', secret, signedIn);
  const [payload, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 9e9, at: 9e9 })).toString('base64url');
  for (const bad of [`${forged}.${mac}`, `${payload}.${mac}x`, `${token}.extra`, 'nonsense', '', undefined]) expect(checkToken(bad, secret, limits, signedIn)).toBeUndefined();
  expect(checkToken(token, 't'.repeat(40), limits, signedIn)).toBeUndefined();
});

test('a token from before the idle limit, { sub, exp } only, counts as ended, as does one with activity before sign-in', () => {
  expect(checkToken(signed({ sub: 'reviewer', exp: signedIn / 1000 + 3600 }), secret, limits, signedIn)).toEqual({ ended: 'old' });
  expect(checkToken(signed({ sub: 'reviewer', iat: signedIn / 1000, at: signedIn / 1000 - 60 }), secret, limits, signedIn)).toEqual({ ended: 'old' });
  expect(checkToken(signed({ sub: 'reviewer', iat: signedIn / 1000 + 3600, at: signedIn / 1000 + 3600 }), secret, limits, signedIn)).toEqual({ ended: 'old' });
});

test('the sign-in page says in one line why a session ended', () => {
  expect(endedMessage('idle', limits)).toBe('You were signed out after 30 minutes without activity.');
  expect(endedMessage('max', limits)).toBe('You were signed out 8 hours after signing in.');
  expect(endedMessage('old', limits)).toBe('Your session has ended. Sign in again.');
  expect(endedMessage('other', limits)).toBeUndefined();
  expect(endedMessage(undefined, limits)).toBeUndefined();
});

describe('proxy', () => {
  const env = process.env;
  const realNow = Date.now;
  // The proxy reads the clock itself; each test sets it.
  const clock = (ms: number) => (Date.now = () => ms);
  beforeAll(() => (process.env = { ...env, SESSION_SECRET: secret, SESSION_IDLE_MINUTES: '30', SESSION_MAX_HOURS: '8' }));
  afterAll(() => (process.env = env));
  afterEach(() => (Date.now = realNow));
  const request = (path: string, cookie?: string) => new NextRequest(`http://127.0.0.1:3000${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

  test('an idle session goes to sign-in with the page it was on and why it ended; one never signed in gets no reason', () => {
    clock(signedIn + 31 * MINUTE);
    const ended = proxy(request('/invoices?status=open', createToken('reviewer', secret, signedIn)));
    const to = new URL(ended.headers.get('location')!);
    expect([to.pathname, to.searchParams.get('next'), to.searchParams.get('ended')]).toEqual(['/login', '/invoices?status=open', 'idle']);
    const never = new URL(proxy(request('/invoices')).headers.get('location')!);
    expect(never.searchParams.get('ended')).toBeNull();
    expect(proxy(request('/api/invoices/1/document', createToken('reviewer', secret, signedIn))).status).toBe(401);
  });

  test('activity renews the cookie once 5 minutes have passed, and not before', () => {
    clock(signedIn + 3 * MINUTE);
    expect(proxy(request('/invoices', createToken('reviewer', secret, signedIn))).cookies.get(SESSION_COOKIE)).toBeUndefined();
    clock(signedIn + 6 * MINUTE);
    const renewed = proxy(request('/invoices', createToken('reviewer', secret, signedIn))).cookies.get(SESSION_COOKIE)!;
    expect(readToken(renewed.value, secret, limits, signedIn + 35 * MINUTE)).toMatchObject({ iat: signedIn / 1000, at: signedIn / 1000 + 6 * 60 });
    expect(renewed).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 - 6 * 60 });
  });

  test('a background poll or a prefetch passes with a live session but never renews it, so an open page cannot keep it alive', () => {
    const token = createToken('reviewer', secret, signedIn);
    clock(signedIn + 20 * MINUTE);
    for (const headers of [{ [BACKGROUND_HEADER]: '1' }, { 'next-router-prefetch': '1' }] as Record<string, string>[]) {
      const request = new NextRequest('http://127.0.0.1:3000/api/progress?recent=1', { headers: { ...headers, cookie: `${SESSION_COOKIE}=${token}` } });
      const response = proxy(request);
      expect([response.headers.get('location'), response.status, response.cookies.get(SESSION_COOKIE)]).toEqual([null, 200, undefined]);
    }
    // Polls alone for 31 minutes: the session ends, and the next poll is refused.
    clock(signedIn + 31 * MINUTE);
    const late = new NextRequest('http://127.0.0.1:3000/api/progress?recent=1', { headers: { [BACKGROUND_HEADER]: '1', cookie: `${SESSION_COOKIE}=${token}` } });
    expect(proxy(late).status).toBe(401);
  });

  test('the sample demo stays open when signed out or timed out, and renews a live session too', () => {
    clock(signedIn + 31 * MINUTE);
    expect(proxy(request('/demo/invoices')).headers.get('location')).toBeNull();
    expect(proxy(request('/demo/invoices', createToken('reviewer', secret, signedIn))).headers.get('location')).toBeNull();
    expect(proxy(request('/demo/invoices', createToken('reviewer', secret, signedIn + 20 * MINUTE))).cookies.get(SESSION_COOKIE)).toBeDefined();
  });
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
