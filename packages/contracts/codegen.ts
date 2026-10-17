import type { CodegenConfig } from '@graphql-codegen/cli';

// String unions instead of enums: the repo compiles only erasable TypeScript.
const common = { useTypeImports: true, enumsAsTypes: true, strictScalars: true };

const config: CodegenConfig = {
  schema: 'schema.graphql',
  documents: 'operations/*.graphql',
  emitLegacyCommonJSImports: false,
  generates: {
    // Resolver types for the API server; money is bigint in domain code. Invoices, discrepancies and dead letters may be
    // returned in part, wherever they appear, and their field resolvers load the rest by id.
    'src/generated/graphql-resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        ...common,
        mappers: { Invoice: 'Partial<Invoice>', Discrepancy: 'Partial<Discrepancy>', DeadLetter: 'Partial<DeadLetter>' },
        scalars: { Cents: 'bigint', Date: 'string', DateTime: 'string' },
      },
    },
    // Typed documents for clients; Cents arrive as JSON numbers. Documents are strings, so a client posts them with
    // plain fetch and needs no GraphQL library.
    'src/generated/graphql-client/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: { ...common, documentMode: 'string', scalars: { Cents: 'number', Date: 'string', DateTime: 'string' } },
    },
  },
};

export default config;
