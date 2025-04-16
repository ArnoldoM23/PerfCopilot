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

console.log('[BenchmarkRunner] Required functions file successfully:', functionsFilePath);

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

console.log('[BenchmarkRunner] Validated required exports (testData, implementations).');

const testData = loadedModule.testData;
const implementations = loadedModule.implementations as Record<string, string>; // Keep type assertion for TS

// Find all implementation keys (e.g., 'Original', 'Alternative_1')
const implementationKeys = Object.keys(implementations);

if (implementationKeys.length === 0) {
  console.error(`BENCHMARK_ERROR: No implementations found in the loaded module from ${functionsFilePath}`);
  process.exit(1);
}

console.log('[BenchmarkRunner] Found implementation keys:', implementationKeys.join(', '));

// --- START: Prepare functions and arguments outside the loop ---
const preparedFunctions = new Map<string, (...args: any[]) => any>();
let argsForRun: any[] = [];

// Determine arguments once
try {
    const allTestData = testData; // Use the module-level testData

    // Check for the specific known structure of findAllMatchingExpoResolutionPathsOld testData
    if (typeof allTestData === 'object' && allTestData !== null && !Array.isArray(allTestData) && allTestData.indexMapping && allTestData.resolutionInfo) {
        // Specific case for findAll... which takes 2 object arguments
        argsForRun = [allTestData.indexMapping, allTestData.resolutionInfo];
    } else {
        // Default case: Assume testData represents a SINGLE argument for the benchmark function.
        // This works for processNumbers where testData is the array argument itself.
        // This would also work if testData was a single object or primitive.
        // This might fail if testData is an array meant to be spread as multiple arguments (e.g., testData = [5, 10] for add(a,b)) -
        // requires LLM to provide testData appropriately based on function signature.
        argsForRun = [allTestData];
    }

    console.log('[BenchmarkRunner] Determined argsForRun:', JSON.stringify(argsForRun));
} catch (argError) {
    console.error(`BENCHMARK_ERROR: Failed to determine arguments from testData: ${argError}`);
    process.exit(1);
}


// Compile functions once
console.log('[BenchmarkRunner] Pre-compiling functions...');
for (const implKey of implementationKeys) {
    try {
        const context = {
            // Include necessary globals if functions depend on them, but NOT testData here
             console: { log: () => {}, warn: () => {}, error: () => {} },
             Math: Math
        };
        vm.createContext(context);
        // Run the code to define the function in the context
        vm.runInContext(implementations[implKey], context, { timeout: 1000 });
        // Get the function reference
        const funcRef = vm.runInContext(implKey, context);
        if (typeof funcRef !== 'function') {
            throw new Error(`Implementation '${implKey}' did not evaluate to a function.`);
        }
        preparedFunctions.set(implKey, funcRef);
        console.log(`[BenchmarkRunner] Successfully compiled: ${implKey}`);
    } catch(compileError) {
        console.error(`BENCHMARK_ERROR: Failed to compile function '${implKey}': ${compileError}`);
        process.exit(1);
    }
}
console.log('[BenchmarkRunner] All functions pre-compiled.');
// --- END: Prepare functions and arguments outside the loop ---


// Remove async IIFE wrapper
// (async () => {
// Dynamically build the Benny suite
try {
    console.log('[BenchmarkRunner] Setting up Benny suite...');
    const suite = benny.suite(
        'Function Performance Benchmark',
        // Map over implementation keys ('Original', 'Alternative 1', ...)
        ...implementationKeys.map(implKey =>
             // Return the benny.add() call from the map function
             benny.add(implKey, () => {
                // --- START: Modified benny.add callback ---
                const funcToRun = preparedFunctions.get(implKey);
                // We assume funcToRun exists because we checked during pre-compilation
                if (typeof funcToRun !== 'function') {
                    // This should ideally not happen due to pre-compilation checks
                    console.error(`BENCHMARK_ITERATION_ERROR: Pre-compiled function not found for key: ${implKey}`);
                    // Optionally throw an error to halt the benchmark for this case
                    throw new Error(`Pre-compiled function not found for key: ${implKey}`);
                }
                try {
                    // Call the pre-compiled function with pre-determined args
                    funcToRun(...argsForRun);
                } catch (execError) {
                     // Log execution errors specifically happening *during* the timed run
                     // Avoid excessively noisy logs here unless debugging Benny itself
                     // console.error(`BENCHMARK_ITERATION_ERROR [${implKey}]: ${execError}`);
                     // Re-throw or handle if necessary, but Benny might catch it
                     throw execError; 
                }
                // --- END: Modified benny.add callback ---
            }) // End of benny.add() call
        ), // End of .map()

        // Benny lifecycle handlers are arguments to benny.suite, after the mapped cases
        benny.cycle((cycleInfo: any) => {
             console.log(`[BenchmarkRunner CYCLE] Name: ${cycleInfo?.name}, Ops: ${cycleInfo?.ops}`);
        }),
        benny.complete((summary: any) => {
            console.log('[BenchmarkRunner COMPLETE] Benchmark finished. Processing summary...');
            console.log('[BenchmarkRunner COMPLETE] Raw summary:', JSON.stringify(summary));
            const formattedResults = summary.results.map((res: any) => ({ 
                name: res.name, 
                ops: res.ops 
            }));
            let fastestSuiteName = 'Unknown';
            if (formattedResults.length > 0) {
                type ResultItem = { name: string; ops: number }; 
                const fastestResult = formattedResults.reduce((max: ResultItem, current: ResultItem) => (current.ops > max.ops ? current : max), formattedResults[0]);
                fastestSuiteName = fastestResult.name;
            }
            console.log('[BenchmarkRunner COMPLETE] Processed results:', JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));
            console.log('RESULTS_JSON: ' + JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));
        })
    ); // End of benny.suite() call

    console.log('[BenchmarkRunner] Benny suite setup complete.');
    // Remove explicit run call
    // console.log('[BenchmarkRunner] Explicitly calling suite.run()...');
    // await suite.run(); 
    // console.log('[BenchmarkRunner] suite.run() finished.');

} catch (error) {
    console.error(`BENCHMARK_ERROR: Error setting up or running Benny suite: ${error}`);
    process.exit(1);
} 
// Remove async IIFE wrapper
// })(); 
