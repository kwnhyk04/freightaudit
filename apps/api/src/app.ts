import multipart from '@fastify/multipart';
import { openapiPath, typeDefs, type Resolvers } from '@freightaudit/contracts';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { createSchema, createYoga } from 'graphql-yoga';
import { problem } from './problem.ts';
import { createStore, createStubService, type Store } from './stub-service.ts';
import { onFile } from './uploads.ts';

const resolvers: Resolvers = { Query: { health: () => 'ok' } };

export function buildApp(opts: FastifyServerOptions = {}, store: Store = createStore()) {
  const app = Fastify(opts);

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
  app.register(openapiGlue, { specification: openapiPath, serviceHandlers: createStubService(store) });

  const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) });
  app.route({
    url: yoga.graphqlEndpoint,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: (req, reply) => yoga.handleNodeRequestAndResponse(req, reply),
  });
  return app;
}
