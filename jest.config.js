module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            isolatedModules: true,
            diagnostics: false
        }]
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    setupFiles: ['<rootDir>/src/test/setup.ts'],
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/test/vscode.mock.ts'
    }
}; 