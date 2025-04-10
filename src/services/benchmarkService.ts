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
        let jsonString: string | undefined;
        try {
            // Refined Regex: Match start of line, RESULTS_JSON:, optional whitespace,
            // then capture a potentially nested JSON object until the final closing brace on the line.
            // Explanation:
            // ^RESULTS_JSON:   - Marker at start of line (m flag)
            // \s*            - Optional whitespace
            // (              - Start capture group 1
            // {              - Match opening brace
            // (?:[^{}]|{[^]*?})* - Match nested braces correctly: either non-brace chars or a full inner brace pair
            // }              - Match closing brace
            // )              - End capture group 1
            // \s*            - Optional trailing whitespace
            // $              - End of line (m flag)
            const jsonMatch = output.match(/^\s*RESULTS_JSON:\s*(.*)$/m);

            if (jsonMatch && jsonMatch[1]) {
                jsonString = jsonMatch[1].trim();
                this.outputChannel.appendLine(`Found RESULTS_JSON line. Preparing to parse...`);
                // Log the exact string being passed to JSON.parse
                this.outputChannel.appendLine(`--- String to Parse as JSON ---\n${jsonString}\n-----------------------------`);
                const parsed = JSON.parse(jsonString);

                // Basic validation of the parsed JSON structure
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results) && typeof parsed.fastest === 'string') {
                     this.outputChannel.appendLine(`Successfully parsed benchmark JSON.`);
                    return {
                        fastest: parsed.fastest || 'Unknown',
                        results: parsed.results || []
                    };
                } else {
                     this.outputChannel.appendLine(`Warning: Parsed JSON does not have expected structure { results: [], fastest: "" }. Parsed: ${JSON.stringify(parsed)}. Falling back to text parsing.`);
                     // Fall through to text parsing below
                }
            } else {
                 this.outputChannel.appendLine(`RESULTS_JSON line not found. Falling back to text parsing.`);
                 // Fall through to text parsing below
            }
        } catch (error) {
            // Catch JSON.parse errors specifically
            this.outputChannel.appendLine(`Error parsing benchmark results JSON: ${error}. Falling back to text parsing.`);
            // Log the string that failed parsing
            if (jsonString !== undefined) { // Only log if we thought we had a string
                 this.outputChannel.appendLine(`--- Failed JSON String ---\n${jsonString}\n------------------------`);
            }
             // Fall through to text parsing below
        }
        
        // Fallback: Check for BENCHMARK_ERROR before attempting text parsing
        const errorMatch = output.match(/^BENCHMARK_ERROR:\s*({[\s\S]*?})$/m);
        if (errorMatch && errorMatch[1]) {
            this.outputChannel.appendLine(`Found BENCHMARK_ERROR line: ${errorMatch[1]}`);
             // Throw an error instead of returning a specific structure
             throw new Error(`Benchmark script reported error: ${errorMatch[1]}`);
        }

        // Fallback to text parsing if JSON parsing failed or wasn't applicable
        this.outputChannel.appendLine('Attempting to parse benchmark results using text format...');
        const textResults = this.parseTextBenchmarkOutput(output);
        if (textResults.results.length > 0) {
            this.outputChannel.appendLine('Successfully parsed benchmark results from text output.');
            return textResults;
        } else {
             this.outputChannel.appendLine('Warning: Could not parse results from text output either. Returning empty results.');
             // Return default empty results if text parsing also fails
             return { fastest: 'Unknown', results: [] }; 
        }
    }
    
    /**
     * Parses benchmark results from plain text output.
     * 
     * @param output - The text output from the benchmark
     * @returns The parsed benchmark comparison results
     */
    private parseTextBenchmarkOutput(output: string): BenchmarkComparison {
        // Parse lines like "  original x 1,234,567 ops/sec ±0.12% (95 runs sampled)"
        // Regex explanation:
        // ^\s*        - Start of line, followed by optional whitespace
        // ([^\n\r]+?) - Capture group 1: Capture any character except newline/carriage return (non-greedy) - this is the name on the *same* line
        // \s+x\s+      - Match " x " (with surrounding whitespace)
        // ([\d,\.]+)   - Capture group 2: Capture digits, commas, periods (the ops/sec number)
        // \s+ops\/sec   - Match " ops/sec"
        // .*            - Match the rest of the line
        const resultRegex = /^\s*([^\n\r]+?)\s+x\s+([\d,\.]+)\s+ops\/sec.*/gm;
        const results = [];
        let match;
        
        while ((match = resultRegex.exec(output)) !== null) {
            const name = match[1].trim();
            // Ensure ops are parsed correctly, removing commas
            const ops = parseFloat(match[2].replace(/,/g, '')); 
            
            // Skip if ops parsing failed (NaN)
            if (isNaN(ops)) {
                this.outputChannel.appendLine(`Warning: Could not parse ops for benchmark case: ${name}`);
                continue;
            }

            // Add margin: 0 to satisfy the BenchmarkResultItem type
            results.push({ name, ops, margin: 0 }); 
        }
        
        // Sort results by ops descending to find the fastest
        results.sort((a, b) => b.ops - a.ops);
        
        const fastest = results.length > 0 ? results[0].name : 'Unknown';
        
        return {
            fastest,
            results
        };
    }

    /**
     * Helper function to replace the definition and internal recursive calls of a function.
     * 
     * @param code - The string containing the function code.
     * @param originalName - The original name of the function.
     * @param newName - The new name to assign to the function.
     * @returns The modified code string with the function renamed and recursive calls updated.
     */
    public replaceRecursiveCalls(code: string, originalName: string, newName: string): string {
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

    // Process Original Function
}
