/** @type {import('jest').Config} */
const shared = {
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/support/test-env.ts'],
};

/**
 * `unit` needs nothing external. `database` (integration, module-init, e2e) needs a reachable
 * PostgreSQL; its schema is recreated from migrations by test/support/global-setup.ts.
 */
module.exports = {
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...shared,
      displayName: 'database',
      testMatch: [
        '<rootDir>/test/integration/**/*.spec.ts',
        '<rootDir>/test/module-init/**/*.spec.ts',
        '<rootDir>/test/e2e/**/*.spec.ts',
      ],
    },
  ],
};
