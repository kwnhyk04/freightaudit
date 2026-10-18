import 'server-only';
import { loadEnv } from '@freightaudit/config/env';
import type { paths } from '@freightaudit/contracts';
import { InvoiceSummaryDocument, type InvoiceSummaryQuery, type TypedDocumentString } from '@freightaudit/contracts/graphql';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import * as crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import createClient from 'openapi-fetch';
import { cache } from 'react';
import { readToken, SESSION_COOKIE } from './session.ts';

// The web's settings; the API key and the session secret never leave this server.
export const WEB_KEYS = ['API_URL', 'API_KEY', 'SESSION_SECRET', 'DEMO_PASSWORD_HASH', 'AI_ENABLED'] as const;
const load = () => loadEnv([...WEB_KEYS]);
let settings: ReturnType<typeof load> | undefined;
export const env = () => (settings ??= load());

// At server start: in development the web reads its own keys from the root .env, without Next's $ expansion (which
// would break the password hash) and without the backend's secrets. Then it checks its settings and that this Node has
// argon2 (24.7 and later), and refuses to start otherwise.
export function startup() {
  const root = `${process.cwd()}/../../.env`;
  if (process.env.NODE_ENV !== 'production' && existsSync(root)) {
    const values = parseEnv(readFileSync(root, 'utf8'));
    for (const key of WEB_KEYS) if (process.env[key] === undefined && values[key] !== undefined) process.env[key] = values[key];
  }
  env();
  if (typeof crypto.argon2 !== 'function') {
    log('error', 'crypto.argon2 needs Node 24.7 or later; see docs/todo.md, step 10');
    process.exit(1);
  }
}

// One reviewer; audit rows name them so. ponytail: a users table when there is a second.
export const REVIEWER = 'reviewer';

export const log = (level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) =>
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, time: Date.now(), msg, ...fields }));

export const currentSession = cache(async () => readToken((await cookies()).get(SESSION_COOKIE)?.value, env().SESSION_SECRET));

export async function requireSession() {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}

// Who asks to sign in: on Vercel its first x-forwarded-for entry; elsewhere the server listens on 127.0.0.1 only, so all
// requests share one bucket.
export async function clientKey() {
  if (process.env.VERCEL !== '1') return 'direct';
  return (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

let probe: { at: number; live: boolean } | undefined;
// A failed api call counts as offline at once, so the next page goes to the sample instead of waiting out the cache.
export const markOffline = () => void (probe = { at: Date.now(), live: false });
// Live while AI is on and the api's /readyz answers within 2.5 s (its own checks take up to 2 s), cached 5 s.
export const isLive = cache(async () => {
  if (!env().AI_ENABLED) return false;
  if (probe && Date.now() - probe.at < 5_000) return probe.live;
  const live = await fetch(new URL('/readyz', env().API_URL), { cache: 'no-store', signal: AbortSignal.timeout(2_500) }).then(
    (response) => response.ok,
    () => false,
  );
  probe = { at: Date.now(), live };
  return live;
});

// A live page needs the session; while the backend is offline its /demo twin takes its place.
export async function livePage(path: string) {
  await requireSession();
  if (!(await isLive())) redirect(`/demo${path}`);
}

export class ApiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// A generated GraphQL document against the api, with the server's key and the reviewer as actor.
export async function gql<Result, Variables>(document: TypedDocumentString<Result, Variables>, variables: Variables, actor?: string) {
  let response: Response;
  try {
    response = await fetch(new URL('/graphql', env().API_URL), {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-api-key': env().API_KEY, ...(actor ? { 'x-actor': actor } : {}) },
      body: JSON.stringify({ query: document.toString(), variables }),
    });
  } catch {
    markOffline();
    throw new ApiError('The FreightAudit API did not answer. Try again in a moment.', 'UNAVAILABLE');
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('retry-after') ?? 60);
    throw new ApiError(`The API is busy. Try again in ${wait} seconds.`, 'RATE_LIMITED');
  }
  const body = (await response.json().catch(() => ({}))) as { data?: Result; errors?: { message: string; extensions?: { code?: string } }[] };
  const error = body.errors?.[0];
  if (error || !body.data) {
    if (!error || error.extensions?.code === 'INTERNAL_SERVER_ERROR') log('error', 'api request failed', { status: response.status });
    throw new ApiError(error?.message ?? `The API answered ${response.status}.`, error?.extensions?.code ?? 'UNAVAILABLE');
  }
  return body.data;
}

// The typed REST client for uploads and documents.
export const rest = () => createClient<paths>({ baseUrl: env().API_URL, headers: { 'x-api-key': env().API_KEY } });

let counted: { at: number; summary: Promise<InvoiceSummaryQuery['invoiceSummary']> } | undefined;
// The list's cards and the sidebar's counts: one call per request, kept 10 s, since every page asks for them and the api
// allows 60 requests a minute for all web traffic. Each action forgets it. ponytail: per instance, so another Vercel
// instance can show counts up to 10 s old.
export const summary = cache(() => {
  if (!counted || Date.now() - counted.at >= 10_000) {
    const next = { at: Date.now(), summary: gql(InvoiceSummaryDocument, {}).then(({ invoiceSummary }) => invoiceSummary) };
    next.summary.catch(() => counted === next && (counted = undefined));
    counted = next;
  }
  return counted.summary;
});
export const forgetSummary = () => void (counted = undefined);
