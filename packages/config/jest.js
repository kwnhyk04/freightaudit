import { fileURLToPath } from 'node:url';

// ESM + TypeScript via swc. Run jest with --experimental-vm-modules. *.int.test.ts is reserved for test:int.
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+[.]ts$': [
      fileURLToPath(import.meta.resolve('@swc/jest')),
      { jsc: { parser: { syntax: 'typescript' }, target: 'es2024' } },
    ],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '[.]int[.]test[.]ts$'],
  setupFiles: [fileURLToPath(import.meta.resolve('./jest-realm.js'))],
};
