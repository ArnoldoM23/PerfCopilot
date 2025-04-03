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
 * @returns The output of the script
 */
export function runNodeScript(scriptPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Spawn a Node.js process
        const childProcess = spawn('node', [scriptPath]);
        
        let outputData = '';
        let errorData = '';
        
        // Collect stdout data
        childProcess.stdout.on('data', (data) => {
            outputData += data.toString();
        });
        
        // Collect stderr data
        childProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });
        
        // Handle process completion
        childProcess.on('close', (code) => {
            if (code !== 0) {
                // Include both stdout and stderr in the rejection for debugging
                reject(new Error(`Script exited with code ${code}. Stderr: ${errorData}. Stdout: ${outputData}`));
                return;
            }
            
            // Combine stdout and stderr in the resolved output for easier debugging
            const combinedOutput = outputData + (errorData ? `\n--- STDERR ---\n${errorData}` : '');
            resolve(combinedOutput);
        });
        
        // Handle process errors (e.g., node not found)
        childProcess.on('error', (err) => {
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
    
    // Try to match method definitions: name(...) {...}
    const methodMatch = functionCode.match(/^\s*([a-zA-Z_$][\w$]*)\s*\(/m);
    if (methodMatch) {
        return methodMatch[1];
    }
    
    return undefined;
}

/**
 * Calculates the percentage improvement between two operations per second values.
 * 
 * @param originalOps - The original operations per second
 * @param improvedOps - The improved operations per second
 * @returns The percentage improvement
 */
export function calculateImprovement(originalOps: number, improvedOps: number): number {
    if (originalOps <= 0) {
        return 0;
    }
    
    return ((improvedOps - originalOps) / originalOps) * 100;
} 