import { buildApp } from './app.ts';

const app = buildApp();
afterAll(() => app.close());

test('GraphQL health query resolves', async () => {
  const res = await app.inject({ method: 'POST', url: '/graphql', payload: { query: '{ health }' } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ data: { health: 'ok' } });
});
