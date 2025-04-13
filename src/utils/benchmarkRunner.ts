// src/utils/benchmarkRunner.js

// This script runs the Benny benchmark using pre-generated function/data file.

const benny = require('benny');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Get the path to the file containing functions and testData from command line arguments
const functionsFilePath = process.argv[2];

if (!functionsFilePath) {
  console.error('BENCHMARK_ERROR: No functions file path provided.');
  process.exit(1);
}

if (!fs.existsSync(functionsFilePath)) {
  console.error(`BENCHMARK_ERROR: Functions file not found: ${functionsFilePath}`);
  process.exit(1);
}

let loadedModule: Record<string, any>;
try {
  // Require the dynamically generated file
  const requiredModule = require(path.resolve(functionsFilePath));
  // Basic type check after require
  if (typeof requiredModule !== 'object' || requiredModule === null) {
      throw new Error('Module did not export an object.');
  }
  loadedModule = requiredModule as Record<string, any>;
} catch (error) {
  console.error(`BENCHMARK_ERROR: Failed to load functions from ${functionsFilePath}: ${error}`);
  process.exit(1);
}

// Validate required exports from the loaded module
// Ensure testData is present (can be null/undefined) and implementations is an object.
if (loadedModule.testData === undefined || 
    !loadedModule.implementations || typeof loadedModule.implementations !== 'object') {
    // Corrected Error Message: Only mention missing testData or implementations
    console.error(`BENCHMARK_ERROR: Loaded module from ${functionsFilePath} is missing required exports (testData, implementations).`); 
    process.exit(1);
}

const testData = loadedModule.testData;
const implementations = loadedModule.implementations as Record<string, string>; // Keep type assertion for TS

// Find all implementation keys (e.g., 'Original', 'Alternative_1')
const implementationKeys = Object.keys(implementations);

if (implementationKeys.length === 0) {
  console.error(`BENCHMARK_ERROR: No implementations found in the loaded module from ${functionsFilePath}`);
  process.exit(1);
}

// Dynamically build the Benny suite
try {
    const suite = benny.suite(
        'Function Performance Benchmark',
        // Map over implementation keys ('Original', 'Alternative 1', ...)
        ...implementationKeys.map(implKey => 
            benny.add(implKey, () => {
                // For each benchmark case, create a *new* isolated context
                const context = {
                    __testData: testData,
                    // __entryPointName: entryPointName, // Removed from context
                    // Add necessary globals (e.g., console, Math)
                    console: {
                        log: () => {}, warn: () => {}, error: () => {}
                    },
                    Math: Math
                    // DO NOT pass the implementation code string here
                };
                vm.createContext(context);

                try {
                    // Run the full code for THIS implementation inside the context
                    vm.runInContext(implementations[implKey], context, { timeout: 1000 });

                    // Get the benchmark function by evaluating its name within the context
                    const entryFn = vm.runInContext(implKey, context);
                    if (typeof entryFn !== 'function') {
                        throw new Error(`Benchmark function '${implKey}' not found in context after running code.`);
                    }

                    // --- FIX 2: Correctly handle testData --- 
                    // The LLM is asked to provide testData as an array of test cases.
                    // For benchmarking, we use the arguments from the first test case.
                    // testData might be [[arg1, arg2], ...] or [arg1, arg2, ...] or just arg for single-arg funcs.
                    // We need to handle the case where the function takes multiple arguments. The test case itself will be an array.
                    
                    // Use the __testData from the context, which is the full array of test cases.
                    const allTestData = context.__testData; 
                    if (!Array.isArray(allTestData) || allTestData.length === 0) {
                        // If no test data or not an array, try calling with no args or handle error
                        // For now, let's assume functions require data if provided.
                        throw new Error('Benchmark testData is missing or not an array.');
                    }

                    // Use the arguments from the *first* test case for the benchmark run.
                    const argsForRun = allTestData[0];

                    if (Array.isArray(argsForRun)) {
                        // If the first test case is an array, spread its elements as arguments
                        entryFn(...argsForRun);
                    } else {
                         // If the first test case is not an array, it's a single argument
                        entryFn(argsForRun);
                    }
                    // --- End Fix 2 ---
                    
                } catch (execError) {
                     // Catch errors during runInContext or function execution within the benchmark case
                     console.error(`BENCHMARK_EXECUTION_ERROR [${implKey}]: ${execError}`);
                     // Allow benny to potentially proceed, but log the error clearly.
                     // Alternatively, re-throw to stop the suite: throw execError;
                }
            })
        ),
        benny.cycle(),
        benny.complete((summary: any) => {
            const formattedResults = summary.results.map((res: any) => ({ 
                name: res.name, 
                ops: res.ops, // Use ops/sec from benny
                // margin: res.margin // Benny v3 might not have margin directly here, calculate if needed
            }));
            // Determine fastest based on ops from formatted results
            let fastestSuiteName = 'Unknown';
            if (formattedResults.length > 0) {
                // Define type for clarity
                type ResultItem = { name: string; ops: number }; 
                const fastestResult = formattedResults.reduce((max: ResultItem, current: ResultItem) => (current.ops > max.ops ? current : max), formattedResults[0]);
                fastestSuiteName = fastestResult.name;
            }
            
            // Output results in the expected JSON format
            console.log('RESULTS_JSON: ' + JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));
        })
    );
    // suite.run(); // Benny runs automatically when the script finishes if not explicitly run?
} catch (error) {
    console.error(`BENCHMARK_ERROR: Error setting up or running Benny suite: ${error}`);
    process.exit(1);
} 
