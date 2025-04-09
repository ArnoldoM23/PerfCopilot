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

    it('should successfully load functions, run benchmark, and output results', () => {
        jest.resetModules(); // Reset modules first

        // Mock dependencies AFTER reset
        const fs = require('fs');
        const path = require('path');
        const benny = require('benny');

        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const mockResolve = jest.spyOn(path, 'resolve').mockImplementation((fp) => fp); // Keep simple resolve mock

        // Mock console and process.exit
        const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });

        // Mock the benny functions AFTER reset and require
        // Remove original function references - we only need spies
        // const bennyAdd = benny.add; // REMOVE
        // const bennyCycle = benny.cycle; // REMOVE
        // const bennyComplete = benny.complete; // REMOVE

        // Create spies on the mocked functions
        const mockBennyAdd = jest.spyOn(benny, 'add');

        // We need to capture callbacks to simulate their execution
        let completeCallback: Function | null = null;
        let cycleCallback: Function | null = null; // Declare cycleCallback

        const mockBennyComplete = jest.spyOn(benny, 'complete').mockImplementation((callback: any) => {
           if (typeof callback === 'function') {
                completeCallback = callback; // Capture the callback
           }
           // Return the mock suite object itself to allow chaining like benny does
           // (or a simple mock function if chaining isn't strictly needed after complete)
           return mockSuiteObject; // Return the mock suite object
        });

        const mockBennyCycle = jest.spyOn(benny, 'cycle').mockImplementation((callback: any) => {
            if (typeof callback === 'function') {
                cycleCallback = callback; // Capture cycle callback
            }
            // Return the mock suite object itself to allow chaining
            return mockSuiteObject; // Return the mock suite object
        });

        // Define the mock suite object *once*
        const mockSuiteObject = {
            add: mockBennyAdd,      // Use spy
            cycle: mockBennyCycle,    // Use spy
            complete: mockBennyComplete, // Use spy
            run: jest.fn(), // Mock the run function if the runner calls it
        };

        // Simplify the mockBennySuite implementation
        const mockBennySuite = jest.spyOn(benny, 'suite').mockImplementation((_suiteName, ..._args) => {
            // The runner calls benny.suite('name', benny.add(...), benny.cycle(...), benny.complete(...))
            // We just need to return the object that provides the mocked add/cycle/complete methods.
            return mockSuiteObject;
        });

        // --- Mock the dynamically required file ---
        const testPath = 'valid/functions.js';
        const mockOriginalFn = jest.fn();
        const mockAlternative1Fn = jest.fn();
        const mockTestData = { data: 'sample' };

        jest.doMock(testPath, () => ({
            originalFn: mockOriginalFn,
            alternative1Fn: mockAlternative1Fn,
            testData: mockTestData,
        }), { virtual: true }); // virtual: true allows mocking non-existent paths

        // --- Run the script ---
        runBenchmarkRunner([testPath]);

        // --- Assertions ---
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockBennySuite).toHaveBeenCalledTimes(1);

        // Check that benny.add was called for each function
        expect(mockBennyAdd).toHaveBeenCalledTimes(2);
        expect(mockBennyAdd).toHaveBeenCalledWith('Original', expect.any(Function));
        expect(mockBennyAdd).toHaveBeenCalledWith('Alternative 1', expect.any(Function));

        // Simulate the completion callback being invoked by Benny
        expect(mockBennyComplete).toHaveBeenCalledTimes(1);
        expect(completeCallback).not.toBeNull();
        if (typeof completeCallback === 'function') { // Use typeof for type guard
            const callbackToRun = completeCallback; // Assign to new variable
            // Simulate benny providing results to the callback
             const fakeSummary = {
                 results: [
                     { name: 'Original', ops: 100 },
                     { name: 'Alternative 1', ops: 120 }
                 ]
             };
            // @ts-ignore - Compiler struggles with type inference after complex mocking
            (callbackToRun as Function)(fakeSummary); // Cast and call
        }

        // Check console output for results
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('RESULTS_JSON:'));
        const resultsOutput = mockConsoleLog.mock.calls.find(call => call[0].startsWith('RESULTS_JSON:'))?.[0];
        expect(resultsOutput).toBeDefined();
        const parsedResult = JSON.parse(resultsOutput!.substring('RESULTS_JSON: '.length));
        expect(parsedResult).toEqual({
            results: [
                { name: 'Original', ops: 100 },
                { name: 'Alternative 1', ops: 120 }
            ],
            fastest: 'Alternative 1' // Based on fakeSummary ops
        });
        
        // Ensure no errors were logged and process didn't exit
        expect(mockConsoleError).not.toHaveBeenCalled();
        expect(mockProcessExit).not.toHaveBeenCalled();

        // Clean up the mock for the specific path
        jest.dontMock(testPath);
    });

    it('should exit with error if functions file fails to load (require error)', () => {
        jest.resetModules();

        const fs = require('fs');
        const path = require('path');

        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const mockResolve = jest.spyOn(path, 'resolve').mockImplementation((fp) => fp);
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });

        const testPath = 'invalid/load-error.js';
        const loadError = new Error("Syntax Error!");

        // Mock the require call itself to throw an error for this path
        jest.doMock(testPath, () => {
            throw loadError;
        }, { virtual: true });

        runBenchmarkRunner([testPath]);

        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining(`BENCHMARK_ERROR: Failed to load functions from ${testPath}: ${loadError}`));
        expect(mockProcessExit).toHaveBeenCalledWith(1);

        jest.dontMock(testPath);
    });

    it('should exit with error if no valid benchmark functions are found', () => {
        jest.resetModules();

        const fs = require('fs');
        const path = require('path');
        const benny = require('benny'); // Need benny for its spies

        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const mockResolve = jest.spyOn(path, 'resolve').mockImplementation((fp) => fp);
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });
        // Spy on benny suite just to ensure it's NOT called
        const mockBennySuite = jest.spyOn(benny, 'suite');


        const testPath = 'valid/no-functions.js';

        // Mock the file to have testData but no valid functions
        jest.doMock(testPath, () => ({
            testData: 'some data',
            helperFunction: () => {}
        }), { virtual: true });

        runBenchmarkRunner([testPath]);

        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining(`BENCHMARK_ERROR: No valid benchmark functions (originalFn, alternative*Fn) found in ${testPath}`));
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(mockBennySuite).not.toHaveBeenCalled(); // Ensure benchmark didn't start

        jest.dontMock(testPath);
    });

    it('should run successfully even if testData is missing', () => {
        jest.resetModules();

        const fs = require('fs');
        const path = require('path');
        const benny = require('benny');

        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const mockResolve = jest.spyOn(path, 'resolve').mockImplementation((fp) => fp);
        const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code?: number): never => {
            throw new Error(`process.exit(${code ?? ''}) called`);
        });

        const mockBennyAdd = jest.spyOn(benny, 'add');
        let completeCallback: Function | null = null;
        const mockBennyComplete = jest.spyOn(benny, 'complete').mockImplementation((callback: any) => { // Added :any type here
            if (typeof callback === 'function') { // Added check
                 completeCallback = callback;
            }
            return callback;
        });
        // Get the original mocked functions too
        const bennyAdd = benny.add;
        const bennyComplete = benny.complete;

        const mockBennySuite = jest.spyOn(benny, 'suite').mockImplementation((_suiteName, ...args) => {
             args.forEach(arg => {
                 if (typeof arg === 'function' && arg === completeCallback) {
                     bennyComplete(arg); // Call original mocked bennyComplete
                 } else if (arg !== null && typeof arg === 'object' && 'name' in arg && typeof arg.name === 'string' && 'fn' in arg && typeof arg.fn === 'function') { // Added type guard
                     bennyAdd(arg.name, arg.fn); // Call original mocked bennyAdd
                 }
             });
             return {};
         });

        const testPath = 'valid/no-test-data.js';
        const mockOriginalFn = jest.fn(); // Function that doesn't need data

        jest.doMock(testPath, () => ({
            originalFn: mockOriginalFn,
            // No testData exported
        }), { virtual: true });

        runBenchmarkRunner([testPath]);

        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockBennySuite).toHaveBeenCalledTimes(1);
        expect(mockBennyAdd).toHaveBeenCalledTimes(1);
        expect(mockBennyAdd).toHaveBeenCalledWith('Original', expect.any(Function));

        // Check that the function added to Benny is callable (with undefined data)
        const bennyFnWrapper = mockBennyAdd.mock.calls[0][1] as Function; // Cast to Function
        expect(bennyFnWrapper).toBeDefined();
        expect(() => bennyFnWrapper()).not.toThrow(); // Execute the wrapper
        expect(mockOriginalFn).toHaveBeenCalledWith(undefined); // Verify underlying fn called with undefined


        // Simulate completion
        expect(completeCallback).not.toBeNull();
        if (typeof completeCallback === 'function') { // Use typeof for type guard
            const callbackToRun = completeCallback; // Assign to new variable
            const fakeSummary = { results: [{ name: 'Original', ops: 50 }] };
            // @ts-ignore - Compiler struggles with type inference after complex mocking
            (callbackToRun as Function)(fakeSummary); // Cast and call
        }

        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('RESULTS_JSON:'));
        expect(mockConsoleError).not.toHaveBeenCalled();
        expect(mockProcessExit).not.toHaveBeenCalled();

        jest.dontMock(testPath);
    });

}); 