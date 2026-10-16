import type { FastifyRequest } from 'fastify';
import { fail } from './problem.ts';

declare module 'fastify' {
  interface FastifyRequest {
    // SHA-256 of the API key the request used, hex encoded; set by the key check.
    apiKeyId: string;
  }
}

// The same rule as audit_events.actor (migration 0013).
const ACTOR = /^[A-Za-z0-9 ._@:-]{1,64}$/;

// Who a request acts for, as the audit trail records it. The web backend names its signed-in user in X-Actor; any other
// caller is its API key, by the first 8 hex digits of the key's digest. ponytail: the api trusts X-Actor from any valid
// key; per-user API identity when a second client needs it.
export function actorOf(req: FastifyRequest) {
  const header = req.headers['x-actor'];
  if (header === undefined) return `api-key:${req.apiKeyId.slice(0, 8)}`;
  if (typeof header !== 'string' || !ACTOR.test(header)) throw fail(400, 'X-Actor must be 1 to 64 letters, digits, spaces or . _ @ : -');
  return header;
}
