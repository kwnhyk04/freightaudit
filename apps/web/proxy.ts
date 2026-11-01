import { loadEnv } from '@freightaudit/config/env';
import { type NextRequest, NextResponse } from 'next/server';
import { checkToken, cookieSeconds, type Limits, limitsFrom, renewToken, SESSION_COOKIE, SESSION_COOKIE_ATTRIBUTES } from './lib/session.ts';
import { BACKGROUND_HEADER } from './lib/uploads.ts';

let limits: Limits | undefined;

// An optimistic check on every request, and where activity renews the session (a proxy may set cookies; a server
// component may not). Without a live session, live pages go to /login, with the page and why a timed-out session ended,
// and the document route answers 401. Pages, actions and the route check the session again; the docs say a proxy alone
// is not authorization. The sample demo stays open either way.
export function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? '';
  limits ??= limitsFrom(loadEnv(['SESSION_IDLE_MINUTES', 'SESSION_MAX_HOURS']));
  const now = Date.now();
  const checked = secret ? checkToken(request.cookies.get(SESSION_COOKIE)?.value, secret, limits, now) : undefined;
  if (checked && 'session' in checked) {
    const response = NextResponse.next();
    // Navigation, server actions and requests the reviewer starts renew; a background poll or Next's prefetch does not.
    if (request.headers.has(BACKGROUND_HEADER) || request.headers.has('next-router-prefetch')) return response;
    const renewed = renewToken(checked.session, secret, now);
    if (renewed) response.cookies.set(SESSION_COOKIE, renewed, { ...SESSION_COOKIE_ATTRIBUTES, maxAge: cookieSeconds(checked.session, limits, now) });
    return response;
  }
  const { pathname, search } = request.nextUrl;
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ detail: 'sign in first' }, { status: 401 });
  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname + search);
  if (checked) login.searchParams.set('ended', checked.ended);
  return NextResponse.redirect(login);
}

// Public: the landing page at / exactly (.+ leaves it out), the sign-in page, sign-out (which checks the origin itself,
// so an expired session can still sign out), the probes, and Next's own assets. The read-only sample demo and its files
// pass through here only so that a signed-in visit there counts as activity.
export const config = {
  matcher: ['/((?!login|logout|healthz|readyz|_next/|favicon\\.ico).+)'],
};
