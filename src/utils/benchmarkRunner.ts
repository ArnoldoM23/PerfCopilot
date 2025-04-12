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

// --- ADDED: Load entryPointName --- 
const entryPointName = loadedModule.entryPointName as string;
if (!entryPointName || typeof entryPointName !== 'string') {
    console.error(`BENCHMARK_ERROR: Loaded module from ${functionsFilePath} is missing or has invalid 'entryPointName'.`);
    process.exit(1);
}
// --------------------------------

if (implementationKeys.length === 0) {
  console.error(`BENCHMARK_ERROR: No implementations found in the loaded module from ${functionsFilePath}`);
  process.exit(1);
}

// --- REVISED: Isolate function definitions --- 
const benchmarkableFunctions: Record<string, (...args: any[]) => any> = {};

try {
    for (const implKey in implementations) {
        const codeString = implementations[implKey];
        
        // Create a NEW context for EACH implementation's definition
        const definitionContext = vm.createContext({
            console: { log: () => {}, warn: () => {}, error: (msg: any) => { console.error(`Error in definition VM [${implKey}]: ${msg}`); } }, // Log errors from definition
            Math: Math,
            require: require, // Potentially needed by function code
            module: { exports: {} } // Allow basic module patterns if used internally
        });

        try {
             // Run code string to define the function inside the ISOLATED context
            vm.runInContext(codeString, definitionContext, { timeout: 2000, displayErrors: true });
            
            // FIX: Retrieve the defined function by EVALUATING its name in the context
            const fn = vm.runInContext(entryPointName, definitionContext, { timeout: 50 }); // Short timeout for retrieval
            
            if (typeof fn !== 'function') {
                // This error now means the name didn't resolve to a function after definition
                throw new Error(`Evaluating '${entryPointName}' in context did not return a function after executing code for key '${implKey}'.`);
            }
            // Store the actual function reference in our main map
            benchmarkableFunctions[implKey] = fn;
        } catch (definitionError) {
             console.error(`BENCHMARK_SETUP_ERROR: Failed during function definition for key '${implKey}': ${definitionError}`);
             // Decide whether to skip this impl or exit. Let's skip for now.
             // process.exit(1); 
             continue; // Skip this implementation if definition failed
        }
    }
} catch (loopError) {
    // Catch errors in the outer loop logic itself (unlikely)
    console.error(`BENCHMARK_SETUP_ERROR: Unexpected error during implementation loop: ${loopError}`);
    process.exit(1);
}
// --- END REVISED --- 

// Check if we have any functions left after definition attempts
if (Object.keys(benchmarkableFunctions).length === 0) {
    console.error(`BENCHMARK_ERROR: No implementations could be successfully defined.`);
    process.exit(1);
}

// Dynamically build the Benny suite
try {
    const suite = benny.suite(
        'Function Performance Benchmark',
        // Map over the *prepared* functions using their keys ('Original', 'Alternative_1', ...)
        ...Object.keys(benchmarkableFunctions).map(implKey => 
            // The function Benny times:
            benny.add(implKey, () => { 
                try {
                    // Get the *pre-defined* function from our local map
                    const funcToRun = benchmarkableFunctions[implKey];

                    // Call the function with the test data arguments
                    // We assume testData is structured correctly for the function's parameters
                    // Example for findAllMatchingExpoResolutionPathsOld(indexMapping, resolutionInfo):
                    if(typeof funcToRun === 'function') {
                        // Check if testData itself has the properties, typical for object args
                        if (testData && typeof testData === 'object' && 'indexMapping' in testData && 'resolutionInfo' in testData) {
                             funcToRun(testData.indexMapping, testData.resolutionInfo);
                        } else {
                            // Fallback or alternative: if testData is an array of args
                            // funcToRun(...testData); // If testData = [arg1, arg2]
                            // Or just pass testData if the function expects the whole object
                            funcToRun(testData);
                        }
                    } else {
                        // Should not happen if setup phase succeeded
                        console.error(`BENCHMARK_RUNTIME_ERROR [${implKey}]: Function reference not found.`);
                    }
                } catch (runtimeError) {
                     // Catch errors *during* the timed execution
                     console.error(`BENCHMARK_RUNTIME_ERROR [${implKey}]: ${runtimeError}`);
                     // Log runtime error but allow Benny to continue if possible
                }
            })
        ),
        benny.cycle(), // Default cycle behavior
        benny.complete((summary: any) => {
            const formattedResults = summary?.results?.map((res: any) => ({ 
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
