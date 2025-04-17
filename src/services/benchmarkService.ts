/**
 * @fileoverview Benchmark Service Implementation
 * 
 * This service encapsulates the logic for orchestrating the execution of performance 
 * benchmarks. It acts as the bridge between the main chat participant logic 
 * and the external benchmark runner script.
 * 
 * Responsibilities:
 * - Receives the generated benchmark module code (containing implementations and test data) 
 *   from the chat participant.
 * - Creates a temporary file to store this module code using utilities.
 * - Locates and executes the dedicated benchmark runner script (`benchmarkRunner.js`) 
 *   as a Node.js child process, passing the path to the temporary file.
 * - Captures the stdout and stderr output from the runner script.
 * - Parses the output from the runner script to extract the benchmark results.
 *   - Prioritizes parsing a specific `RESULTS_JSON:` line for structured data.
 *   - Falls back to text-based parsing of Benny's standard output if JSON is missing/invalid.
 *   - Handles errors reported by the benchmark script (e.g., `BENCHMARK_ERROR`).
 * - Includes logic (`replaceRecursiveCalls`) to prepare function code strings before 
 *   generating the benchmark module, ensuring functions run in isolation and recursive 
 *   calls within alternatives point to the correctly named function within the runner's context.
 * - Returns the parsed benchmark results (or throws an error if execution/parsing fails).
 */

/**
 * Benchmark Service
 * 
 * This service is responsible for running benchmarks to compare
 * different implementations of a function.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkComparison } from '../models/types';
import { createTempFile, runNodeScript } from '../utils/functions';

/**
 * Service for running benchmarks to compare function implementations.
 */
export class BenchmarkService {
    /**
     * Output channel for logging
     */
    private outputChannel: vscode.OutputChannel;

    /**
     * Creates a new BenchmarkService.
     * 
     * @param outputChannel - The output channel for logging
     */
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Runs a benchmark to compare different implementations of a function.
     * 
     * @param benchmarkCode - The benchmark code to run
     * @returns The benchmark comparison results
     * @throws Error if the benchmark fails to run
     */
    public async runBenchmark(benchmarkCode: string): Promise<BenchmarkComparison> {
        try {
            // Create a temporary file for the benchmark function/data code
            this.outputChannel.appendLine('Creating temporary functions/data file...');
            // Note: benchmarkCode now only contains functions and testData exports
            const tempFuncFilePath = await createTempFile(benchmarkCode, 'perfcopilot-funcs.js');
            
            // Path to the permanent runner script
            const runnerScriptPath = path.resolve(__dirname, '../utils/benchmarkRunner.js');
            
            if (!fs.existsSync(runnerScriptPath)) {
                throw new Error(`Benchmark runner script not found at ${runnerScriptPath}`);
            }
            
            // CRITICAL: Executes the benchmark runner node script using the utility function.
            // Run the permanent runner script, passing the temp functions file path as an argument
            this.outputChannel.appendLine(`Executing benchmark runner: ${runnerScriptPath} with ${tempFuncFilePath}`);
            const output = await runNodeScript(runnerScriptPath, [tempFuncFilePath]); // Pass file path as arg
            
            // Log the raw output before parsing
            this.outputChannel.appendLine(`\n--- Raw Benchmark Script Output ---\n${output}\n----------------------------------\n`);
            
            // Parse the benchmark results
            this.outputChannel.appendLine('Parsing benchmark results...');
            return this.parseBenchmarkResults(output);
        } catch (error) {
            this.outputChannel.appendLine(`Error running benchmark: ${error}`);
            throw error;
        }
    }

    /**
     * Parses the benchmark results from the script output.
     * 
     * @param output - The output from the benchmark script
     * @returns The parsed benchmark comparison results
     * @throws Error if parsing fails or benchmark reported an error
     */
    private parseBenchmarkResults(output: string): BenchmarkComparison {
        // Check for BENCHMARK_ERROR first, as it indicates a fatal script error
        const errorMatch = output.match(/^BENCHMARK_ERROR:(.*)$/m);
        if (errorMatch && errorMatch[1]) {
            const errorMessage = errorMatch[1].trim();
            this.outputChannel.appendLine(`Found BENCHMARK_ERROR line: ${errorMessage}`);
            throw new Error(`Benchmark script reported error: ${errorMessage}`);
        }

        // Prioritize parsing the text output format we now expect
        this.outputChannel.appendLine('Attempting to parse benchmark results using text format (cycle:/complete:)...');
        try {
            // !!! CRITICAL PARSING LOGIC !!!
            // This calls parseTextBenchmarkOutput which relies on specific string formats
            // ("cycle: Name: ..." and "complete: Fastest is ...") produced by 
            // `src/utils/benchmarkRunner.ts`. Changes to the output format in the runner
            // MUST be reflected in the regexes within `parseTextBenchmarkOutput`.
            const textResults = this.parseTextBenchmarkOutput(output);
            // Check if parsing yielded valid results
            if (textResults.results.length > 0 && textResults.fastest !== 'Unknown') {
                this.outputChannel.appendLine('Successfully parsed benchmark results from text output.');
                return textResults;
            } else {
                this.outputChannel.appendLine('Warning: Text parsing did not yield valid results. Output might be malformed or empty.');
                // Fall through to return default empty results if text parsing fails
            }
        } catch (parseError) {
             this.outputChannel.appendLine(`Error during text parsing: ${parseError}. Output might be malformed.`);
              // Fall through to return default empty results if text parsing fails
        }

        // If all parsing attempts fail, return default empty results
        this.outputChannel.appendLine('Warning: All parsing attempts failed. Returning empty results.');
        return { fastest: 'Unknown', results: [] };
    }
    
    /**
     * Parses benchmark results from plain text output based on "cycle:" and "complete:" lines.
     * 
     * @param output - The text output from the benchmark
     * @returns The parsed benchmark comparison results
     */
    private parseTextBenchmarkOutput(output: string): BenchmarkComparison {
        // DEFINE REGEXES INSIDE THE FUNCTION
        
        // !!! CRITICAL REGEX: cycleRegex !!!
        // This regex parses lines like "cycle: Name: Original, Ops: 574078.7033043295"
        // It specifically captures the Name and the Ops value.
        // REASON: Extracts performance data for each implementation.
        // DO NOT MODIFY without ensuring it exactly matches the output format of
        // the `benny.cycle` handler in `src/utils/benchmarkRunner.ts`.
        // Regex for "cycle: Name: ..., Ops: ..."
        // ^cycle:      - Start of line anchor and marker
        // \s*Name:\s* - Match "Name:" with optional surrounding whitespace
        // ([^,]+?)    - Capture Group 1: The name (any char except comma, non-greedy)
        // \s*,\s*Ops:\s* - Match ", Ops:" with optional surrounding whitespace
        // ([\d.]+)    - Capture Group 2: The Ops/sec value (digits and decimal point)
        const cycleRegex = /^cycle:\s*Name:\s*([^,]+?)\s*,\s*Ops:\s*([\d.]+)/gm;
        
        // !!! CRITICAL REGEX: completeRegex !!!
        // This regex parses the line "complete: Fastest is Alternative_2"
        // It specifically captures the name of the fastest implementation.
        // REASON: Identifies the winning implementation.
        // DO NOT MODIFY without ensuring it exactly matches the output format of
        // the `benny.complete` handler in `src/utils/benchmarkRunner.ts`.
        // Regex for "complete: Fastest is ..."
        // ^complete:     - Start of line anchor and marker
        // \s*Fastest is\s* - Match "Fastest is" with optional surrounding whitespace
        // (.+?)         - Capture Group 1: The name of the fastest implementation (non-greedy)
        // \s*$          - Optional trailing whitespace and end-of-line anchor
        const completeRegex = /^complete:\s*Fastest is\s*(.+?)\s*$/m;

        // +++ TEST DEBUG LOG +++
        console.log('\n[parseTextBenchmarkOutput TEST DEBUG] Input string:\n---\n', output, '\n---');
        // +++ END TEST DEBUG LOG +++

        const results = [];
        let match;
        
        this.outputChannel.appendLine('--- Parsing cycle lines ---');
        // +++ TEST DEBUG LOG +++
        console.log('[parseTextBenchmarkOutput TEST DEBUG] Entering cycleRegex loop...');
        // +++ END TEST DEBUG LOG +++
        while ((match = cycleRegex.exec(output)) !== null) {
            // +++ TEST DEBUG LOG +++
            console.log('[parseTextBenchmarkOutput TEST DEBUG] cycleRegex match:', match);
            // +++ END TEST DEBUG LOG +++
            const name = match[1].trim();
            const ops = parseFloat(match[2]);
            this.outputChannel.appendLine(`  Matched cycle: Name='${name}', Ops=${ops}`);
            
            if (isNaN(ops)) {
                this.outputChannel.appendLine(`  Warning: Could not parse ops for benchmark case: ${name}. Input: ${match[2]}`);
                continue;
            }

            // Add margin: 0 to satisfy the BenchmarkResultItem type
            results.push({ name, ops, margin: 0 }); 
        }
        this.outputChannel.appendLine('--- Finished parsing cycle lines ---');
        
        // Parse the completion line
        this.outputChannel.appendLine('--- Parsing complete line ---');
        const completeMatch = output.match(completeRegex);
        // +++ TEST DEBUG LOG +++
        console.log('[parseTextBenchmarkOutput TEST DEBUG] completeRegex match:', completeMatch);
        // +++ END TEST DEBUG LOG +++
        let fastest = 'Unknown';
        if (completeMatch && completeMatch[1]) {
            fastest = completeMatch[1].trim();
             this.outputChannel.appendLine(`  Matched complete: Fastest='${fastest}'`);
        } else {
             this.outputChannel.appendLine('  Complete line not found or could not be parsed.');
        }
         this.outputChannel.appendLine('--- Finished parsing complete line ---');
        
        // If results were parsed but fastest wasn't found on complete line, determine from results
        if (fastest === 'Unknown' && results.length > 0) {
             this.outputChannel.appendLine('  Determining fastest from parsed cycle results...');
            results.sort((a, b) => b.ops - a.ops);
            fastest = results[0].name;
             this.outputChannel.appendLine(`  Fastest determined as: ${fastest}`);
        }
        
        // +++ TEST DEBUG LOG +++
        console.log(`[parseTextBenchmarkOutput TEST DEBUG] Returning: { fastest: "${fastest}", results: ${JSON.stringify(results)} }`);
        // +++ END TEST DEBUG LOG +++
        return {
            fastest,
            results
        };
    }

    /**
     * Helper function to replace the definition and internal recursive calls of a function.
     * !!! CRITICAL HELPER FUNCTION: replaceRecursiveCalls !!!
     * REASON: This function is essential for correctly preparing function code strings 
     *         to run inside the isolated `vm` context of `benchmarkRunner.ts`.
     *         1. Renames the function definition (e.g., `myFunc` to `Alternative_1`) 
     *            to avoid naming collisions within the runner's scope.
     *         2. Renames internal recursive calls within the function's body to use 
     *            the new name (e.g., `myFunc()` becomes `Alternative_1()`). This ensures 
     *            recursive alternatives call themselves correctly, not the original function.
     *         3. Handles different function declaration styles (const arrow func, standard function).
     * DO NOT MODIFY this logic without careful consideration of how functions are 
     * executed and potentially recurse within the `vm` sandbox environment.
     * Failure here can lead to `ReferenceError`s in the runner or incorrect benchmark results
     * if recursion calls the wrong implementation.
     * 
     * @param code - The string containing the function code.
     * @param originalName - The original name of the function.
     * @param newName - The new name to assign to the function.
     * @returns The modified code string with the function renamed and recursive calls updated.
     */
    public replaceRecursiveCalls(code: string, originalName: string, newName: string): string {
        // CRITICAL: Renames function definitions AND internal recursive calls.
        // This allows alternatives to run in the isolated vm context of the runner 
        // without name collisions and ensures recursion within an alternative calls itself correctly.
        // This helper transforms a code snippet defining a function named `originalName`
        // into one defining a function named `newName`, ensuring internal recursive
        // calls to `originalName` are also replaced with `newName`.

        try {
            // 1. Find the main function definition (const/function originalName ...)
            //    Use a regex that captures the declaration type (const/function) and the rest (signature/body)
            //    Regex breakdown:
            //    - `(const\\s+|function\\s+)`: Capture group 1: "const " or "function "
            //    - `(${originalName})`: Capture group 2: The original function name
            //    - `(\\s*=|\\s*\\()`: Capture group 3: Start of assignment/params (" =" or " (")
            const definitionRegex = new RegExp(`(const\\s+|function\\s+)(${originalName})(\\s*=|\\s*\\()`);
            const match = code.match(definitionRegex);

            if (!match || match.index === undefined) {
                // Try to handle anonymous arrow functions assigned to a const
                const arrowAssignRegex = new RegExp(`(const\\s+)(${originalName})(\\s*=\\s*\\()`);
                const arrowMatch = code.match(arrowAssignRegex);
                if(arrowMatch && arrowMatch.index !== undefined){
                     // If it's `const originalName = (params) => ...`
                     // Rename the const declaration
                    let definitionReplacedCode = code.substring(0, arrowMatch.index) +
                                            `const ${newName}` +
                                            code.substring(arrowMatch.index + `const ${originalName}`.length);

                    // Replace recursive calls within the body using a careful regex
                    // Look for `originalName(` not preceded by `.` or alphanumeric chars (avoid obj.method)
                    const recursiveCallRegex = new RegExp(`(?<![.\\w])\\b${originalName}\\s*\\(`, 'g');
                    const finalCode = definitionReplacedCode.replace(recursiveCallRegex, `${newName}(`);
                    return finalCode;

                } else {
                    this.outputChannel.appendLine(`Warning: Could not find standard function definition for "${originalName}" in provided code. Recursive calls may not be correctly handled for "${newName}". Returning code mostly unmodified.`);
                    // Fallback: Attempt to wrap or assign, but this is risky.
                    // Let's just return it assigned to the new name, hoping it's an expression.
                    return `const ${newName} = ${code};`;
                }
            }

            // 2. Rename the function in the definition line
            // Reconstruct the start of the code with the new name
            let definitionReplacedCode = code.substring(0, match.index) + // Code before definition
                                         match[1] +                     // "const " or "function "
                                         newName +                      // The new function name
                                         code.substring(match.index + match[1].length + match[2].length); // Rest of the code

            // 3. Replace recursive calls *within* the function body
            // Use a regex that finds `originalName(` but avoids matching inside strings or comments (best effort without AST)
            // Look for `originalName(` not preceded by `.` or alphanumeric chars (avoid obj.method)
            const recursiveCallRegex = new RegExp(`(?<![.\\w])\\b${originalName}\\s*\\(`, 'g');
            // Apply replacement to the code *after* definition rename
            const finalCode = definitionReplacedCode.replace(recursiveCallRegex, `${newName}(`);

            return finalCode;
        } catch (error: any) {
            this.outputChannel.appendLine(`Error during recursive call replacement for ${newName}: ${error.message}`);
            // Return a placeholder function to avoid crashing the runner
            return `const ${newName} = () => { throw new Error('Error processing code for ${newName}: ${error.message}'); };`;
        }
    }

    // **Potential Issue:** How are recursive calls handled?
    // We need to replace calls to `entryPoint` within each function body
    // with calls to the new sanitized name for that specific implementation.
}