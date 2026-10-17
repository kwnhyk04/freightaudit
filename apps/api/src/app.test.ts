import { createMemoryStorage } from '@freightaudit/pipeline';
import { serverOptions } from '@freightaudit/telemetry';
import { Kind } from 'graphql';
import { buildApp } from './app.ts';
import { Cents } from './graphql.ts';

const apiKey = 'k'.repeat(40);
const storage = createMemoryStorage();
const app = buildApp({}, { apiKeys: [apiKey], storage });
afterAll(() => app.close());

test('GraphQL answers with a valid API key and returns 401 without one', async () => {
  const payload = { query: '{ health }' };
  const res = await app.inject({ method: 'POST', url: '/graphql', headers: { 'x-api-key': apiKey }, payload });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ data: { health: 'ok' } });

  const anonymous = await app.inject({ method: 'POST', url: '/graphql', payload });
  expect(anonymous.statusCode).toBe(401);
});

test('every response carries the security headers, and a request from a browser is refused with 403', async () => {
  const anonymous = await app.inject({ method: 'GET', url: '/v1/invoices' });
  expect(anonymous.statusCode).toBe(401);
  expect(anonymous.headers).toMatchObject({
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  });

  const headers = { 'x-api-key': apiKey, origin: 'https://example.com' };
  const browser = await app.inject({ method: 'POST', url: '/graphql', headers, payload: { query: '{ health }' } });
  expect(browser.statusCode).toBe(403);
  expect(browser.headers['access-control-allow-origin']).toBeUndefined();
});

test('readiness probes within 2 s share one round of checks', async () => {
  let rounds = 0;
  const probed = buildApp({}, { apiKeys: [apiKey], storage, checks: { postgres: async () => void rounds++ } });
  for (let probe = 0; probe < 3; probe++) expect((await probed.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
  await probed.close();
  expect(rounds).toBe(1);
});

test('logs are JSON lines with a UUID request id and redacted credentials', async () => {
  const lines: string[] = [];
  const options = serverOptions('info');
  const logged = buildApp(
    { ...options, logger: { ...options.logger, stream: { write: (line: string) => lines.push(line) } } },
    { apiKeys: [apiKey], storage },
  );
  await logged.inject({ method: 'GET', url: '/healthz' });
  const headers = { 'x-api-key': apiKey, authorization: 'Bearer token-1', cookie: 'session=token-2' };
  logged.log.info({ headers, upstream: { headers }, apiKey }, 'probe');
  await logged.close();

  const records = lines.map((line) => JSON.parse(line));
  expect(records.find((record) => record.msg === 'incoming request')?.reqId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const redacted = { 'x-api-key': '[Redacted]', authorization: '[Redacted]', cookie: '[Redacted]' };
  expect(records.find((record) => record.msg === 'probe')).toMatchObject({
    headers: redacted,
    upstream: { headers: redacted },
    apiKey: '[Redacted]',
  });
  expect(lines.join('')).not.toMatch(new RegExp(`${apiKey}|token-`));
});

test('Cents crosses the wire as an integer number and refuses what it cannot carry exactly', () => {
  expect(Cents.serialize(123_456n)).toBe(123_456);
  expect(Cents.serialize(-500n)).toBe(-500);
  expect(() => Cents.serialize(2n ** 53n)).toThrow('safe range');
  expect(Cents.parseValue(42)).toBe(42n);
  expect(() => Cents.parseValue(1.5)).toThrow('safe range');
  expect(() => Cents.parseValue('42')).toThrow('safe range');
  expect(Cents.parseLiteral({ kind: Kind.INT, value: '-7' })).toBe(-7n);
  expect(() => Cents.parseLiteral({ kind: Kind.FLOAT, value: '4.2' })).toThrow('safe range');
  expect(() => Cents.parseLiteral({ kind: Kind.INT, value: '9007199254740993' })).toThrow('safe range');
});
