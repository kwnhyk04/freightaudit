import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_ATTRIBUTES, sameOrigin } from '../../lib/session.ts';

// Sign-out. A route handler, since a server action cannot set response headers: it expires the session cookie, asks
// the browser to drop this site's cache (viewed PDFs included) and goes to /login. A post from another site is refused,
// as Next refuses one for its actions; the proxy lets this path through, so an expired session can still sign out.
export function POST(request: Request) {
  if (!sameOrigin(request.headers)) return Response.json({ detail: 'cross-site sign-out refused' }, { status: 403 });
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.headers.set('clear-site-data', '"cache"');
  response.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_ATTRIBUTES, maxAge: 0 });
  return response;
}
