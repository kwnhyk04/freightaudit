import { createHmac, timingSafeEqual } from 'node:crypto';

// The session cookie: base64url JSON { sub, iat, at } and its HMAC-SHA256 under SESSION_SECRET, where iat is the
// sign-in and at the last activity, in Unix seconds. Stateless, so any instance verifies it; changing the secret signs
// everyone out. __Host- keeps it on this exact host, over HTTPS, path /.
export const SESSION_COOKIE = '__Host-session';
// Set at sign-in, renewal and sign-out: a __Host- cookie is only replaced by one with the same attributes.
export const SESSION_COOKIE_ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
export type Session = { sub: string; iat: number; at: number };
export type Limits = { idleSeconds: number; maxSeconds: number };
// Why a validly signed token no longer holds: idle too long, past the limit from sign-in, or written by an older build.
export type Ended = 'idle' | 'max' | 'old';
// Activity renews the cookie only this long after its last renewal, so it is not reissued on every request.
export const RENEW_SECONDS = 5 * 60;
export const limitsFrom = (env: { SESSION_IDLE_MINUTES: number; SESSION_MAX_HOURS: number }): Limits => ({
  idleSeconds: env.SESSION_IDLE_MINUTES * 60,
  maxSeconds: env.SESSION_MAX_HOURS * 3600,
});

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');
const seconds = (ms: number) => Math.floor(ms / 1000);

// signedInAt stays the first sign-in's time when a token is renewed.
export function createToken(sub: string, secret: string, now = Date.now(), signedInAt = now) {
  const payload = Buffer.from(JSON.stringify({ sub, iat: seconds(signedInAt), at: seconds(now) })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// A session, why a validly signed token has ended, or undefined for anything unsigned, tampered or malformed.
export function checkToken(token: string | undefined, secret: string, limits: Limits, now = Date.now()): { session: Session } | { ended: Ended } | undefined {
  const [payload, mac, extra] = token?.split('.') ?? [];
  if (!payload || !mac || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let session: Session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
  } catch {
    return undefined;
  }
  if (typeof session?.sub !== 'string') return undefined;
  const { iat, at } = session;
  const current = seconds(now);
  if (typeof iat !== 'number' || typeof at !== 'number' || at < iat || iat > current) return { ended: 'old' };
  if (current >= iat + limits.maxSeconds) return { ended: 'max' };
  if (current >= at + limits.idleSeconds) return { ended: 'idle' };
  return { session: { sub: session.sub, iat, at } };
}

export function readToken(token: string | undefined, secret: string, limits: Limits, now = Date.now()) {
  const checked = checkToken(token, secret, limits, now);
  return checked && 'session' in checked ? checked.session : undefined;
}

// A fresh token for a live session once RENEW_SECONDS have passed since its last one; undefined until then.
export const renewToken = (session: Session, secret: string, now = Date.now()) =>
  seconds(now) - session.at >= RENEW_SECONDS ? createToken(session.sub, secret, now, session.iat * 1000) : undefined;

// The cookie lives until the limit from sign-in; the idle limit is checked from the token.
export const cookieSeconds = (session: Pick<Session, 'iat'>, limits: Limits, now = Date.now()) => Math.max(0, session.iat + limits.maxSeconds - seconds(now));

// The sign-in page's line for ?ended=, or nothing for any other value.
export function endedMessage(ended: unknown, limits: Limits) {
  if (ended === 'idle') return `You were signed out after ${limits.idleSeconds / 60} minutes without activity.`;
  if (ended === 'max') return `You were signed out ${limits.maxSeconds / 3600} hours after signing in.`;
  if (ended === 'old') return 'Your session has ended. Sign in again.';
  return undefined;
}

// The page sign-in opens when it was asked for no other: the overview.
export const START_PAGE = '/dashboard';
// Where to go after signing in: a path on this site only, never another origin (//host or /\host), and never the
// landing page at /, which needs no sign-in.
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?![/\\?#]|$)/.test(next) ? next : START_PAGE);

// Next's rule for its own server actions (next/dist/server/app-render/action-handler.js): a request without an Origin
// passes, since browsers send one with every cross-site POST; otherwise the Origin's host must equal the first
// x-forwarded-host, or Host when that is absent.
export function sameOrigin(headers: Headers) {
  const origin = headers.get('origin');
  if (!origin) return true;
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host');
  try {
    return origin !== 'null' && new URL(origin).host === host;
  } catch {
    return false;
  }
}
