/**
 * PerfCopilot Chat Participant
 * 
 * This file implements a VS Code Chat participant that handles performance optimization requests
 * for JavaScript/TypeScript functions via the chat interface.
 */

import * as vscode from 'vscode';
import { CopilotChatService } from './services/copilotChatService';
import { BenchmarkService } from './services/benchmarkService';
import { FunctionImplementation } from './models/types';
import { isValidJavaScriptFunction, extractFunctionName } from './utils/functions';

// Define the participant ID
const PERF_COPILOT_PARTICIPANT_ID = 'perfcopilot';

/**
 * PerfCopilotParticipant handles chat requests to optimize functions for performance.
 * Users can mention @perfcopilot in a VS Code Chat to analyze JavaScript functions.
 */
export class PerfCopilotParticipant {
    /**
     * Output channel for logging
     */
    private outputChannel: vscode.OutputChannel;
    
    /**
     * Copilot Chat Service for interaction with language models
     */
    private copilotChatService: CopilotChatService;
    
    /**
     * Benchmark Service for running performance tests
     */
    private benchmarkService: BenchmarkService;
    
    /**
     * Creates a new PerfCopilot chat participant
     * 
     * @param outputChannel - The output channel for logging
     * @param copilotChatService - The Copilot Chat service
     * @param benchmarkService - The benchmark service
     */
    constructor(
        outputChannel: vscode.OutputChannel,
        copilotChatService: CopilotChatService,
        benchmarkService: BenchmarkService
    ) {
        this.outputChannel = outputChannel;
        this.copilotChatService = copilotChatService;
        this.benchmarkService = benchmarkService;
    }
    
    /**
     * Registers the participant with the VS Code Chat API
     * 
     * @returns A disposable that can be used to unregister the participant
     */
    public register(): vscode.Disposable {
        this.outputChannel.appendLine('Registering PerfCopilot chat participant...');
        
        try {
            // Create a request handler that binds to this instance
            const requestHandler: vscode.ChatRequestHandler = this.createRequestHandler();
            
            // Register the participant with the VS Code Chat API
            const participant = vscode.chat.createChatParticipant(PERF_COPILOT_PARTICIPANT_ID, requestHandler);
            
            // Set the icon for the participant
            participant.iconPath = new vscode.ThemeIcon('rocket');
            
            this.outputChannel.appendLine('Successfully registered PerfCopilot chat participant');
            
            return participant;
        } catch (error) {
            this.outputChannel.appendLine(`Error registering chat participant: ${error}`);
            
            // Return a no-op disposable to avoid crashing the extension
            return {
                dispose: () => { /* no-op */ }
            };
        }
    }
    
    /**
     * Creates a request handler function bound to this instance
     * 
     * @returns A ChatRequestHandler function
     */
    private createRequestHandler(): vscode.ChatRequestHandler {
        // Return a function that closes over this instance
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            response: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            try {
                this.outputChannel.appendLine(`Received chat request: ${request.prompt.substring(0, 100)}...`);
                
                // Check if we should cancel
                if (token.isCancellationRequested) {
                    response.markdown('Request cancelled.');
                    return {};
                }
                
                // Extract function code from the request
                const functionCode = this.extractFunctionCodeFromPrompt(request.prompt);
                if (!functionCode) {
                    response.markdown(`
# ⚠️ No Valid Function Found

I couldn't find a valid JavaScript/TypeScript function in your request. 
Please provide a complete function definition to optimize.

## Example

\`\`\`javascript
function sumArray(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}
\`\`\`

Please paste your function code in a code block using triple backticks, or as plain text.
                    `);
                    return {};
                }
                
                // Validate function code
                if (!isValidJavaScriptFunction(functionCode)) {
                    response.markdown(`
# ⚠️ Invalid Function

The code you provided doesn't appear to be a valid JavaScript/TypeScript function.
Please provide a complete function definition with a proper function signature.

## Examples of Valid Functions

**Named function:**
\`\`\`javascript
function calculateAverage(numbers) {
  const sum = numbers.reduce((total, num) => total + num, 0);
  return sum / numbers.length;
}
\`\`\`

**Arrow function with explicit return:**
\`\`\`javascript
const multiply = (a, b) => {
  return a * b;
};
\`\`\`

**Arrow function with implicit return:**
\`\`\`javascript
const square = (x) => x * x;
\`\`\`
                    `);
                    return {};
                }
                
                // Extract function name for better messaging
                const functionName = extractFunctionName(functionCode) || 'anonymous function';
                
                // Create original function implementation
                const originalFunction: FunctionImplementation = {
                    name: 'Original',
                    code: functionCode,
                    description: 'Original implementation'
                };
                
                // Step 1: Generate alternative implementations
                response.progress('Generating alternative implementations...');
                response.markdown(`# 🚀 Analyzing \`${functionName}\` for performance optimization`);
                
                if (token.isCancellationRequested) {
                    response.markdown('Request cancelled.');
                    return {};
                }
                
                try {
                    const alternatives = await this.copilotChatService.getAlternativeImplementations(functionCode);
                    if (alternatives.length === 0) {
                        response.markdown(`
# No Alternative Implementations Found

I couldn't generate any alternative implementations for your function.
This may happen if:
- The function is already well-optimized
- The function is too complex for automatic optimization
- The function uses language features that are difficult to optimize

Please try with a different function, or simplify your current function.
                        `);
                        return {};
                    }
                    
                    // Step 2: Generate benchmark code
                    response.progress('Creating benchmark code...');
                    
                    if (token.isCancellationRequested) {
                        response.markdown('Request cancelled.');
                        return {};
                    }
                    
                    const benchmarkCode = await this.copilotChatService.getBenchmarkCode(originalFunction, alternatives);
                    
                    // Step 3: Run the benchmark
                    response.progress('Running benchmarks...');
                    response.markdown(`## Running performance benchmarks...\n\nComparing ${alternatives.length + 1} implementations.`);
                    
                    if (token.isCancellationRequested) {
                        response.markdown('Request cancelled.');
                        return {};
                    }
                    
                    const benchmarkResults = await this.benchmarkService.runBenchmark(benchmarkCode);
                    
                    // Step 4: Format and display results
                    response.progress('Analyzing results...');
                    
                    if (token.isCancellationRequested) {
                        response.markdown('Request cancelled.');
                        return {};
                    }
                    
                    // Format the results as markdown
                    const resultsMarkdown = this.copilotChatService.formatResultsAsMarkdown(
                        originalFunction,
                        alternatives,
                        benchmarkResults
                    );
                    
                    // Send the response
                    response.markdown(resultsMarkdown);
                    
                    // Return a result with metadata
                    return {
                        metadata: {
                            functionName,
                            benchmarkResults: {
                                fastest: benchmarkResults.fastest,
                                resultCount: benchmarkResults.results ? benchmarkResults.results.length : 0
                            }
                        }
                    };
                } catch (error) {
                    this.outputChannel.appendLine(`Error during performance analysis: ${error}`);
                    response.markdown(`
# ⚠️ Error During Analysis

An error occurred while analyzing your function:

\`\`\`
${error}
\`\`\`

This might be due to:
- Network connectivity issues
- Problems with the language model service
- Errors in the function syntax or semantics
- Memory constraints when running benchmarks

Please try again with a different function or check your internet connection.
                    `);
                    return {
                        metadata: {
                            error: String(error)
                        }
                    };
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error processing chat request: ${error}`);
                response.markdown(`
# ⚠️ Unexpected Error

An unexpected error occurred while processing your request:

\`\`\`
${error}
\`\`\`

Please try again with a different function or report this issue if it persists.
                `);
                return {
                    metadata: {
                        error: String(error)
                    }
                };
            }
        };
    }
    
    /**
     * Extracts function code from a chat prompt
     * 
     * @param prompt - The chat prompt
     * @returns The extracted function code, or undefined if none was found
     */
    private extractFunctionCodeFromPrompt(prompt: string): string | undefined {
        // Try to extract code blocks from the prompt
        const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/g;
        const codeBlocks: string[] = [];
        
        let match;
        while ((match = codeBlockRegex.exec(prompt)) !== null) {
            codeBlocks.push(match[1].trim());
        }
        
        // If we found code blocks, use the first one that looks like a function
        if (codeBlocks.length > 0) {
            for (const block of codeBlocks) {
                if (isValidJavaScriptFunction(block)) {
                    return block;
                }
            }
            
            // If none of the blocks look like functions, return the first block
            return codeBlocks[0];
        }
        
        // If no code blocks were found, try to find function-like patterns
        const functionRegex = /function\s+\w+\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/g;
        const arrowFunctionRegex = /(?:const|let|var)?\s*\w+\s*=\s*(?:\([\s\S]*?\)|\w+)\s*=>\s*(?:\{[\s\S]*?\}|[^;]*)/g;
        
        // Try to find a function declaration
        const functionMatch = functionRegex.exec(prompt);
        if (functionMatch) {
            return functionMatch[0];
        }
        
        // Try to find an arrow function
        const arrowMatch = arrowFunctionRegex.exec(prompt);
        if (arrowMatch) {
            return arrowMatch[0];
        }
        
        // If all else fails, try to use the whole prompt
        if (isValidJavaScriptFunction(prompt)) {
            return prompt;
        }
        
        return undefined;
    }
} 