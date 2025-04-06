// src/utils/benchmarkRunner.js

// This script runs the Benny benchmark using pre-generated function/data file.

const benny = require('benny');
const path = require('path');
const fs = require('fs');

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

let loadedFunctions: Record<string, any>;
try {
  // Require the dynamically generated file
  const requiredModule = require(path.resolve(functionsFilePath));
  // Basic type check after require
  if (typeof requiredModule !== 'object' || requiredModule === null) {
      throw new Error('Module did not export an object.');
  }
  loadedFunctions = requiredModule as Record<string, any>;
} catch (error) {
  console.error(`BENCHMARK_ERROR: Failed to load functions from ${functionsFilePath}: ${error}`);
  process.exit(1);
}

// Validate required exports from the loaded file
if (!('testData' in loadedFunctions)) {
    // Allow null/undefined testData if functions don't take params
    // console.warn('Warning: testData not found in loaded functions file.');
    loadedFunctions.testData = undefined; // Ensure it exists
}

// Find all exported functions matching the expected pattern (e.g., originalFn, alternative1Fn)
const functionCases = Object.keys(loadedFunctions)
  .filter(key => typeof loadedFunctions[key] === 'function' && key.match(/^(original|alternative\d+)Fn$/))
  .map(key => {
    // Map the internal function name (e.g., 'alternative1Fn') to the display name (e.g., 'Alternative 1')
    let displayName = 'Unknown';
    if (key === 'originalFn') {
        displayName = 'Original';
    } else {
        const match = key.match(/^alternative(\d+)Fn$/);
        if (match && match[1]) {
            displayName = `Alternative ${match[1]}`;
        }
    }
    return { name: displayName, fn: loadedFunctions[key], fnKey: key };
  });

if (functionCases.length === 0) {
  console.error(`BENCHMARK_ERROR: No valid benchmark functions (originalFn, alternative*Fn) found in ${functionsFilePath}`);
  process.exit(1);
}

// Dynamically build the Benny suite
try {
    const suite = benny.suite(
        'Function Performance Benchmark',
        ...functionCases.map(fCase => 
            benny.add(fCase.name, () => {
                // Call the specific function using the key from the loaded module
                loadedFunctions[fCase.fnKey](loadedFunctions.testData);
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