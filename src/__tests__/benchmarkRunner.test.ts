import * as fs from 'fs';
import * as vm from 'vm';
import * as path from 'path';
// Import benny for types, but mock implementation follows
import benny from 'benny';
import { executeBenchmarkSuite, BenchmarkModuleData } from '../utils/benchmarkRunner';

// Mock vm (top-level functions used during benchmark execution)
jest.mock('vm', () => ({
    ...jest.requireActual('vm'), // Keep real vm for Script class
    createContext: jest.fn((init) => init || {}),
    runInContext: jest.fn(() => jest.fn()), // Default: return a dummy function
}));

// FIX: Correctly structure the mock for require('benny') usage
jest.mock('benny', () => {
    const mockAddFn = jest.fn();
    const mockCycleFn = jest.fn();
    const mockCompleteFn = jest.fn();
    const mockSuiteFn = jest.fn();

    // The object representing the chained state returned by suite() etc.
    const mockChain = {
        add: mockAddFn,
        cycle: mockCycleFn,
        complete: mockCompleteFn,
    };

    // Configure mock implementations for chaining
    mockAddFn.mockImplementation(() => mockChain);
    mockCycleFn.mockImplementation(() => mockChain);
    mockCompleteFn.mockImplementation((callback: (summary: any) => void) => {
        const mockSummary = { results: [{ name: 'Original', ops: 100 }, { name: 'Alternative_1', ops: 200 }] };
        if (typeof callback === 'function') { callback(mockSummary); }
        return mockChain; // Return chain for consistency
    });
    mockSuiteFn.mockImplementation(() => mockChain); // suite() starts the chain

    // This is the object that `require('benny')` will return in tests
    const mockBennyObject = {
        suite: mockSuiteFn,
        add: mockAddFn,         // Directly expose add
        cycle: mockCycleFn,       // Directly expose cycle
        complete: mockCompleteFn,   // Directly expose complete
        __esModule: true,        // Keep for ESM compatibility if needed elsewhere
        // Expose mocks for testing
        __mockSuiteFn: mockSuiteFn,
        __mockAddFn: mockAddFn,
        __mockCycleFn: mockCycleFn,
        __mockCompleteFn: mockCompleteFn,
    };

    return mockBennyObject;
});


// Define spy variables outside describe, initialize in beforeEach
let mockExit: jest.SpyInstance;
let mockConsoleLog: jest.SpyInstance;
let mockConsoleError: jest.SpyInstance;

describe('Benchmark Runner Script - executeBenchmarkSuite', () => {

    beforeEach(() => {
        jest.clearAllMocks();

        // Clear Benny mocks using internal references
        // Use require here to mimic the module, or cast the import
        const bennyMock = require('benny'); 
        // const bennyMock = benny as any; // Alternative if import resolves
        if (bennyMock.__mockSuiteFn) { bennyMock.__mockSuiteFn.mockClear(); }
        if (bennyMock.__mockAddFn) { bennyMock.__mockAddFn.mockClear(); }
        if (bennyMock.__mockCycleFn) { bennyMock.__mockCycleFn.mockClear(); }
        if (bennyMock.__mockCompleteFn) { bennyMock.__mockCompleteFn.mockClear(); }

        // Clear VM mocks
        (vm.createContext as jest.Mock).mockClear();
        (vm.runInContext as jest.Mock).mockClear(); 

        // --- Set Default Implementations --- 
        // Benny complete default
        if (bennyMock.__mockCompleteFn) { 
            bennyMock.__mockCompleteFn.mockImplementation((callback: (summary: any) => void) => {
                const mockSummary = { results: [{ name: 'Original', ops: 100 }, { name: 'Alternative_1', ops: 200 }] };
                if (typeof callback === 'function') { callback(mockSummary); }
                // Return the chain object itself from the mock object, not a new one
                return { add: bennyMock.__mockAddFn, cycle: bennyMock.__mockCycleFn, complete: bennyMock.__mockCompleteFn }; 
            });
        }
        // VM defaults
        (vm.createContext as jest.Mock).mockImplementation((init) => init || {});
        (vm.runInContext as jest.Mock).mockImplementation(() => jest.fn()); // Default: return dummy fn

        // --- Initialize Spies --- 
        mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
            throw new Error(`process.exit called with code ${code}`);
        });
        mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });


    it('should execute successfully with valid module data', async () => {
        // Arrange: Create module data
        const mockImplementations = {
            'Original': 'function Original(data) { /* do stuff */ }',
            'Alternative_1': 'function Alternative_1(data) { /* do other stuff */ }'
        };
        const mockTestData = [[1, 2], [3, 4]];
        const mockEntryPoint = 'Original';
        const mockModuleData: BenchmarkModuleData = {
            implementations: mockImplementations,
            testData: mockTestData,
            entryPointName: mockEntryPoint
        };

        // Arrange: Define mocks for execution phase (vm, benny)
        const mockOriginalFn = jest.fn();
        const mockAlt1Fn = jest.fn();
        (vm.runInContext as jest.Mock).mockImplementation((code, context, options) => {
             if (typeof options === 'object' && options?.timeout === 1000) { // Definition call
                 if (code === mockImplementations.Original) { context[mockEntryPoint] = mockOriginalFn; }
                 else if (code === mockImplementations.Alternative_1) { context[mockEntryPoint] = mockAlt1Fn; }
                 else { context[mockEntryPoint] = jest.fn(); }
                 return;
             }
             if (code === mockEntryPoint) { return context[mockEntryPoint]; } // Lookup call
             return jest.fn(); 
         });

        let capturedBenchFns: { [key: string]: () => void } = {};
        const bennyMock = require('benny'); // Get the mock object
        // Access the internal mock function for configuration/assertion
        bennyMock.__mockAddFn.mockImplementation((name: string, fn: () => void) => {
            capturedBenchFns[name] = fn;
            // Return the mock object itself for chaining
             return { add: bennyMock.__mockAddFn, cycle: bennyMock.__mockCycleFn, complete: bennyMock.__mockCompleteFn }; 
        });

        // Act
        await executeBenchmarkSuite(mockModuleData); 

        // Assert Setup (Benny setup) - Use internal mocks for assertions
        expect(bennyMock.__mockSuiteFn).toHaveBeenCalledTimes(1);
        expect(bennyMock.__mockAddFn).toHaveBeenCalledTimes(2);
        expect(bennyMock.__mockAddFn).toHaveBeenCalledWith('Original', expect.any(Function));
        expect(bennyMock.__mockAddFn).toHaveBeenCalledWith('Alternative_1', expect.any(Function));
        expect(bennyMock.__mockCycleFn).toHaveBeenCalledTimes(1);
        expect(bennyMock.__mockCompleteFn).toHaveBeenCalledTimes(1);
        expect(capturedBenchFns['Original']).toBeDefined();
        expect(capturedBenchFns['Alternative_1']).toBeDefined();

        // Assert Execution (Simulate benny running functions)
        capturedBenchFns['Original']();
        capturedBenchFns['Alternative_1']();
        expect(vm.createContext).toHaveBeenCalledTimes(2); 
        expect(vm.runInContext).toHaveBeenCalledTimes(4); // 2x def, 2x lookup
        expect(mockOriginalFn).toHaveBeenCalledTimes(1);
        expect(mockOriginalFn).toHaveBeenCalledWith(mockTestData);
        expect(mockAlt1Fn).toHaveBeenCalledTimes(1);
        expect(mockAlt1Fn).toHaveBeenCalledWith(mockTestData);

        // Assert Output
        const logCalls = mockConsoleLog.mock.calls;
        const resultsJsonCall = logCalls.find(call => typeof call[0] === 'string' && call[0].startsWith('RESULTS_JSON:'));
        expect(resultsJsonCall).toBeDefined();
        const parsedResult = JSON.parse(resultsJsonCall![0].substring('RESULTS_JSON: '.length));
        expect(parsedResult).toEqual({
            results: [{ name: 'Original', ops: 100 }, { name: 'Alternative_1', ops: 200 }],
            fastest: 'Alternative_1'
        });
        expect(mockExit).not.toHaveBeenCalled();
    });

    it('should log error but continue if vm execution fails within a benchmark case', async () => {
        // Arrange: Create module data
        const mockImplementations = {
            'Original': 'function Original(data) { return data; }',
            'Alternative_1': 'function Alternative_1(data) { throw new Error("VM Run Error!"); }'
        };
        const mockTestData = [[1]];
        const mockEntryPoint = 'Original';
        const mockModuleData: BenchmarkModuleData = {
            implementations: mockImplementations,
            testData: mockTestData,
            entryPointName: mockEntryPoint
        };

        // Arrange: Define mocks for execution phase (vm, benny)
        const mockOriginalFnThatWorks = jest.fn();
        const mockAlt1FnThatThrows = jest.fn(() => { throw new Error("VM Run Error!"); });
        (vm.runInContext as jest.Mock).mockImplementation((code, context, options) => {
             if (typeof options === 'object' && options?.timeout === 1000) { // Definition call
                 if (code === mockImplementations.Original) { context[mockEntryPoint] = mockOriginalFnThatWorks; }
                 else if (code === mockImplementations.Alternative_1) { context[mockEntryPoint] = mockAlt1FnThatThrows;} 
                 return;
             }
             if (code === mockEntryPoint) { return context[mockEntryPoint]; } // Lookup call
             return jest.fn();
         });

        // Arrange: Mock benny.add to call function directly
        const bennyMock = require('benny');
        bennyMock.__mockAddFn.mockImplementation((name: string, fn: () => void) => {
            try {
                 fn(); // Simulate benny running the test function
             } catch (e) {
                 // Allow errors to propagate naturally for assertion
             }
             // Return the mock object itself for chaining
             return { add: bennyMock.__mockAddFn, cycle: bennyMock.__mockCycleFn, complete: bennyMock.__mockCompleteFn }; 
        });

        // Arrange: Mock benny.complete to only include the successful result
        bennyMock.__mockCompleteFn.mockImplementation((callback: (summary: any) => void) => {
            const mockSummary = { results: [{ name: 'Original', ops: 100 }] }; // Alt_1 error means it's excluded
            if (typeof callback === 'function') { callback(mockSummary); }
             // Return the mock object itself for chaining
             return { add: bennyMock.__mockAddFn, cycle: bennyMock.__mockCycleFn, complete: bennyMock.__mockCompleteFn }; 
        });

        // Act
        await executeBenchmarkSuite(mockModuleData); 

        // Assert
        expect(mockExit).not.toHaveBeenCalled();
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('BENCHMARK_EXECUTION_ERROR [Alternative_1]: VM Run Error!'));
        // Check output reflects only the successful run
        const logCalls = mockConsoleLog.mock.calls;
        const resultsJsonCall = logCalls.find(call => typeof call[0] === 'string' && call[0].startsWith('RESULTS_JSON:'));
        expect(resultsJsonCall).toBeDefined();
        expect(resultsJsonCall![0]).toContain('"name":"Original"');
        expect(resultsJsonCall![0]).not.toContain('"name":"Alternative_1"');
        expect(resultsJsonCall![0]).toContain('"fastest":"Original"'); // Original is now fastest
    });

    // Add more tests for executeBenchmarkSuite if needed, e.g.:
    // - Handling errors during benny.suite setup (throw from benny.__mockSuiteFn)

});
