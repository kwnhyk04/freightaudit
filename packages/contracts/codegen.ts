import type { CodegenConfig } from '@graphql-codegen/cli';

// String unions instead of enums: the repo compiles only erasable TypeScript.
const common = { useTypeImports: true, enumsAsTypes: true, strictScalars: true };

const config: CodegenConfig = {
  schema: 'schema.graphql',
  documents: 'operations/*.graphql',
  emitLegacyCommonJSImports: false,
  generates: {
    // Resolver types for the API server; money is bigint in domain code.
    'src/generated/graphql-resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: { ...common, scalars: { Cents: 'bigint', Date: 'string', DateTime: 'string' } },
    },
    // Typed documents for clients; Cents arrive as JSON numbers.
    'src/generated/graphql-client/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: { ...common, scalars: { Cents: 'number', Date: 'string', DateTime: 'string' } },
    },
  },
};

export default config;
