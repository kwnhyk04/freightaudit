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
      // Keyset pagination is forward-only: first and after, without last and before.
      '@graphql-eslint/relay-arguments': ['error', { includeBoth: false }],
      // Relay wrappers carry no identity of their own.
      '@graphql-eslint/strict-id-in-types': [
        'error',
        { exceptions: { types: ['PageInfo'], suffixes: ['Connection', 'Edge'] } },
      ],
    },
  },
  {
    files: ['operations/*.graphql'],
    rules: graphql.configs['flat/operations-recommended'].rules,
  },
];
