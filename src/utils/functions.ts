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
    // Very basic check - look for function keyword or arrow syntax
    const functionRegex = /function\s+(\w+)?\s*\(.*\)\s*{/;
    const arrowFunctionRegex = /(\w+)?\s*(\(.*\)|[\w.]+)\s*=>\s*({|[^;])/;
    const methodRegex = /(\w+)\s*\(.*\)\s*{/;
    const classRegex = /class\s+\w+/;
    
    // Check for function patterns
    if (functionRegex.test(code) || 
        arrowFunctionRegex.test(code) || 
        methodRegex.test(code) ||
        classRegex.test(code)) {
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
                reject(new Error(`Script exited with code ${code}: ${errorData}`));
                return;
            }
            
            resolve(outputData);
        });
        
        // Handle process errors
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