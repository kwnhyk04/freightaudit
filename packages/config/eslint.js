import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/.next/', '**/next-env.d.ts', '**/generated/', '**/playwright-report/']),
  // Scoped to code files so other languages, such as GraphQL, bring their own parser and rules.
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'], extends: [js.configs.recommended, tseslint.configs.recommended] },
);

// Opt-in for pure packages: relative imports only, so no I/O module is reachable.
export const pure = {
  files: ['**/*.ts'],
  ignores: ['**/*.test.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [{ regex: '^(?![.][.]?/)', message: 'Pure code: relative imports only (no I/O, no packages).' }] },
    ],
    'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'Pure code: no dynamic import().' }],
  },
};
