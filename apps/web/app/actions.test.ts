import { PAGE_SIZES } from '../lib/paging.ts';

// The bulk action with its server half faked: a signed-in reviewer, a live backend, and an api that takes every
// decision, recording what it was sent. ESM mocks come before the actions are imported; @types/jest does not declare
// them yet.
const jest = import.meta.jest as ImportMeta['jest'] & { unstable_mockModule(name: string, factory: () => object): void };
const sent: unknown[] = [];
class ApiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
const unused = () => {
  throw new Error('not used by a bulk action');
};
jest.unstable_mockModule('../lib/server.ts', () => ({
  ApiError,
  REVIEWER: 'reviewer',
  currentSession: async () => ({ sub: 'reviewer' }),
  isLive: async () => true,
  gql: async (_: unknown, variables: unknown) => void sent.push(variables),
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
const { reviewMany } = await import('./actions.ts');

// A bulk form as the page sends it: the action and one value per ticked row.
function ticked(action: string, kind: string, rows: number) {
  const form = new FormData();
  form.set('action', action);
  for (let row = 1; row <= rows; row++) form.append(kind, `${kind}-${row}`);
  return form;
}
beforeEach(() => (sent.length = 0));

test('a bulk action takes every row of the largest page the pager offers', async () => {
  const largest = Math.max(...PAGE_SIZES);
  expect(largest).toBe(100);
  expect(await reviewMany({}, ticked('replay', 'letter', largest))).toEqual({ done: '100 dead letters replayed.' });
  expect(sent).toHaveLength(100);
  expect(await reviewMany({}, ticked('approve', 'finding', 50))).toEqual({ done: '50 charges approved.' });
  expect(sent).toHaveLength(150);
});

test('more rows than that are refused in plain words, and none is sent', async () => {
  expect(await reviewMany({}, ticked('dispute', 'finding', 101))).toEqual({ error: 'At most 100 rows at a time.' });
  expect(await reviewMany({}, ticked('replay', 'letter', 500))).toEqual({ error: 'At most 100 rows at a time.' });
  expect(sent).toEqual([]);
  // What the page can never send is still refused as before.
  expect(await reviewMany({}, ticked('delete', 'finding', 1))).toEqual({ error: 'Unknown action.' });
  expect(await reviewMany({}, ticked('replay', 'letter', 0))).toEqual({ error: 'Select at least one row.' });
});
