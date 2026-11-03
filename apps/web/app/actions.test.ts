import { PAGE_SIZES } from '../lib/paging.ts';

// The bulk action with its server half faked: a signed-in reviewer, a live backend, and an api that takes every
// decision, recording what it was sent, under a rate limit counted as the real one counts it: perMinute requests in the
// 60 s from the first, then a refusal with the seconds left. Its clock moves only while the action waits. ESM mocks come
// before the actions are imported; @types/jest does not declare them yet.
const jest = import.meta.jest as ImportMeta['jest'] & { unstable_mockModule(name: string, factory: () => object): void };
const api = { perMinute: Infinity, now: 0, window: 0, used: 0, sent: [] as { id: string }[], waits: [] as number[] };
class ApiError extends Error {
  readonly code: string;
  readonly retryAfter: number | undefined;
  constructor(message: string, code: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
async function gql(_: unknown, variables: { id: string }) {
  if (api.now - api.window >= 60_000) Object.assign(api, { window: api.now, used: 0 });
  if (api.used >= api.perMinute) {
    const wait = Math.ceil((api.window + 60_000 - api.now) / 1000);
    throw new ApiError(`The API is busy. Try again in ${wait} seconds.`, 'RATE_LIMITED', wait);
  }
  api.used++;
  api.sent.push(variables);
}
const unused = () => {
  throw new Error('not used by a bulk action');
};
jest.unstable_mockModule('../lib/server.ts', () => ({
  ApiError,
  REVIEWER: 'reviewer',
  currentSession: async () => ({ sub: 'reviewer' }),
  isLive: async () => true,
  gql,
  forgetSummary: () => {},
  clientKey: unused,
  env: unused,
  log: unused,
  markOffline: unused,
  requireSession: unused,
  rest: unused,
  sessionLimits: unused,
}));
jest.unstable_mockModule('next/cache', () => ({ refresh: () => {} }));
jest.unstable_mockModule('next/headers', () => ({ cookies: unused }));
jest.unstable_mockModule('next/navigation', () => ({ redirect: unused }));
jest.unstable_mockModule('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    api.waits.push(ms);
    api.now += ms;
  },
}));
const { reviewMany } = await import('./actions.ts');

// A bulk form as the page sends it: the action and one value per ticked row.
function ticked(action: string, kind: string, rows: number) {
  const form = new FormData();
  form.set('action', action);
  for (let row = 1; row <= rows; row++) form.append(kind, `${kind}-${row}`);
  return form;
}
beforeEach(() => Object.assign(api, { perMinute: Infinity, now: 0, window: 0, used: 0, sent: [], waits: [] }));

test('a bulk action takes every row of the largest page the pager offers', async () => {
  const largest = Math.max(...PAGE_SIZES);
  expect(largest).toBe(100);
  expect(await reviewMany({}, ticked('replay', 'letter', largest))).toEqual({ done: '100 dead letters replayed.' });
  expect(api.sent).toHaveLength(100);
  expect(await reviewMany({}, ticked('approve', 'finding', 50))).toEqual({ done: '50 charges approved.' });
  expect(api.sent).toHaveLength(150);
});

test('more rows than that are refused in plain words, and none is sent', async () => {
  expect(await reviewMany({}, ticked('dispute', 'finding', 101))).toEqual({ error: 'At most 100 rows at a time.' });
  expect(await reviewMany({}, ticked('replay', 'letter', 500))).toEqual({ error: 'At most 100 rows at a time.' });
  expect(api.sent).toEqual([]);
  // What the page can never send is still refused as before.
  expect(await reviewMany({}, ticked('delete', 'finding', 1))).toEqual({ error: 'Unknown action.' });
  expect(await reviewMany({}, ticked('replay', 'letter', 0))).toEqual({ error: 'Select at least one row.' });
});

// The api takes 60 requests a minute from all web traffic, and a bulk action sends one per row.
test("under the api's 60 requests a minute, a 100-row action waits as long as the api says, once, and every row goes through", async () => {
  api.perMinute = 60;
  expect(await reviewMany({}, ticked('approve', 'finding', 100))).toEqual({ done: '100 charges approved.' });
  expect([api.sent.length, new Set(api.sent.map(({ id }) => id)).size, api.waits]).toEqual([100, 100, [60_000]]);
});

test('the action waits at most 90 s in all: past that, the rows left are refused with the wait the api asked for, and it says how many went through', async () => {
  // 30 a minute: 30 rows, a wait of 60 s, 30 more, and a second wait would pass 90 s.
  api.perMinute = 30;
  expect(await reviewMany({}, ticked('approve', 'finding', 100))).toEqual({ error: '60 of 100 charges approved. 40 refused: The API is busy. Try again in 60 seconds.' });
  expect([api.sent.length, api.waits]).toEqual([60, [60_000]]);
});
