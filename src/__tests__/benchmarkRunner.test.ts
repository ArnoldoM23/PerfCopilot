// import { executeBenchmarkSuite, BenchmarkResult } from '../utils/benchmarkRunner';
// import * as fs from 'fs';
// import * as vm from 'vm';
// import * as benny from 'benny';

// // Mock dependencies
// jest.mock('fs');
// jest.mock('vm');
// jest.mock('benny');

// // Type safety for mocks
// const mockFs = fs as jest.Mocked<typeof fs>;
// const mockVm = vm as jest.Mocked<typeof vm>;
// const mockBenny = benny as jest.Mocked<typeof benny>;

// describe('benchmarkRunner - executeBenchmarkSuite', () => {
//     let mockSuiteInstance: any;
//     let mockContext: any;

//     beforeEach(() => {
//         // Reset mocks before each test
//         jest.clearAllMocks();

//         // Mock Benny's fluent API
//         mockSuiteInstance = {
//             add: jest.fn().mockReturnThis(), // Return `this` to allow chaining
//             complete: jest.fn().mockImplementation((callback) => {
//                 // Simulate successful completion and invoke the callback
//                 // with mock Benny results structure
//                 const summary = {
//                     results: [
//                         { name: 'ImplementationA', ops: 1000, margin: 5 },
//                         { name: 'ImplementationB', ops: 1200, margin: 4 },
//                     ],
//                     fastest: { name: 'ImplementationB' },
//                     save: jest.fn().mockResolvedValue(undefined), // Mock the save function
//                 };
//                 callback(summary);
//                 return mockSuiteInstance; // Return this for chaining if needed after complete
//             }),
//             run: jest.fn().mockResolvedValue(undefined), // Simulate the suite running
//             on: jest.fn().mockReturnThis(), // Mock 'on' for potential event listeners
//             options: {}, // Add mock options if needed
//         };
//         mockBenny.suite.mockReturnValue(mockSuiteInstance);

//         // Mock VM context and script execution
//         mockContext = { // This object will be populated by vm.runInContext
//              module: { exports: {} },
//              require: jest.fn(),
//              console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
//              testData: [1, 2, 3], // Example test data
//              math: Math,
//         };
//         mockVm.createContext.mockReturnValue(mockContext);
//         // Simulate runInContext populating the context's module.exports
//         mockVm.runInContext.mockImplementation((scriptContent, context) => {
//              // A simplified simulation: Assume the script defines the function and testData
//              context.module.exports = {
//                  entryPointFunction: jest.fn((arr: number[]) => arr.map((x: number) => x * 2)), // Mock function
//                  testData: context.testData, // Make sure testData is set
//                  // Add mock implementations to the VM context
//                  implementations: {
//                      'ImplementationA': { code: '/* code A */' },
//                      'ImplementationB': { code: '/* code B */' },
//                  }
//              };
//              // We could potentially try to evaluate the scriptContent more realistically
//              // but for many tests, just setting the exports is enough.
//         });


//         // Mock fs.readFileSync
//         mockFs.readFileSync.mockReturnValue(
//             `// Mock module content\n` +
//             `function entryPointFunction(arr) { return arr.map(x => x * 2); }\n` +
//             `const testData = [1, 2, 3];\n`
//         ); // Return mock JS code
//     });

//     it('should execute a benchmark suite successfully and return parsed results', async () => {
//         const modulePath = '/path/to/mockModule.js';
//         const entryPointName = 'entryPointFunction';


//         // Act
//         const result = await executeBenchmarkSuite(modulePath, entryPointName);

//         // Assert
//         // Verify fs.readFileSync was called
//         expect(mockFs.readFileSync).toHaveBeenCalledWith(modulePath, 'utf-8');

//         // Verify VM setup and execution
//         expect(mockVm.createContext).toHaveBeenCalled();
//         expect(mockVm.runInContext).toHaveBeenCalled();
//         // Check if the correct function was extracted (indirectly checked by Benny add)

//         // Verify Benny suite setup
//         expect(mockBenny.suite).toHaveBeenCalledWith(entryPointName, expect.any(Function)); // Check suite name
//         // Get the number of implementations from the *mock context* after vm runs
//         const expectedImplCount = Object.keys(mockContext.module.exports.implementations).length;
//         expect(mockSuiteInstance.add).toHaveBeenCalledTimes(expectedImplCount);
//         expect(mockSuiteInstance.add).toHaveBeenCalledWith('ImplementationA', expect.any(Function));
//         expect(mockSuiteInstance.add).toHaveBeenCalledWith('ImplementationB', expect.any(Function));

//         // Verify Benny run and completion
//         expect(mockSuiteInstance.complete).toHaveBeenCalled();
//         expect(mockSuiteInstance.run).toHaveBeenCalled();

//         // Verify the structure of the returned result
//         expect(result).toEqual({
//             fastest: 'ImplementationB',
//             results: [
//                 { name: 'ImplementationA', ops: 1000, margin: 5 },
//                 { name: 'ImplementationB', ops: 1200, margin: 4 },
//             ],
//         });
//     });

//     // Add more tests here for error handling (file not found, VM errors, Benny errors, etc.)
// }); 