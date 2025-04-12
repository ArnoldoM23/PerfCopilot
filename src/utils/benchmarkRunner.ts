// src/utils/benchmarkRunner.ts

// This script runs the Benny benchmark using pre-generated function/data file.

const benny = require('benny');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// FIX: Export the interface
export interface BenchmarkModuleData {
    implementations: Record<string, string>;
    testData: any[];
    entryPointName: string;
}

// FIX: Extracted function for loading and validating the module
export async function loadAndValidateBenchmarkModule(functionsFilePath: string): Promise<BenchmarkModuleData> {
    if (!functionsFilePath) {
        throw new Error('No functions file path provided.');
    }

    if (!fs.existsSync(functionsFilePath)) {
        throw new Error(`Functions file not found: ${functionsFilePath}`);
    }

    let fileContent: string;
    try {
        fileContent = fs.readFileSync(functionsFilePath, 'utf-8');
    } catch (readError: any) {
        throw new Error(`Failed to read functions file ${functionsFilePath}: ${readError.message}`);
    }

    let loadedModule: any;
    try {
        // Evaluate the file content in a new context to get the exports
        // The file itself should assign to module.exports
        const script = new vm.Script(fileContent, { filename: functionsFilePath }); 
        const context = { module: { exports: {} }, require: require }; // Provide basic context
        vm.createContext(context);
        script.runInContext(context, { timeout: 5000 }); // Add timeout
        loadedModule = context.module.exports;

        if (typeof loadedModule !== 'object' || loadedModule === null) {
            throw new Error('Module content did not evaluate to an object.');
        }
    } catch (parseError: any) {
        throw new Error(`Failed to parse module content from ${functionsFilePath}: ${parseError.message}`);
    }

    // Validate required exports
    if (loadedModule.testData === undefined || !Array.isArray(loadedModule.testData) ||
        !loadedModule.implementations || typeof loadedModule.implementations !== 'object' ||
        !loadedModule.entryPointName || typeof loadedModule.entryPointName !== 'string') {
        throw new Error(`Loaded module from ${functionsFilePath} is missing required exports or has incorrect types (implementations: object, testData: array, entryPointName: string).`);
    }
    
    const implementationKeys = Object.keys(loadedModule.implementations);
    if (implementationKeys.length === 0) {
         throw new Error(`No implementations found in the loaded module from ${functionsFilePath}`);
    }

    // Return the validated data conforming to the interface
    return loadedModule as BenchmarkModuleData;
}


// FIX: Updated function accepts pre-loaded data
export async function executeBenchmarkSuite(moduleData: BenchmarkModuleData): Promise<void> {
    const { implementations, testData, entryPointName } = moduleData;
    const implementationKeys = Object.keys(implementations);

    // Dynamically build the Benny suite
    try {
        await benny.suite(
            'Function Performance Benchmark',
            ...implementationKeys.map(implKey =>
                benny.add(implKey, () => {
                    const context = {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        __testData: testData,
                        console: { log: () => {}, warn: () => {}, error: () => {} },
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        Math: Math,
                        // Provide require if needed by the functions being benchmarked
                        require: require 
                    };
                    vm.createContext(context);

                    try {
                        // Define the functions for the current implementation
                        vm.runInContext(implementations[implKey], context, { timeout: 1000 });

                        // Get the specific entry point function
                        const entryFn = vm.runInContext(entryPointName, context);
                        if (typeof entryFn !== 'function') {
                            throw new Error(`Benchmark entry point function '${entryPointName}' (for implementation '${implKey}') not found or not a function in context.`);
                        }
                        // Execute the entry point function
                        entryFn(testData);
                    } catch (execError: any) {
                         // Log execution errors but don't stop the whole suite
                         console.error(`BENCHMARK_EXECUTION_ERROR [${implKey}]: ${execError.message}`);
                    }
                })
            ),
            benny.cycle(),
            new Promise<void>(resolve => {
                benny.complete((summary: any) => {
                    // Format and output results
                    const formattedResults = summary.results?.map((res: any) => ({
                        name: res.name,
                        ops: res.ops,
                    })) || []; // Handle cases where summary might not have results
                    
                    let fastestSuiteName = 'Unknown';
                    if (formattedResults.length > 0) {
                        type ResultItem = { name: string; ops: number };
                        const fastestResult = formattedResults.reduce((max: ResultItem, current: ResultItem) => (current.ops > max.ops ? current : max), formattedResults[0]);
                        fastestSuiteName = fastestResult.name;
                    }
                    console.log('RESULTS_JSON: ' + JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));
                    resolve();
                });
            })
        );
    } catch (error: any) {
        // Throw errors related to Benny setup itself
        throw new Error(`Error setting up or running Benny suite: ${error.message}`);
    }
}

// Keep this block to allow running the script directly
// FIX: Update main block to use new loading function
if (require.main === module) {
    (async () => {
        const filePath = process.argv[2];
        if (!filePath) {
            console.error('Usage: node benchmarkRunner.js <path_to_functions_file>');
            process.exit(1);
        }

        try {
            const moduleData = await loadAndValidateBenchmarkModule(filePath);
            await executeBenchmarkSuite(moduleData);
        } catch (error: any) {
            // Log specific errors from loading or execution
            console.error(`BENCHMARK_ERROR: ${error.message}`);
            process.exit(1);
        }
    })().catch(error => {
        // Catch unexpected errors in the async IIFE
        console.error(`BENCHMARK_FATAL_ERROR: ${error}`);
        process.exit(1);
    });
} 
