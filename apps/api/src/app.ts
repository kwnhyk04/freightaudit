import multipart from '@fastify/multipart';
import { openapiPath, typeDefs, type Resolvers } from '@freightaudit/contracts';
import { type Check, readiness } from '@freightaudit/telemetry';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { createSchema, createYoga } from 'graphql-yoga';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fail, problem } from './problem.ts';
import { createStore, createStubService, type Store } from './stub-service.ts';
import { onFile } from './uploads.ts';

const resolvers: Resolvers = { Query: { health: () => 'ok' } };

// Probes need no key; openapi.yaml marks the same routes with security: [].
const publicRoutes = new Set(['/healthz', '/readyz']);

const sha256 = (value: string) => createHash('sha256').update(value).digest();

type Deps = { apiKeys: string[]; checks?: Record<string, Check>; store?: Store };

export function buildApp(opts: FastifyServerOptions, { apiKeys, checks = {}, store = createStore() }: Deps) {
  const app = Fastify(opts);
  const keyDigests = apiKeys.map(sha256);

  // Runs before body parsing, so an upload without a valid key is rejected before its bytes are read.
  // Equal-length digests let timingSafeEqual compare keys in constant time.
  app.addHook('onRequest', async (req) => {
    if (publicRoutes.has(req.routeOptions.url ?? '')) return;
    const key = req.headers['x-api-key'];
    if (typeof key === 'string' && keyDigests.some((known) => timingSafeEqual(known, sha256(key)))) return;
    throw fail(401, 'X-API-Key header is missing or invalid');
  });

  // Every error, including schema validation failures, is an RFC 9457 Problem Details body.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) req.log.error(error);
    return reply
      .code(status)
      .type('application/problem+json')
      .send(problem(status, status >= 500 ? 'Internal server error' : error.message));
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).type('application/problem+json').send(problem(404, `no route for ${req.method} ${req.url}`)),
  );

  // Files are streamed and hashed; request validation sees each file as its SHA-256 digest.
  app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    onFile,
    limits: { files: 500, fileSize: 20 * 1024 * 1024 },
  });
  // Routes, request validation and response serialization all come from openapi.yaml.
  app.register(openapiGlue, {
    specification: openapiPath,
    serviceHandlers: {
      ...createStubService(store),
      getHealthz: async () => ({ status: 'ok' }),
      async getReadyz(req: FastifyRequest, reply: FastifyReply) {
        const { ready, body } = await readiness(checks, req.log);
        return reply.code(ready ? 200 : 503).send(body);
      },
    },
  });

  const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) });
  app.route({
    url: yoga.graphqlEndpoint,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: (req, reply) => yoga.handleNodeRequestAndResponse(req, reply),
  });
  return app;
}
