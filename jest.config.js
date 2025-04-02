/**
 * Jest configuration file for PerfCopilot
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/src/__tests__/**/*.test.ts'],
    collectCoverage: true,
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/test/**',
        '!**/node_modules/**',
    ],
    coverageReporters: ['text', 'lcov'],
    testTimeout: 10000,
    verbose: true,
    moduleFileExtensions: ['ts', 'js', 'json'],
    globals: {
        'ts-jest': {
            tsconfig: 'tsconfig.json',
        },
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Handling the vscode module which is not available in the test environment
    transformIgnorePatterns: [
        'node_modules/(?!(vscode)/)',
    ],
}; 