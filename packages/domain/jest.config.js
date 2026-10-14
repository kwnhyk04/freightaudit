import unit from '@freightaudit/config/jest';

// The audit's money math: a run below 90 % coverage fails.
export default {
  ...unit,
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageReporters: ['text'],
  coverageThreshold: { global: { branches: 90, functions: 90, lines: 90, statements: 90 } },
};
