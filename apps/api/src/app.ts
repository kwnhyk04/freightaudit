import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { openapiPath, typeDefs, type Resolvers } from '@freightaudit/contracts';
import type { Storage } from '@freightaudit/pipeline';
import { type Check, intakeRejected, readiness } from '@freightaudit/telemetry';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { createSchema, createYoga } from 'graphql-yoga';
import type { Redis } from 'ioredis';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fail, problem } from './problem.ts';
import { createOnFile, MAX_FILE_BYTES } from './uploads.ts';

const resolvers: Resolvers = { Query: { health: () => 'ok' } };

// Probes need no key; openapi.yaml marks the same routes with security: [].
const publicRoutes = new Set(['/healthz', '/readyz']);
const uploadRoutes = new Set(['/v1/invoices', '/v1/invoice-batches']);
const isUpload = (req: FastifyRequest) => req.method === 'POST' && uploadRoutes.has(req.routeOptions.url ?? '');
// Seconds a client turned away by the extraction backlog waits before trying again.
const BACKLOG_RETRY_AFTER_S = 30;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

type Deps = {
  apiKeys: string[];
  storage: Storage;
  checks?: Record<string, Check>;
  // REST handlers keyed by operationId; an operation without one fails as not implemented.
  service?: object;
  // Rate-limit counters live here, shared by every api instance; without it each process counts alone.
  redis?: Redis;
  prefix?: string;
  // Requests per API key per minute.
  rateLimits?: { general: number; upload: number };
  // Uploads get 503 while more extract jobs than highWater are waiting.
  backlog?: { waiting: () => Promise<number>; highWater: number };
};

export function buildApp(
  opts: FastifyServerOptions,
  { apiKeys, storage, checks = {}, service = {}, redis, prefix = 'freightaudit', rateLimits = { general: 60, upload: 10 }, backlog }: Deps,
) {
  // A client must send the whole request within 30 s.
  const app = Fastify({ requestTimeout: 30_000, ...opts });
  const keyDigests = apiKeys.map(sha256);
  // The digest of the key each request used: limits count per key, and the key itself never reaches Redis.
  const keyIds = new WeakMap<FastifyRequest, string>();

  // Runs before body parsing, so an upload without a valid key is rejected before its bytes are read.
  // Equal-length digests let timingSafeEqual compare keys in constant time.
  app.addHook('onRequest', async (req) => {
    if (publicRoutes.has(req.routeOptions.url ?? '')) return;
    const key = req.headers['x-api-key'];
    const digest = typeof key === 'string' ? sha256(key) : undefined;
    if (digest && keyDigests.some((known) => timingSafeEqual(known, digest))) {
      keyIds.set(req, digest.toString('hex'));
      return;
    }
    throw fail(401, 'X-API-Key header is missing or invalid');
  });

  // Backpressure: while the extract backlog is too long, uploads are refused before their bodies are read.
  if (backlog) {
    app.addHook('onRequest', async (req, reply) => {
      if (!isUpload(req) || (await backlog.waiting()) <= backlog.highWater) return;
      intakeRejected.add(1, { reason: 'backlog' });
      reply.header('retry-after', BACKLOG_RETRY_AFTER_S);
      throw fail(503, 'the extraction backlog is full; retry later');
    });
  }

  // Every error, including schema validation failures, is an RFC 9457 Problem Details body.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500 && status !== 503) req.log.error(error);
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, status >= 500 && status !== 503 ? 'Internal server error' : error.message));
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).type('application/problem+json').send(problem(404, `no route for ${req.method} ${req.url}`)),
  );

  // Per API key and minute: one budget for uploads and one for everything else. Registered before any route, so its
  // hook runs on each one, after the key check above.
  app.register(rateLimit, {
    redis,
    nameSpace: `${prefix}:rate-limit:`,
    timeWindow: 60_000,
    enableDraftSpec: true,
    allowList: (req) => publicRoutes.has(req.routeOptions.url ?? ''),
    keyGenerator: (req) => `${keyIds.get(req)}:${isUpload(req) ? 'upload' : 'general'}`,
    max: (_req, key) => (key.endsWith(':upload') ? rateLimits.upload : rateLimits.general),
  });

  // Each file is read, checked and stored; request validation sees it as its SHA-256 digest. An oversized file is
  // cut off and rejected on its own, so one bad file never fails a whole batch.
  app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    onFile: createOnFile(storage),
    limits: { files: 500, fileSize: MAX_FILE_BYTES },
    throwFileSizeLimit: false,
  });
  // Routes, request validation and response serialization all come from openapi.yaml.
  app.register(openapiGlue, {
    specification: openapiPath,
    serviceHandlers: {
      ...service,
      getHealthz: async () => ({ status: 'ok' }),
      async getReadyz(req: FastifyRequest, reply: FastifyReply) {
        const { ready, body } = await readiness(checks, req.log);
        return reply.code(ready ? 200 : 503).send(body);
      },
    },
  });

  const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) });
  app.register(async (scope) => {
    scope.route({
      url: yoga.graphqlEndpoint,
      method: ['GET', 'POST', 'OPTIONS'],
      handler: (req, reply) => yoga.handleNodeRequestAndResponse(req, reply),
    });
  });
  return app;
}
