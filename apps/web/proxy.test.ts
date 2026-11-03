import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { createToken, SESSION_COOKIE } from './lib/session.ts';
import { config, proxy } from './proxy.ts';

// The proxy checks the session on every live page and route; the landing page at / exactly, sign-in, sign-out, the
// probes and Next's own files never reach it. The sample demo does, so a signed-in visit renews the session, but the
// proxy never sends it to sign-in (lib/auth.test.ts).
test('the landing page at / is public, and every live page and route still needs a session', () => {
  const checked = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  for (const path of ['/invoices', '/invoices/1', '/dashboard', '/upload', '/discrepancies', '/dead-letters', '/api/invoices/1/document', '/nowhere', '/demo', '/demo/invoices/1']) {
    expect([path, checked(path)]).toEqual([path, true]);
  }
  for (const path of ['/', '/?ref=home', '/login', '/logout', '/healthz', '/readyz', '/_next/static/chunks/main.js', '/favicon.ico', '/icon.svg', '/apple-icon.png']) {
    expect([path, checked(path)]).toEqual([path, false]);
  }
});

// The proxy keeps the limits it reads first, so this file's first proxy call sets SESSION_IDLE_MINUTES to its least, 1.
test('with the shortest idle limit, a reviewer active every 25 seconds is never signed out', () => {
  const env = process.env;
  const realNow = Date.now;
  const secret = 's'.repeat(40);
  const signedIn = Date.UTC(2026, 10, 2, 9);
  process.env = { ...env, SESSION_SECRET: secret, SESSION_IDLE_MINUTES: '1', SESSION_MAX_HOURS: '8' };
  try {
    let token = createToken('reviewer', secret, signedIn);
    for (let at = signedIn + 25_000; at <= signedIn + 10 * 60_000; at += 25_000) {
      Date.now = () => at;
      const response = proxy(new NextRequest('http://127.0.0.1:3000/invoices', { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
      expect([(at - signedIn) / 1000, response.headers.get('location')]).toEqual([(at - signedIn) / 1000, null]);
      token = response.cookies.get(SESSION_COOKIE)?.value ?? token;
    }
  } finally {
    process.env = env;
    Date.now = realNow;
  }
});
