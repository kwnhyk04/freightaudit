import type { paths } from '@freightaudit/contracts';
import createClient from 'openapi-fetch';

// /api/progress with its server half faked: a signed-in reviewer, and the real REST client in front of an api that
// answers as each test sets. ESM mocks come before the route is imported; @types/jest does not declare them yet.
const jest = import.meta.jest as ImportMeta['jest'] & { unstable_mockModule(name: string, factory: () => object): void };
let answer: () => Response;
let offline = 0;
jest.unstable_mockModule('../../../lib/server.ts', () => ({
  currentSession: async () => ({ sub: 'reviewer' }),
  gql: async () => {
    throw new Error('not asked for recent uploads here');
  },
  markOffline: () => void offline++,
  rest: () => createClient<paths>({ baseUrl: 'http://api.test', fetch: async () => answer() }),
}));
const { GET } = await import('./route.ts');

const id = '01a148bd-eda1-7a5f-a782-8ee6aeec1bbe';
const ask = () => GET(new Request(`http://127.0.0.1:3000/api/progress?invoice=${id}`));
beforeEach(() => (offline = 0));

test('an invoice the api returns answers with its progress key, and the backend stays live', async () => {
  answer = () => Response.json({ id, status: 'extracting', filename: 'a.pdf' });
  const response = await ask();
  expect([response.status, await response.json(), offline]).toEqual([200, { key: `${id}:extracting` }, 0]);
});

// openapi-fetch hands back a refusal instead of throwing; a 200 with an empty key would make the poller refresh once and
// stop, where a 502 keeps it asking, 5 s and then 60 s apart.
test.each([429, 500, 502, 503])('an api answering %i counts as no answer: 502, with the backend marked offline', async (status) => {
  answer = () => Response.json({ type: 'about:blank', title: 'Refused', status }, { status, headers: { 'retry-after': '30' } });
  const response = await ask();
  expect([response.status, await response.json(), offline]).toEqual([502, { detail: 'the FreightAudit API did not answer' }, 1]);
});

// No such invoice, as the api says it: an empty key, so the page refreshes once and shows that, with the backend live.
test.each([404, 400, 403])('an api answering %i is an answer: an empty key, with the backend still live', async (status) => {
  answer = () => Response.json({ type: 'about:blank', title: 'Refused', status }, { status });
  const response = await ask();
  expect([response.status, await response.json(), offline]).toEqual([200, { key: '' }, 0]);
});

test('an api that cannot be reached is answered the same way', async () => {
  answer = () => {
    throw new TypeError('fetch failed');
  };
  const response = await ask();
  expect([response.status, offline]).toEqual([502, 1]);
});
