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

// Mock benny library
const mockBennyAdd = jest.fn();
const mockBennyCycle = jest.fn();
const mockBennyComplete = jest.fn();
const mockBennyRun = jest.fn(); // Mock the run function

// Define the mock suite object *once*
const mockSuiteObject = {
    add: mockBennyAdd,
    cycle: mockBennyCycle,
    complete: mockBennyComplete,
    run: mockBennyRun, // Add the mocked run function
};

const mockBennySuite = jest.fn().mockImplementation((_name, ...args) => {
    // Simulate benny collecting the add/cycle/complete calls implicitly
    // The main goal is to return the mockSuiteObject which the runner script interacts with.
    return mockSuiteObject;
});

// Use jest.mock for benny - this replaces the actual module
jest.mock('benny', () => ({
    suite: mockBennySuite,
    add: mockBennyAdd,
    cycle: mockBennyCycle,
    complete: mockBennyComplete,
    // Note: We don't need to export 'run' from the top-level mock,
    // as the runner calls suite(...).run()
}), { virtual: true }); // virtual: true might be needed if benny isn't directly in node_modules sometimes

// --- Helper Function ---
// Helper function to run the script in the current context by requiring it
const runBenchmarkRunner = (args: string[] = []) => {
    process.argv = ['node', 'benchmarkRunner.js', ...args];
    // Use jest.isolateModules to ensure a fresh run of the script
    // This is generally preferred over jest.resetModules() for this pattern.
    let thrownError: Error | null = null;
    try {
        jest.isolateModules(() => {
            require('../utils/benchmarkRunner.ts');
        });
    } catch (e: any) {
        // Catch the simulated process.exit error or other errors
        thrownError = e;
        if (!e.message.startsWith('process.exit')) {
            // Re-throw unexpected errors for debugging
            console.error("Unexpected error during benchmark runner execution:", e);
            throw e;
        }
    }
    // Return the error if process.exit was called
    return thrownError;
};

// --- Test Suite ---

describe('Benchmark Runner Script', () => {

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        // Set default mock behaviors
        mockExistsSync.mockReturnValue(true);
        mockResolve.mockImplementation((p) => p);
    });

    afterAll(() => {
        // Restore original process methods
        process.argv = originalArgv;
        process.exit = originalExit; // Make sure to restore exit
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
    });

    it('should exit with error if no functions file path is provided', () => {
        const error = runBenchmarkRunner([]);
        expect(mockConsoleError).toHaveBeenCalledWith('BENCHMARK_ERROR: No functions file path provided.');
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(error?.message).toContain('process.exit(1)');
    });

    it('should exit with error if functions file does not exist', () => {
        mockExistsSync.mockReturnValue(false);
        const testPath = 'nonexistent/file.js';
        const error = runBenchmarkRunner([testPath]);
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockConsoleError).toHaveBeenCalledWith(`BENCHMARK_ERROR: Functions file not found: ${testPath}`);
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(error?.message).toContain('process.exit(1)');
    });

    it('should successfully load functions, run benchmark, and output results', () => {
        const testPath = 'valid/functions.js';
        // Define function code strings instead of mock functions
        const originalFnCode = 'function originalFn(data) { return data.input * 2; }';
        const alternative1FnCode = 'function alternative1Fn(data) { return data.input + data.input; }';
        const mockTestData = [{ input: 1, expected: 2 }]; // Provide some test data structure
        const mockImplementations = {
             // Use actual function names as keys if runner expects them
             'Original': originalFnCode, 
             'Alternative 1': alternative1FnCode // Key name might need adjustment based on runner script logic
        };

        // --- Mock the dynamically required file ---
        // Provide code strings in implementations
        jest.doMock(testPath, () => ({
            implementations: mockImplementations,
            testData: mockTestData,
        }), { virtual: true });

        // Capture the complete callback to simulate benny finishing
        let completeCallback: Function | null = null;
        mockBennyComplete.mockImplementation((callback: Function) => {
            completeCallback = callback;
            return mockSuiteObject; // Return suite for chaining
        });

        // --- Run the script ---
        const error = runBenchmarkRunner([testPath]);

        // --- Assertions ---
        expect(error).toBeNull(); // Should not exit with error
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockBennySuite).toHaveBeenCalledTimes(1);
        expect(mockBennySuite).toHaveBeenCalledWith('Benchmark Suite', expect.any(Function), expect.any(Function), expect.any(Function)); // Check if cycle/complete are passed

        // Check that benny.add was called for each function
        expect(mockBennyAdd).toHaveBeenCalledTimes(2);
        expect(mockBennyAdd).toHaveBeenCalledWith('Original', expect.any(Function));
        expect(mockBennyAdd).toHaveBeenCalledWith('Alternative 1', expect.any(Function));

        // Check that cycle and complete were configured
        expect(mockBennyCycle).toHaveBeenCalledTimes(1);
        expect(mockBennyComplete).toHaveBeenCalledTimes(1);

        // Check that the suite was run
        expect(mockBennyRun).toHaveBeenCalledTimes(1);

        // Simulate the completion callback being invoked by Benny
        expect(completeCallback).not.toBeNull();
        if (completeCallback) {
            const fakeSummary = {
                results: [
                    { name: 'Original', ops: 100, margin: 5 },
                    { name: 'Alternative 1', ops: 120, margin: 5 }
                ],
                fastest: { name: 'Alternative 1' }, // Benny summary format might vary slightly
                slowest: { name: 'Original' }
            };
            (completeCallback as Function)(fakeSummary); // Call the captured callback
        }

        // Check console output for results
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('BENCHMARK RESULTS'));
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('RESULTS_JSON:'));
        const resultsOutput = mockConsoleLog.mock.calls.find(call => call[0].startsWith('RESULTS_JSON:'))?.[0];
        expect(resultsOutput).toBeDefined();
        const parsedResult = JSON.parse(resultsOutput!.substring('RESULTS_JSON:'.length)); // Use non-null assertion
        expect(parsedResult).toEqual(expect.objectContaining({
            results: expect.arrayContaining([
                expect.objectContaining({ name: 'Original' }), // Check name only, ops vary
                expect.objectContaining({ name: 'Alternative 1' }) // Check name only
            ]),
            fastest: expect.any(String) // Fastest can vary, just check type
        }));

        // Clean up the mock for the dynamic require
        jest.dontMock(testPath);
        jest.resetModules(); // Ensure clean state for next test
    });

    it('should exit with error if functions file fails to load (require error)', () => {
        const testPath = 'invalid/load-error.js';
        const loadError = new Error('Cannot find module \'invalid/load-error.js\'');

        // Mock the dynamic require itself to throw an error
        // Need to mock the module containing the require call if isolateModules isn't enough
        // For simplicity, let's refine the helper or mock require directly here.
        const originalRequire = require;
        jest.mock('../utils/benchmarkRunner.ts', () => {
            // Mock the module that *calls* require(absolutePath)
            const actualRunner = jest.requireActual('../utils/benchmarkRunner.ts');
            // Find where require(absolutePath) is called and make it throw
            // This is complex, let's try mocking require globally temporarily
            const path = require('path');
            const fs = require('fs');

            // Check arguments provided to the script
            if (process.argv.length < 3) {
                console.error('BENCHMARK_ERROR: No functions file path provided.');
                process.exit(1);
            }
            const relativePath = process.argv[2];
            const absolutePath = path.resolve(relativePath);

            // Check if file exists
            if (!fs.existsSync(absolutePath)) {
                console.error(`BENCHMARK_ERROR: Functions file not found: ${absolutePath}`);
                process.exit(1);
            }

            // Simulate require failure for this specific path
             if (absolutePath === path.resolve(testPath)) { // Use resolved path for comparison
                 throw loadError;
             }
            // Allow other requires
            return {}; // Return empty object or handle other requires if needed
        });

        const error = runBenchmarkRunner([testPath]);

        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining(`BENCHMARK_ERROR: Failed to load functions from ${testPath}`));
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining(`Cannot find module 'invalid/load-error.js'`));
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(error?.message).toContain('process.exit(1)');

        // Restore original require behavior
        jest.unmock('../utils/benchmarkRunner.ts'); // Unmock the script itself
    });


    it('should exit with error if no valid benchmark functions are found', () => {
        const testPath = 'valid/no-functions.js';
        const mockImplementations = {}; // Empty implementations object
        const mockTestData = {}; // Include testData to pass initial checks

        // Mock the dynamically required file - Return empty implementations
        jest.doMock(testPath, () => ({
            implementations: mockImplementations,
            testData: mockTestData
        }), { virtual: true });

        const error = runBenchmarkRunner([testPath]);

        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        // The error message should now reflect the lack of specific functions
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining(`BENCHMARK_ERROR: No valid benchmark functions (originalFn or alternative*Fn) found in ${testPath}`));
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(error?.message).toContain('process.exit(1)');
        expect(mockBennySuite).not.toHaveBeenCalled(); // Ensure benchmark didn't start

        // Clean up the mock
        jest.dontMock(testPath);
    });

    it('should run successfully even if testData is missing', () => {
        const testPath = 'valid/no-testdata.js';
        // Define function code string
        const originalFnCode = 'function originalFn() { let x = 0; for(let i=0; i<1000; i++) x++; return x; }'; // Function that doesn't need data
        const mockImplementations = {
             'Original': originalFnCode
             // No alternatives needed for this specific test focus
        };

        // Mock the dynamically required file - Missing testData export, provide code string
        jest.doMock(testPath, () => ({
            implementations: mockImplementations,
            // No testData key
        }), { virtual: true });

        // Capture complete callback
        let completeCallback: Function | null = null;
        mockBennyComplete.mockImplementation((callback: Function) => {
            completeCallback = callback;
            return mockSuiteObject;
        });

        const error = runBenchmarkRunner([testPath]);

        expect(error).toBeNull(); // Should not exit with error
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockResolve).toHaveBeenCalledWith(testPath);
        expect(mockBennySuite).toHaveBeenCalledTimes(1);
        expect(mockBennyAdd).toHaveBeenCalledTimes(1); // Only originalFn
        expect(mockBennyAdd).toHaveBeenCalledWith('Original', expect.any(Function));
        expect(mockBennyRun).toHaveBeenCalledTimes(1);

        // Simulate completion
        expect(completeCallback).not.toBeNull();
        if (completeCallback) {
            const fakeSummary = {
                results: [{ name: 'Original', ops: 90 }], // Margin might not be present
                // No fastest/slowest needed if only one result
            };
            (completeCallback as Function)(fakeSummary);
        }

        // Check console output for results
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('RESULTS_JSON:'));
        const resultsOutput = mockConsoleLog.mock.calls.find(call => call[0].startsWith('RESULTS_JSON:'))?.[0];
        expect(resultsOutput).toBeDefined();
        const parsedResult = JSON.parse(resultsOutput!.substring('RESULTS_JSON:'.length));
        expect(parsedResult).toEqual(expect.objectContaining({
            results: expect.arrayContaining([
                expect.objectContaining({ name: 'Original' })
            ]),
            fastest: 'Original' // If only one, it should be fastest
        }));

        // Clean up the mock
        jest.dontMock(testPath);
        jest.resetModules(); // Ensure clean state for next test
    });

}); 