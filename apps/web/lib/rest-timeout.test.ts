import { createToken, SESSION_COOKIE } from './session.ts';

// The web's three REST calls against an api that takes the request and never answers, as the public path stalled on
// 2026-10-21. Only Next's request context and the network are faked, and every timeout is cut to a few milliseconds:
// each call must end in its error state instead of holding the function. Without a timeout a test fails by its own 2 s.
// ESM mocks come before the routes are imported; @types/jest does not declare them yet.
const jest = import.meta.jest as ImportMeta['jest'] & { unstable_mockModule(name: string, factory: () => object, options?: { virtual?: boolean }): void };
const secret = 's'.repeat(40);
const cookie = { name: SESSION_COOKIE, value: createToken('reviewer', secret) };
jest.unstable_mockModule('server-only', () => ({}), { virtual: true });
jest.unstable_mockModule('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === cookie.name ? cookie : undefined) }), headers: async () => new Headers() }));
jest.unstable_mockModule('next/cache', () => ({ refresh: () => {} }));
jest.unstable_mockModule('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));
Object.assign(process.env, { API_URL: 'http://api.test', API_KEY: 'w'.repeat(40), SESSION_SECRET: secret, AI_ENABLED: 'true', DEMO_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA' });

const { upload } = await import('../app/actions.ts');
const document = await import('../app/api/invoices/[id]/document/route.ts');
const progress = await import('../app/api/progress/route.ts');
const { isLive } = await import('./server.ts');

const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
// Paths the api was asked for, and which ones stall: /readyz answers, so the web counts the api as live and sends the call.
const asked: string[] = [];
const inFlight: unknown[] = [];
beforeAll(() => {
  AbortSignal.timeout = () => realTimeout(20);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    asked.push(pathname);
    if (pathname === '/readyz') return new Response('ok');
    // As fetch does: it holds a request in flight, which follows its signal only weakly, so a collected one never hears
    // the abort; and a signal that fired already rejects at once.
    inFlight.push(input, request);
    request.signal.throwIfAborted();
    return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason as Error)));
  }) as typeof fetch;
});
afterAll(() => {
  AbortSignal.timeout = realTimeout;
  globalThis.fetch = realFetch;
});

const id = '01a148bd-eda1-7a5f-a782-8ee6aeec1bbe';
const NO_ANSWER = { detail: 'the FreightAudit API did not answer' };

// First: it marks the api offline, and an upload then stops before it sends anything.
test('an upload the api never answers ends in the no-answer state the upload page retries, and the site counts the api offline', async () => {
  const form = new FormData();
  form.set('file', new File(['%PDF-1.7\n'], 'invoice.pdf', { type: 'application/pdf' }));
  expect(await upload({}, form)).toEqual({ error: 'The FreightAudit API did not answer. Try again in a moment.', code: 'UNAVAILABLE' });
  expect(asked).toContain('/v1/invoices');
  expect(await isLive()).toBe(false);
}, 2_000);

test('a document the api never sends ends in a 502 the viewer turns into its message', async () => {
  const response = await document.GET(new Request('http://web.test/'), { params: Promise.resolve({ id }) });
  expect([response.status, await response.json()]).toEqual([502, NO_ANSWER]);
  expect(asked).toContain(`/v1/invoices/${id}/document`);
}, 2_000);

test('a progress check the api never answers ends in the 502 that keeps the poller asking', async () => {
  const response = await progress.GET(new Request(`http://web.test/api/progress?invoice=${id}`));
  expect([response.status, await response.json()]).toEqual([502, NO_ANSWER]);
  expect(asked).toContain(`/v1/invoices/${id}`);
}, 2_000);
