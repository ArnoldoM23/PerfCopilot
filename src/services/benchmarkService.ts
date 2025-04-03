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
            // Create a temporary file for the benchmark
            this.outputChannel.appendLine('Creating temporary benchmark file...');
            const tempFilePath = await createTempFile(benchmarkCode, 'perfcopilot-benchmark.js');
            
            // Ensure benny is installed locally
            await this.ensureBennyInstalled(path.dirname(tempFilePath));
            
            // Run the benchmark
            this.outputChannel.appendLine(`Running benchmark at ${tempFilePath}...`);
            const output = await runNodeScript(tempFilePath);
            
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
     * Ensures the benny package is installed in the temporary directory.
     * 
     * @param tempDir - The temporary directory path
     */
    private async ensureBennyInstalled(tempDir: string): Promise<void> {
        try {
            // Create a package.json if it doesn't exist
            const packageJsonPath = path.join(tempDir, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                fs.writeFileSync(packageJsonPath, JSON.stringify({
                    name: 'perfcopilot-benchmark',
                    version: '1.0.0',
                    private: true,
                    dependencies: {
                        'benny': '^3.7.1'
                    }
                }, null, 2));
            }
            
            // Create a node_modules symlink to the extension's node_modules if possible
            const extensionNodeModules = path.join(__dirname, '..', '..', 'node_modules');
            const tempNodeModules = path.join(tempDir, 'node_modules');
            
            if (fs.existsSync(extensionNodeModules) && !fs.existsSync(tempNodeModules)) {
                try {
                    // Try to create a symbolic link
                    fs.symlinkSync(extensionNodeModules, tempNodeModules, 'junction');
                    return;
                } catch (error) {
                    this.outputChannel.appendLine(`Could not create symlink: ${error}`);
                    // Fall back to npm install
                }
            }
            
            // Install benny using npm in the temporary directory
            this.outputChannel.appendLine('Installing benny package...');
            const { spawn } = require('child_process');
            const npm = spawn(
                process.platform === 'win32' ? 'npm.cmd' : 'npm',
                ['install', '--no-fund', '--no-audit'],
                { cwd: tempDir }
            );
            
            return new Promise((resolve, reject) => {
                npm.on('close', (code: number) => {
                    if (code !== 0) {
                        reject(new Error(`npm install exited with code ${code}`));
                        return;
                    }
                    resolve();
                });
                
                npm.on('error', (err: Error) => {
                    reject(err);
                });
            });
        } catch (error) {
            this.outputChannel.appendLine(`Error ensuring benny is installed: ${error}`);
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
            // then capture the starting '{' and everything non-greedily until the final '}' on potentially multiple lines.
            const jsonMatch = output.match(/^RESULTS_JSON:\s*({[\s\S]*})$/m);

            if (jsonMatch && jsonMatch[1]) {
                jsonString = jsonMatch[1];
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
                     this.outputChannel.appendLine(`Warning: Parsed JSON does not have expected structure { results: [], fastest: "" }. Parsed: ${JSON.stringify(parsed)}`);
                     // Fall through to error handling
                }
            } else {
                 this.outputChannel.appendLine(`RESULTS_JSON line not found or regex did not capture the JSON object correctly.`);
                 // Throw error if JSON line not found
                 throw new Error('RESULTS_JSON line not found in benchmark output.'); 
            }

            // Fallback or if primary parsing failed: Check for BENCHMARK_ERROR
            const errorMatch = output.match(/^BENCHMARK_ERROR:\s*({[\s\S]*?})$/m);
            if (errorMatch && errorMatch[1]) {
                this.outputChannel.appendLine(`Found BENCHMARK_ERROR line: ${errorMatch[1]}`);
                 // Throw an error instead of returning a specific structure
                 throw new Error(`Benchmark script reported error: ${errorMatch[1]}`);
            }

            // If we fall through without returning or throwing, it means parsing failed
            this.outputChannel.appendLine('Warning: Could not parse expected results from benchmark output.');
             throw new Error('Failed to parse expected RESULTS_JSON from script output.');

        } catch (error) {
            // Catch JSON.parse errors specifically
            this.outputChannel.appendLine(`Error parsing benchmark results JSON: ${error}`);
            // Log the string that failed parsing
            if (jsonString !== undefined) { // Only log if we thought we had a string
                 this.outputChannel.appendLine(`--- Failed JSON String ---\n${jsonString}\n------------------------`);
            }
             // Re-throw the error to be caught by runBenchmark
             throw new Error(`JSON Parsing failed: ${error}. See logs for details.`);
        }
    }
    
    /**
     * Parses benchmark results from plain text output.
     * 
     * @param output - The text output from the benchmark
     * @returns The parsed benchmark comparison results
     */
    private parseTextBenchmarkOutput(output: string): BenchmarkComparison {
        // Parse lines like "original x 1,234,567 ops/sec ±0.12% (95 runs sampled)"
        const resultRegex = /([\w\s\(\)]+)\s+x\s+([\d,\.]+)\s+ops\/sec\s+±([\d\.]+)%/g;
        const results = [];
        let match;
        
        while ((match = resultRegex.exec(output)) !== null) {
            const name = match[1].trim();
            const ops = parseFloat(match[2].replace(/,/g, ''));
            const margin = parseFloat(match[3]) / 100;
            
            results.push({ name, ops, margin });
        }
        
        // Sort results by ops descending to find the fastest
        results.sort((a, b) => b.ops - a.ops);
        
        const fastest = results.length > 0 ? results[0].name : 'Unknown';
        
        return {
            fastest,
            results
        };
    }
}
