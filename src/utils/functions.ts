/**
 * @fileoverview Utility Functions for PerfCopilot
 * 
 * This file provides a collection of helper functions used across the PerfCopilot extension.
 * These include:
 * - Basic JavaScript function validation.
 * - Temporary file creation.
 * - Execution of Node.js scripts as child processes.
 * - Extraction of function names from code strings.
 */

/**
 * Utility Functions for PerfCopilot
 * 
 * This file contains various utility functions used throughout the extension.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { spawn } from 'child_process';

/**
 * Checks if the provided code is likely a valid JavaScript function.
 * This is a basic validation to help guide users.
 * 
 * @param code - The code to validate
 * @returns True if the code appears to be a valid JavaScript function
 */
export function isValidJavaScriptFunction(code: string): boolean {
    const trimmedCode = code.trim();

    // Basic sanity checks
    if (!trimmedCode || trimmedCode.startsWith('//') || trimmedCode.startsWith('/*')) {
        return false;
    }

    // Very basic check: Does it contain 'function' or '=>'?
    // This is loose but avoids complex regex issues.
    // We rely on later stages (LLM, benchmark runner) to catch truly invalid syntax.
    const hasFunctionKeyword = /\bfunction\b/.test(trimmedCode);
    const hasArrow = /=>/.test(trimmedCode);

    if (hasFunctionKeyword || hasArrow) {
        return true;
    }

    // Maybe it's a simple method definition like `methodName() { ... }`?
    // Check for identifier followed by parens and brace.
    const methodLikely = /^\s*[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*\{/.test(trimmedCode);
    if (methodLikely) {
        return true;
    }

    return false;
}


/**
 * Creates a temporary file with the given content.
 * 
 * @param content - The content to write to the file
 * @param filename - The name of the file (without path)
 * @returns The path to the created file
 */
export async function createTempFile(content: string, filename: string): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), 'perfcopilot');
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(tmpDir)) {
        await promisify(fs.mkdir)(tmpDir, { recursive: true });
    }
    
    // Write the file
    const filePath = path.join(tmpDir, filename);
    await promisify(fs.writeFile)(filePath, content);
    
    return filePath;
}

/**
 * Runs a NodeJS script and returns its output.
 * 
 * @param scriptPath - The path to the script to run
 * @param args - Optional array of arguments to pass to the script
 * @returns The output of the script
 */
export function runNodeScript(scriptPath: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
        console.log(`[runNodeScript] Spawning: node ${scriptPath} ${args.join(' ')}`);
        // CRITICAL: Spawns the benchmark runner script as a separate Node.js process
        const childProcess = spawn('node', [scriptPath, ...args]);
        
        let outputData = '';
        let errorData = '';
        
        // Collect stdout data
        childProcess.stdout.on('data', (data) => {
            console.log(`[runNodeScript STDOUT chunk]: ${data.toString()}`);
            outputData += data.toString();
        });
        
        // Collect stderr data
        childProcess.stderr.on('data', (data) => {
            console.log(`[runNodeScript STDERR chunk]: ${data.toString()}`);
            errorData += data.toString();
        });
        
        // Handle process completion
        // CRITICAL: Collects stdout/stderr and resolves/rejects based on exit code
        childProcess.on('close', (code) => {
            const combinedOutput = outputData + (errorData ? `\n--- STDERR ---\n${errorData}` : '');
            console.log(`[runNodeScript] Process closed. Code: ${code}. Total captured output length: ${combinedOutput.length}`);

             // +++ ADD UNIQUE MARKER LOGS around the full output +++
             console.log(`>>> !!! BENCHMARK RUNNER SCRIPT OUTPUT START !!! >>>`);
             console.log(combinedOutput); // Log the whole captured output
             console.log(`<<< !!! BENCHMARK RUNNER SCRIPT OUTPUT END !!! <<<`);
             // +++ END UNIQUE MARKER LOGS +++
             
            if (code !== 0) {
                console.log(`[runNodeScript] Rejecting due to non-zero exit code.`);
                reject(new Error(`Script exited with code ${code}. Stderr: ${errorData}. Stdout: ${outputData}`));
                return;
            }
            
            console.log(`[runNodeScript] Resolving successfully.`);
            resolve(combinedOutput);
        });
        
        // Handle process errors (e.g., node not found)
        childProcess.on('error', (err) => {
            console.log(`[runNodeScript] Process error event: ${err}`);
            reject(err);
        });
    });
}

/**
 * Extracts a function name from a function code string.
 * 
 * @param functionCode - The function code to extract the name from
 * @returns The function name or undefined if not found
 */
export function extractFunctionName(functionCode: string): string | undefined {
    // CRITICAL: Regex-based extraction of function name for user display/identification
    // Note: Relies on common function definition patterns.
    // Try to match function declarations: function name(...) {...}
    const funcDeclarationMatch = functionCode.match(/function\s+([a-zA-Z_$][\w$]*)\s*\(/);
    if (funcDeclarationMatch) {
        return funcDeclarationMatch[1];
    }
    
    // Try to match arrow functions with explicit name: const name = (...) => {...}
    const arrowFuncMatch = functionCode.match(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
    if (arrowFuncMatch) {
        return arrowFuncMatch[1];
    }

    // Try to match function expressions: const name = function(...) {...}
    const funcExpressionMatch = functionCode.match(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/);
    if (funcExpressionMatch) {
        return funcExpressionMatch[1];
    }
    
    // Try to match method definitions: name(...) {...}
    const methodMatch = functionCode.match(/^\s*([a-zA-Z_$][\w$]*)\s*\(/m);
    if (methodMatch) {
        return methodMatch[1];
    }
    
    return undefined;
} 
