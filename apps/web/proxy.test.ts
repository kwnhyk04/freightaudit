import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from './proxy.ts';

// The proxy checks the session on every live page and route; the landing page at / exactly, sign-in, sign-out, the
// sample, the probes and Next's own files are public.
test('the landing page at / is public, and every live page and route still needs a session', () => {
  const checked = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  for (const path of ['/invoices', '/invoices/1', '/dashboard', '/upload', '/discrepancies', '/dead-letters', '/api/invoices/1/document', '/nowhere']) {
    expect([path, checked(path)]).toEqual([path, true]);
  }
  for (const path of ['/', '/?ref=home', '/login', '/logout', '/demo', '/demo/invoices/1', '/healthz', '/readyz', '/_next/static/chunks/main.js', '/favicon.ico']) {
    expect([path, checked(path)]).toEqual([path, false]);
  }
});
