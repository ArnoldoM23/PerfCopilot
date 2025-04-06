import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process'; // Needed for mocking require

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('benny');

// Keep track of original process methods
const originalArgv = process.argv;
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// --- Mock Implementations ---

// Mock fs.existsSync
const mockExistsSync = jest.spyOn(fs, 'existsSync');

// Mock path.resolve
const mockResolve = jest.spyOn(path, 'resolve').mockImplementation((filePath) => filePath); // Simple pass-through

// Mock console
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit - throw error to stop execution and allow assertions
const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
    throw new Error(`process.exit(${code ?? ''}) called`);
});

// Mock benny library (very basic for now)
const mockBennyAdd = jest.fn();
const mockBennyCycle = jest.fn();
const mockBennyComplete = jest.fn();
const mockBennySuite = jest.fn().mockImplementation((_name, ...args) => {
    // Find the 'complete' callback and store it if needed for later tests
    const completeCallback = args.find(arg => typeof arg === 'function' && arg.name === 'completeCallback'); 
    // Simulate adding cases
    args.forEach(arg => {
        if (typeof arg === 'object' && arg.name && arg.fn) { // Simple check for add calls
            mockBennyAdd(arg.name, arg.fn);
        }
    });
    return { // Return a mock suite object if needed
        add: mockBennyAdd,
        cycle: mockBennyCycle,
        complete: mockBennyComplete,
    };
});
jest.mock('benny', () => ({
    suite: mockBennySuite,
    add: mockBennyAdd,
    cycle: mockBennyCycle,
    complete: mockBennyComplete,
}));

// Helper function to run the script in the current context by requiring it
// This bypasses needing a separate child process for most tests
const runBenchmarkRunner = (args: string[] = []) => {
    process.argv = ['node', 'benchmarkRunner.js', ...args]; // Set mocked argv
    // Clear require cache to ensure the script runs fresh each time
    // jest.resetModules(); // REMOVED FROM HERE
    try {
        require('../utils/benchmarkRunner.ts');
    } catch (e: any) {
        // Catch the simulated process.exit error
        if (!e.message.startsWith('process.exit')) {
            throw e; // Re-throw other errors
        }
    }
};


// --- Test Suite ---

describe('Benchmark Runner Script', () => {

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        // Default mock implementations (will be overridden if resetModules is called)
        // mockExistsSync.mockReturnValue(true); // We'll set this up after reset in tests that need it
    });

    afterAll(() => {
        // Restore original process methods after all tests
        process.argv = originalArgv;
        process.exit = originalExit;
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
    });

    // --- Tests will go here ---

    it('should exit with error if no functions file path is provided', () => {
        // This test doesn't involve fs.existsSync, so simpler setup is okay.
        jest.resetModules(); // Reset modules
        // Re-establish spies needed for this test AFTER reset
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });

        runBenchmarkRunner([]);
        expect(mockConsoleError).toHaveBeenCalledWith('BENCHMARK_ERROR: No functions file path provided.');
        expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should exit with error if functions file does not exist', () => {
        jest.resetModules(); // Reset modules first

        // Re-require 'fs' and setup spy AFTER reset
        const fs = require('fs');
        const mockExistsSync = jest.spyOn(fs, 'existsSync');
        mockExistsSync.mockReturnValue(false); // Configure for this test

        // Re-establish other needed spies AFTER reset
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });

        const testPath = 'nonexistent/file.js';
        runBenchmarkRunner([testPath]); // Run the script (now without internal reset)

        // Assertions remain the same
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockConsoleError).toHaveBeenCalledWith(`BENCHMARK_ERROR: Functions file not found: ${testPath}`);
        expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    // Add more tests for other scenarios (loading errors, no functions, success case, etc.)

}); 