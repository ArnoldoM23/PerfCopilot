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
     */
    private parseBenchmarkResults(output: string): BenchmarkComparison {
        try {
            // Try to find the JSON results in the output
            const jsonMatch = output.match(/RESULTS_JSON:\s*({[\s\S]*?})/);
            
            if (jsonMatch && jsonMatch[1]) {
                const resultsJson = jsonMatch[1];
                const results = JSON.parse(resultsJson);
                
                return {
                    fastest: results.fastest || 'Unknown',
                    results: results.results || []
                };
            }
            
            // If no JSON results found, try to parse the text output
            const results = this.parseTextBenchmarkOutput(output);
            
            if (results.results.length > 0) {
                return results;
            }
            
            // If still no results, return a default result
            this.outputChannel.appendLine('Warning: Could not parse benchmark results');
            return {
                fastest: 'Unknown',
                results: []
            };
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing benchmark results: ${error}`);
            return {
                fastest: 'Error',
                results: []
            };
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