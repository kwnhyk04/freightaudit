import { type NextRequest, NextResponse } from 'next/server';
import { readToken, SESSION_COOKIE } from './lib/session.ts';

// An optimistic check on every request: without a valid session cookie, live pages go to /login and the document route
// answers 401. Pages, actions and the route check the session again; the docs say a proxy alone is not authorization.
export function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret && readToken(request.cookies.get(SESSION_COOKIE)?.value, secret)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ detail: 'sign in first' }, { status: 401 });
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

// Public: the sign-in page, the read-only sample demo and its files, the probes, and Next's own assets.
export const config = {
  matcher: ['/((?!login|demo|healthz|readyz|_next/|favicon\\.ico).*)'],
};
