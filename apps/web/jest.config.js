import unit from '@freightaudit/config/jest';

// Unit tests of the web's pure modules; e2e/ holds the Playwright specs, which Playwright runs.
export default { ...unit, testPathIgnorePatterns: [...unit.testPathIgnorePatterns, '/e2e/', '/[.]next/'] };
