import { createHmac, timingSafeEqual } from 'node:crypto';

// The session cookie: base64url JSON { sub, exp } and its HMAC-SHA256 under SESSION_SECRET. Stateless, so any instance
// verifies it; changing the secret signs everyone out. __Host- keeps it on this exact host, over HTTPS, path /.
export const SESSION_COOKIE = '__Host-session';
export const SESSION_SECONDS = 8 * 60 * 60;
// Set at sign-in and repeated at sign-out: a __Host- cookie is only replaced by one with the same attributes.
export const SESSION_COOKIE_ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
export type Session = { sub: string; exp: number };

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createToken(sub: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readToken(token: string | undefined, secret: string, now = Date.now()): Session | undefined {
  const [payload, mac, extra] = token?.split('.') ?? [];
  if (!payload || !mac || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return typeof session.sub === 'string' && typeof session.exp === 'number' && session.exp * 1000 > now ? session : undefined;
  } catch {
    return undefined;
  }
}

// Where to go after signing in: a path on this site only, never another origin (//host or /\host).
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/invoices');

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
