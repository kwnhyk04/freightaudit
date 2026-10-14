import { contract, integration, unit } from '@freightaudit/config/jest';

// The three Jest projects across every workspace. pnpm test runs unit per package through Turborepo, cached;
// pnpm test:int runs integration and contract here in one process, so their containers start once.
const roots = ['<rootDir>/apps', '<rootDir>/packages', '<rootDir>/evals'];

export default {
  projects: [unit, integration, contract].map((project) => ({ ...project, rootDir: import.meta.dirname, roots })),
  // A global option: Jest ignores it inside a project.
  testTimeout: 60_000,
};
