import config from '@freightaudit/config/eslint';
import graphql from '@graphql-eslint/eslint-plugin';

export default [
  ...config,
  {
    files: ['**/*.graphql'],
    languageOptions: {
      parser: graphql.parser,
      parserOptions: { graphQLConfig: { schema: 'schema.graphql', documents: 'operations/*.graphql' } },
    },
    plugins: { '@graphql-eslint': graphql },
  },
  {
    files: ['schema.graphql'],
    rules: {
      ...graphql.configs['flat/schema-recommended'].rules,
      ...graphql.configs['flat/schema-relay'].rules,
      // Keyset pagination goes forward (first, after) or back (last, before).
      '@graphql-eslint/relay-arguments': ['error', { includeBoth: false }],
      // Small bounded lists (line items, carriers, audit entries, problems) are plain lists, not connections.
      '@graphql-eslint/relay-edge-types': ['error', { listTypeCanWrapOnlyEdgeType: false }],
      // Relay wrappers and value types nested inside one parent carry no identity of their own.
      '@graphql-eslint/strict-id-in-types': [
        'error',
        {
          exceptions: {
             types: ['PageInfo', 'ExtractedLine', 'FieldChange', 'InvoiceSummary', 'InvoiceStatusCount'],
            suffixes: ['Connection', 'Edge'],
          },
        },
      ],
    },
  },
  {
    files: ['operations/*.graphql'],
    rules: graphql.configs['flat/operations-recommended'].rules,
  },
];