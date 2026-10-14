import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(import.meta.resolve(path));

// ESM + TypeScript via swc. Run jest with --experimental-vm-modules.
const base = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+[.]ts$': [here('@swc/jest'), { jsc: { parser: { syntax: 'typescript' }, target: 'es2024' } }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFiles: [here('./jest-realm.js')],
};

// unit: *.test.ts without I/O; a guard fails any test that opens a socket or starts a process. Each package runs it
// through turbo run test, so results are cached per package.
export const unit = {
  ...base,
  displayName: 'unit',
  testPathIgnorePatterns: [...base.testPathIgnorePatterns, '[.](int|contract)[.]test[.]ts$'],
  setupFilesAfterEnv: [here('./jest-no-io.js')],
};
export default unit;

// integration (*.int.test.ts) and contract (*.contract.test.ts) run from the root jest.config.js in one process
// (pnpm test:int), against containers that start once per run.
const containers = {
  ...base,
  globalSetup: here('./jest-containers.js'),
  globalTeardown: here('./jest-containers-stop.js'),
};
export const integration = { ...containers, displayName: 'integration', testMatch: ['**/*.int.test.ts'] };
export const contract = { ...containers, displayName: 'contract', testMatch: ['**/*.contract.test.ts'] };
