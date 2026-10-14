import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './generated/openapi.ts';

export type { components, operations, paths } from './generated/openapi.ts';
export type * from './generated/graphql-resolvers.ts';

// Spec files are the source of truth: code reads them and never generates them.
export const openapiPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
export const typeDefs = readFileSync(new URL('../schema.graphql', import.meta.url), 'utf8');

// Typed REST client for the paths in openapi.yaml.
export const createApiClient = (options?: ClientOptions) => createClient<paths>(options);
