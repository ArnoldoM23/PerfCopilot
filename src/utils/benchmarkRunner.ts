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
// Ensure implementations is an object (testData can be optional)
if (!loadedModule.implementations || typeof loadedModule.implementations !== 'object') {
    console.error(`BENCHMARK_ERROR: Loaded module from ${functionsFilePath} is missing required implementations export.`); 
    process.exit(1);
}

// Use testData if available, otherwise default to an empty array
const testData = loadedModule.testData !== undefined ? loadedModule.testData : [];
const implementations = loadedModule.implementations as Record<string, string>; // Keep type assertion for TS

// Find all implementation keys (e.g., 'Original', 'Alternative_1')
const implementationKeys = Object.keys(implementations);

if (implementationKeys.length === 0) {
  console.error(`BENCHMARK_ERROR: No valid benchmark functions (originalFn or alternative*Fn) found in ${functionsFilePath}`);
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
                        // Throw error specific to this case if function not found *after* running code
                        throw new Error(`Benchmark function '${implKey}' not found in context after running code.`); // Updated error message
                    }

                    // Execute the benchmark function with the test data
                    entryFn(testData);
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
    suite.run(); // Explicitly run the benny suite
} catch (error) {
    console.error(`BENCHMARK_ERROR: Error setting up or running Benny suite: ${error}`);
    process.exit(1);
} 
