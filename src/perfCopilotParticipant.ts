/**
 * PerfCopilot Chat Participant
 * 
 * This file implements a VS Code Chat participant that handles performance optimization requests
 * for JavaScript/TypeScript functions via the chat interface.
 */

import * as vscode from 'vscode';
import { BenchmarkService } from './services/benchmarkService';
import { FunctionImplementation } from './models/types';
import { isValidJavaScriptFunction, extractFunctionName } from './utils/functions';
import { verifyFunctionalEquivalence } from './utils/correctnessVerifier';

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
     * Benchmark Service for running performance tests
     */
    private benchmarkService: BenchmarkService;
    
    /**
     * Creates a new PerfCopilot chat participant
     * 
     * @param outputChannel - The output channel for logging
     * @param benchmarkService - The benchmark service
     */
    constructor(
        outputChannel: vscode.OutputChannel,
        benchmarkService: BenchmarkService
    ) {
        this.outputChannel = outputChannel;
        this.benchmarkService = benchmarkService;
        this.outputChannel.appendLine('PerfCopilotParticipant initialized.');
    }
    
    /**
     * Registers the participant with the VS Code Chat API
     * 
     * @returns A disposable that can be used to unregister the participant
     */
    public register(): vscode.Disposable {
        this.outputChannel.appendLine('Registering PerfCopilot chat participant...');
        
        try {
            const requestHandler: vscode.ChatRequestHandler = this.createRequestHandler();
            const participant = vscode.chat.createChatParticipant(PERF_COPILOT_PARTICIPANT_ID, requestHandler);
            participant.iconPath = new vscode.ThemeIcon('rocket');
            participant.followupProvider = {
                provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) {
                    if (result.metadata?.functionName) {
                        return [{ prompt: `Explain the optimizations for ${result.metadata.functionName} again`, label: 'Explain Again' }];
                    }
                    return [];
                }
            };
            
            this.outputChannel.appendLine('Successfully registered PerfCopilot chat participant');
            return participant;
        } catch (error) {
            this.outputChannel.appendLine(`Error registering chat participant: ${error}`);
            vscode.window.showErrorMessage(`Failed to register PerfCopilot chat participant: ${error}`);
            return { dispose: () => {} };
        }
    }
    
    /**
     * Helper function to send request to LLM with retry logic.
     */
    private async sendRequestWithRetry(
        languageModel: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        token: vscode.CancellationToken,
        maxRetries: number = 1 // Default to 1 retry (2 attempts total)
    ): Promise<vscode.LanguageModelChatResponse> {
        let attempts = 0;
        while (attempts <= maxRetries) {
            attempts++;
            try {
                this.outputChannel.appendLine(`[LLM Request Attempt ${attempts}/${maxRetries + 1}] Sending...`);
                const response = await languageModel.sendRequest(messages, options, token);
                // Basic check: Does the response stream seem valid?
                // We can't fully consume the stream here, but we can check if it exists.
                if (!response || !response.stream) { 
                    throw new Error('LLM response or response stream is invalid.');
                }
                this.outputChannel.appendLine(`[LLM Request Attempt ${attempts}] Success.`);
                return response;
            } catch (error: any) {
                // Convert error to string before logging
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[LLM Request Attempt ${attempts}] FAILED: ${errorMessage}`);
                if (attempts > maxRetries) {
                    this.outputChannel.appendLine(`[LLM Request] Max retries reached. Throwing last error.`);
                    throw error; // Throw the last error after all retries
                }
                // Optional: Add a small delay before retrying
                if (!token.isCancellationRequested) {
                     await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                }
                if (token.isCancellationRequested) {
                     throw new Error('Operation cancelled by user during retry wait.');
                }
            }
        }
        // Should not be reachable, but satisfies compiler
        throw new Error('sendRequestWithRetry logic error: loop completed unexpectedly.');
    }

    /**
     * Creates a request handler function using vscode.lm for LLM interaction.
     */
    private createRequestHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            response: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            this.outputChannel.appendLine(`Received request: ${request.prompt.substring(0, 100)}...`);
            let languageModel: vscode.LanguageModelChat | undefined;

            try {
                try {
                    const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
                    if (models.length > 0) {
                        languageModel = models[0];
                        this.outputChannel.appendLine(`Selected language model: ${languageModel.vendor}/${languageModel.name}`);
                    } else {
                        const fallbackModels = await vscode.lm.selectChatModels({ family: 'gpt-4' });
                         if (fallbackModels.length > 0) {
                            languageModel = fallbackModels[0];
                            this.outputChannel.appendLine(`Selected fallback language model: ${languageModel.vendor}/${languageModel.name}`);
                        } else {
                            throw new Error('No suitable language model found (tried Copilot and GPT-4 family).');
                        }
                    }
                } catch (lmError) {
                    this.outputChannel.appendLine(`Language model selection error: ${lmError}`);
                    response.markdown(`🔴 **Error:** Could not access a suitable language model. Please ensure Copilot Chat or a compatible AI provider is active. \n\`\`\`\n${lmError}\n\`\`\``);
                    return { metadata: { error: `Language model selection error: ${lmError}` } };
                }

                if (token.isCancellationRequested) {
                    response.markdown("Operation cancelled by user.");
                    return {};
                }

                response.progress('Extracting function...');
                const functionCode = this.extractFunctionCodeFromPrompt(request.prompt);

                if (!functionCode) {
                    response.markdown(`🔴 **Error:** No JavaScript/TypeScript function found in your request. 
Please provide the function code directly or within a code block (\`\`\`js ... \`\`\`).

**Example:**
\`\`\`js
@perfcopilot
function calculateSum(arr) {
  let sum = 0;
  for(let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}
\`\`\`
`);
                    return { metadata: { error: 'No function code extracted from prompt.' } };
                }

                if (!isValidJavaScriptFunction(functionCode)) {
                     response.markdown(`🔴 **Error:** The extracted code does not appear to be a valid JavaScript/TypeScript function. 
Please ensure it has a correct structure (e.g., \`function name(...){...}\` or \`const name = (...) => {...}\`).

**Extracted Code:**
\`\`\`javascript
${functionCode.substring(0, 500)}${functionCode.length > 500 ? '...' : ''}\n\`\`\`
`);
                    return { metadata: { error: 'Invalid function code extracted.' } };
                }

                 const functionName = extractFunctionName(functionCode) || 'anonymous function';
                 const originalFunction: FunctionImplementation = { name: 'Original', code: functionCode, description: 'Original implementation' };
                 response.markdown(`✅ Function \`${functionName}\` identified. Analyzing...`);

                if (token.isCancellationRequested) {
                    response.markdown("Operation cancelled by user.");
                    return {};
                }

                response.progress('Generating alternative implementations...');
                const alternativesPrompt = this.createAlternativesPrompt(functionCode);
                this.outputChannel.appendLine(`\n--- Alternatives Prompt ---\n${alternativesPrompt}\n--------------------------\n`);
                const alternativesMessages = [vscode.LanguageModelChatMessage.User(alternativesPrompt)];
                let alternativesResponseText = '';
                try {
                    // FIX: Use retry helper
                    const alternativesRequest = await this.sendRequestWithRetry(languageModel, alternativesMessages, {}, token);
                    
                    for await (const chunk of alternativesRequest.stream) { 
                        if (token.isCancellationRequested) {
                            response.markdown("Operation cancelled by user.");
                            break;
                        }
                        
                        // --- Correct Handling based on Docs ---
                        if (chunk instanceof vscode.LanguageModelTextPart) {
                            alternativesResponseText += chunk.value; // Access the 'value' property
                        } 
                        // --- End Correct Handling ---
                         
                    }
                    if (token.isCancellationRequested) {
                        response.markdown("Operation cancelled by user.");
                        return {};
                    }
                    this.outputChannel.appendLine(`Received alternatives response length: ${alternativesResponseText.length}`);
                    this.outputChannel.appendLine(`\n--- Alternatives Raw Response ---\n${alternativesResponseText}\n-------------------------------\n`);

                } catch (error) {
                     this.outputChannel.appendLine(`Error getting alternatives: ${error}`);
                     response.markdown(`🔴 **Error:** Failed to generate alternative implementations. \n\`\`\`\n${error}\n\`\`\``);
                     return { metadata: { error: `LLM error getting alternatives: ${error}` } };
                }

                const alternatives = this.parseAlternativeImplementations(functionCode, alternativesResponseText);
                if (alternatives.length === 0) {
                    this.outputChannel.appendLine('Parsing alternatives resulted in an empty array. Check raw response and parsing logic.');
                    response.markdown(`ℹ️ No alternative implementations were successfully parsed from the AI response. Please check the PerfCopilot logs for details.`);
                    return { metadata: { message: 'No alternatives parsed.' } };
                }
                 response.markdown(`✅ Generated ${alternatives.length} alternative implementations.`);

                 // Initialize verifiedAlternatives with all alternatives as a fallback
                 let verifiedAlternatives: FunctionImplementation[] = alternatives;

                 // --- MOVED: Correctness Check (Moved after benchmark config generation) ---
                 // response.progress('Verifying functional correctness...');
                 // let verifiedAlternatives: FunctionImplementation[] = [];
                 // try {
                 //     verifiedAlternatives = await verifyFunctionalEquivalence(...)
                 // } ...
                 // --- End Moved Block ---

                 if (token.isCancellationRequested) {
                    response.markdown("Operation cancelled by user.");
                    return {};
                 }

                response.progress('Generating benchmark code via AI...');
                let benchmarkCode: string | undefined;
                try {
                    // Use only verified alternatives for benchmarking
                    const benchmarkPrompt = this.createBenchmarkPrompt(originalFunction, alternatives);
                    const benchmarkMessages = [vscode.LanguageModelChatMessage.User(benchmarkPrompt)];
                    
                    // FIX: Use retry helper
                    const benchmarkRequest = await this.sendRequestWithRetry(languageModel, benchmarkMessages, {}, token);
                    
                    // FIX: Use the same stream handling as for alternatives
                    let benchmarkResponseText = '';
                    for await (const chunk of benchmarkRequest.stream) { 
                        if (token.isCancellationRequested) {
                            response.markdown("Operation cancelled by user.");
                            break;
                        }
                        
                        if (chunk instanceof vscode.LanguageModelTextPart) {
                            benchmarkResponseText += chunk.value; // Access the 'value' property
                        } else {
                            // Log unexpected chunk types for diagnostics
                            this.outputChannel.appendLine(`[Benchmark Config Stream] Received unexpected chunk type: ${typeof chunk} - ${JSON.stringify(chunk)}`);
                        }
                    }
                    if (token.isCancellationRequested) { return {}; }

                    // Parse the JSON response containing entry point, test data, and implementations
                    let benchmarkConfig: { entryPointName: string; testData: any; implementations: Record<string, string> };
                    const jsonBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/s; // Match JSON object
                    const match = jsonBlockRegex.exec(benchmarkResponseText);
                    if (match && match[1]) {
                        const jsonString = match[1].trim();
                        this.outputChannel.appendLine(`[DEBUG] Extracted benchmark config JSON string:\n${jsonString}`); // Log the raw JSON
                        try {
                            benchmarkConfig = JSON.parse(jsonString);
                            // Log the parsed config structure
                            this.outputChannel.appendLine(`[DEBUG] Parsed benchmarkConfig object:\n${JSON.stringify(benchmarkConfig, null, 2)}`);

                            // Specifically log the parsed testData
                            this.outputChannel.appendLine(`[DEBUG] Parsed testData type: ${typeof benchmarkConfig.testData}, value: ${JSON.stringify(benchmarkConfig.testData)}`);

                            // Basic validation
                            if (!benchmarkConfig.entryPointName || typeof benchmarkConfig.entryPointName !== 'string' ||
                                !benchmarkConfig.implementations || typeof benchmarkConfig.implementations !== 'object' ||
                                benchmarkConfig.testData === undefined) { // Allow null for testData
                                throw new Error('Invalid JSON structure received for benchmark config.');
                            }
                            this.outputChannel.appendLine(`Parsed benchmark config JSON. Entry Point: ${benchmarkConfig.entryPointName}`);
                            response.markdown(`✅ AI identified entry point and generated test data.`);
                        } catch (parseError) {
                             this.outputChannel.appendLine(`Failed to parse benchmark config JSON: ${parseError}\nRaw JSON string: ${jsonString}`);
                             throw new Error('Failed to parse benchmark configuration from AI response.');
                        }
                    } else {
                        this.outputChannel.appendLine(`Could not extract benchmark config JSON from LLM response: ${benchmarkResponseText}`);
                        throw new Error('Failed to extract benchmark configuration JSON from AI response.');
                    }

                    // --- NEW: Correctness Check (Run AFTER getting entryPointName) ---
                    response.progress('Verifying functional correctness...');
                    try {
                        // Use the entryPointName identified by the LLM for verification
                        const checkResults = await verifyFunctionalEquivalence(
                            originalFunction, 
                            alternatives, 
                            languageModel, 
                            this.createInputGenerationPrompt.bind(this), 
                            this.outputChannel,
                            token,
                            benchmarkConfig.entryPointName // Use LLM-identified entry point
                        );

                        // If successful, update verifiedAlternatives
                        verifiedAlternatives = checkResults;

                        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }

                        if (verifiedAlternatives.length < alternatives.length) {
                            response.markdown(`ℹ️ Rejected ${alternatives.length - verifiedAlternatives.length} alternatives due to incorrect results.`);
                        }
                        if (verifiedAlternatives.length === 0) {
                            response.markdown('🔴 **Error:** No alternative implementations passed the functional correctness check. Cannot proceed with benchmarking.');
                            return { metadata: { error: 'All alternatives failed correctness check.' } };
                        }
                        response.markdown(`✅ ${verifiedAlternatives.length} alternatives passed correctness check.`);

                    } catch (error: any) {
                        if (token.isCancellationRequested) { 
                            response.markdown("Operation cancelled by user.");
                            return {}; 
                        }
                        this.outputChannel.appendLine(`Error during functional verification: ${error.message}`);
                        response.markdown(`⚠️ **Warning:** Could not verify functional correctness due to an error: ${error.message}. Proceeding with all generated alternatives.`);
                        // Fallback: verifiedAlternatives already contains the original 'alternatives' 
                    }
                    // --- End Correctness Check ---

                    if (token.isCancellationRequested) {
                        response.markdown("Operation cancelled by user.");
                        return {};
                    }

                    // --- Process Implementations for Runner ---
                    this.outputChannel.appendLine('Processing implementations for benchmark runner...');
                    const processedImplementations: Record<string, string> = {};
                    const originalEntryPoint = benchmarkConfig.entryPointName;
                    
                    // Use ONLY verified alternatives from now on
                    const implementationsToProcess = {
                        [originalFunction.name]: originalFunction.code,
                        ...Object.fromEntries(verifiedAlternatives.map(alt => [alt.name, alt.code]))
                    };

                    for (const [rawKey, code] of Object.entries(implementationsToProcess)) {
                        // Sanitize the key to be a valid JS identifier (e.g., "Alternative 1" -> "Alternative_1")
                        const sanitizedKey = rawKey.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                        this.outputChannel.appendLine(`Processing implementation: ${rawKey} -> ${sanitizedKey}`);
                        
                        // Replace original function name and recursive calls with the sanitized key
                        const processedCode = this.benchmarkService.replaceRecursiveCalls(
                            code,
                            originalEntryPoint,
                            sanitizedKey
                        );
                        processedImplementations[sanitizedKey] = processedCode;
                        this.outputChannel.appendLine(` -> Code processed for ${sanitizedKey}. Length: ${processedCode.length}`);
                    }
                    // --- End Processing ---

                    // Log the final testData and implementations just before module creation
                    this.outputChannel.appendLine(`[DEBUG] Final testData for benchmark module: ${JSON.stringify(benchmarkConfig.testData)}`);
                    this.outputChannel.appendLine(`[DEBUG] Final implementations for benchmark module keys: ${Object.keys(processedImplementations).join(', ')}`);

                    // Construct the actual code module to be run by benchmarkRunner.js
                    benchmarkCode = `
// Benchmark configuration generated by PerfCopilot
// Entry Point Name was: ${JSON.stringify(benchmarkConfig.entryPointName)} (used internally)
const testData = ${JSON.stringify(benchmarkConfig.testData, null, 2)}; // Pretty-print testData
const implementations = {
${Object.entries(processedImplementations).map(([key, code]) => 
    // Key is already sanitized, code is processed
    `  ${JSON.stringify(key)}: ${JSON.stringify(code)}`).join(',\n')}
};

module.exports = {
    // entryPointName, // Removed - runner uses keys from implementations
    testData,
    implementations
};
                    `;
                    // Log the generated benchmark code
                    this.outputChannel.appendLine(`[DEBUG] Generated benchmark module code:\n---\n${benchmarkCode}\n---`);

                    this.outputChannel.appendLine(`Generated benchmark module code. Length: ${benchmarkCode.length}`);

                } catch (error) {
                    this.outputChannel.appendLine(`Error generating benchmark code via AI: ${error}`);
                    response.markdown(`🔴 **Error:** Failed to generate benchmark code using AI. \n\`\`\`\n${error}\n\`\`\``);
                    return { metadata: { error: `Benchmark generation error (LLM): ${error}` } };
                }

                response.progress('Running benchmarks...');
                if (!benchmarkCode) {
                    this.outputChannel.appendLine('Benchmark code is undefined. Aborting run.');
                    response.markdown(`🔴 **Error:** Benchmark code was not successfully generated or extracted. Cannot run benchmarks.`);
                    return { metadata: { error: 'Missing benchmark code before execution.' } };
                }
                let benchmarkResults: any;
                try {
                    benchmarkResults = await this.benchmarkService.runBenchmark(benchmarkCode);
                    this.outputChannel.appendLine(`Benchmark results received: ${JSON.stringify(benchmarkResults)}`);
                    if (!benchmarkResults || !benchmarkResults.results || benchmarkResults.results.length === 0) {
                        throw new Error('Benchmark process did not produce valid results.');
                    }
                    response.markdown(`✅ Benchmarks completed.`);
                } catch (error) {
                    this.outputChannel.appendLine(`Error running benchmark: ${error}`);
                    response.markdown(`🔴 **Error:** Failed to run benchmarks. This might be due to errors in the generated code or resource limits. \n\`\`\`\n${error}\n\`\`\``);
                    return { metadata: { error: `Benchmark execution error: ${error}` } };
                }

                if (token.isCancellationRequested) {
                    response.markdown("Operation cancelled by user.");
                    return {};
                }

                response.progress('Analyzing benchmark results with AI...');
                // Use only verified alternatives for the final explanation
                const explanationPrompt = this.createExplanationPrompt(originalFunction, verifiedAlternatives, benchmarkResults);
                const explanationMessages = [vscode.LanguageModelChatMessage.User(explanationPrompt)];
                
                try {
                    // FIX: Use retry helper
                    const explanationRequest = await this.sendRequestWithRetry(languageModel, explanationMessages, {}, token);
                    
                    for await (const chunk of explanationRequest.stream) { // Use stream property
                         if (token.isCancellationRequested) {
                            response.markdown("Operation cancelled by user.");
                            break;
                         }
                         // --- Correct Handling based on Docs ---
                         if (chunk instanceof vscode.LanguageModelTextPart) {
                             response.markdown(chunk.value); // Display text part value
                         } else {
                            // Log unexpected chunk types for diagnostics 
                            this.outputChannel.appendLine(`[Explanation Stream] Received unexpected chunk type: ${typeof chunk} - ${JSON.stringify(chunk)}`);
                         }
                         // --- End Correct Handling ---
                    }
                     if (token.isCancellationRequested) {return {};}
                    this.outputChannel.appendLine(`Finished streaming explanation.`);

                } catch (error) {
                    this.outputChannel.appendLine(`Error getting explanation: ${error}`);
                    response.markdown(`🔴 **Error:** Failed to get AI analysis of results. \n\`\`\`\n${error}\n\`\`\`\n\n**Raw Benchmark Results:**\n\`\`\`json\n${JSON.stringify(benchmarkResults, null, 2)}\n\`\`\``);
                    return { metadata: { error: `LLM error getting explanation: ${error}`, benchmarkResults } };
                }

                this.outputChannel.appendLine('Request processed successfully.');
                return { 
                    metadata: { 
                        functionName, 
                        benchmarkResults: {
                             fastest: benchmarkResults.fastest,
                             resultCount: benchmarkResults.results.length
                        }
                     } 
                };

            } catch (error) {
                this.outputChannel.appendLine(`Unhandled error in request handler: ${error}`);
                response.markdown(`🔴 **Unexpected Error:** An error occurred while processing your request. \n\`\`\`\n${error}\n\`\`\``);
                return { metadata: { error: `Unexpected error: ${error}` } };
            }
        };
    }
    
    private createAlternativesPrompt(functionCode: string): string {
         return `
Analyze the following JavaScript/TypeScript function for performance optimization opportunities:

\`\`\`javascript
${functionCode}
\`\`\`

Generate exactly two distinct alternative implementations aiming for improved performance.

Maintain the original function's signature and core functionality.

**Output Format:**
Provide your response strictly as a JSON array containing two objects. Each object must have the following properties:
- \`name\`: A string, either "Alternative 1" or "Alternative 2".
- \`code\`: A string containing the complete JavaScript code for the alternative implementation.
- \`explanation\`: A brief (1-2 sentence) string explaining the optimization technique used.

**Example Response:**
\`\`\`json
[
  {
    "name": "Alternative 1",
    "code": "const example1 = () => { /* ... optimized code ... */ };",
    "explanation": "Uses technique X for optimization."
  },
  {
    "name": "Alternative 2",
    "code": "const example2 = () => { /* ... another optimized code ... */ };",
    "explanation": "Uses technique Y for optimization."
  }
]
\`\`\`

**IMPORTANT:** Output *only* the JSON array within a single \`\`\`json code block. Do not include any introductory text, greetings, or other explanations outside the JSON structure.
`;
    }

     private createExplanationPrompt(
        originalFunction: FunctionImplementation,
        alternatives: FunctionImplementation[],
        benchmarkResults: any
    ): string {
         const implementations = [originalFunction, ...alternatives];
         const functionsString = implementations.map(impl => `
### ${impl.name}
${impl.description ? `> ${impl.description}\\n` : ''}
\`\`\`javascript
${impl.code}
\`\`\`
`).join('\\n');

         const resultsString = JSON.stringify(benchmarkResults, null, 2);

         return `
You are a performance analysis assistant. Analyze the following JavaScript/TypeScript function implementations and their benchmark results.

**Implementations Provided:**
${functionsString}

**Benchmark Results (Benny.js format):**
\`\`\`json
${resultsString}
\`\`\`

**Your Task:**

1.  **Identify the Fastest:** Determine which implementation ('Original', 'Alternative 1', etc.) was fastest based on the 'ops' (operations per second) field.
2.  **Explain Performance:** Provide a clear, concise explanation for *why* the fastest implementation performs better than the others (especially the original). Refer *specifically* to code differences (e.g., "uses \`Array.map\` instead of a \`for\` loop", "employs memoization", "reduces object allocations"). If the original is fastest, explain why the alternatives might not have improved performance in this context.
3.  **Format as Markdown:** Present your analysis clearly. Use headings, lists, and code formatting. Include:
    *   A main heading (e.g., "# Performance Analysis").
    *   A **Summary** section stating the fastest implementation and percentage improvement over the original (calculate this: \`((fastestOps - originalOps) / originalOps) * 100\`). Handle the case where the original is fastest.
    *   A **Benchmark Results** section with a simple markdown table summarizing Name and Ops/sec. Indicate the fastest with a ⭐.
    *   A section titled **Implementations Compared** that includes the *full code* for the 'Original', 'Alternative 1', and 'Alternative 2' functions, each within its own labeled Javascript code block (\`\`\`javascript ... \`\`\`).
    *   A detailed **Explanation** section covering point #2 above (why the fastest was fastest).
    *   A final section **Fastest Implementation** showing the *full code* of the winning implementation again in a Javascript code block.

Provide *only* the markdown analysis. Do not include introductory or concluding remarks outside the markdown structure.
`;
    }

    private createBenchmarkPrompt(
        originalFunction: FunctionImplementation,
        alternatives: FunctionImplementation[]
    ): string {
        // Prompt asking LLM to identify entry point, generate data, and return JSON
        return `\\\nYou are a JavaScript code generation assistant.\\\nYour task is to generate a simple Node.js module that exports function implementations, suitable test data, and identifies the main entry point for benchmarking.\\\n\\\n**Function Implementations Provided:**\\\n\\\n*These code blocks contain the complete source for the Original function and its Alternatives. Each block might contain multiple helper functions.*\\\n\\\n\\\`\\\`\\\`javascript\\\n// --- Original ---\\\n${originalFunction.code}\\\n\\\`\\\`\\\`\\\n\\\n${alternatives.map(alt => `\\\`\\\`\\\`javascript\\\n// --- ${alt.name} ---\\\n${alt.code}\\\n\\\`\\\`\\\`\\\n`).join('\\\\n')}\\\n\\\n**Requirements:**\\\n\\\n1.  **Identify Entry Point:** Determine the main function that should be called for benchmarking. This is typically the primary function being optimized or the one that orchestrates calls to helpers within the snippet. For example, if \\\`naiveFactorial\\\` and \\\`processNumbers\\\` are provided, the entry point is likely \\\`processNumbers\\\`.\\\n2.  **Define Test Data:** Create test data assigned to a variable named \\\`testData\\\`. This data must be **suitable and sufficiently large/complex** for calling the identified **Entry Point Function** to reveal potential performance differences. \\\n    *   Example: If the entry point is \\\`processNumbers(numbers)\\\`, \\\`testData\\\` should be an array like \\\`[5, 10, 15, 8, 12]\\\`.\\\n    *   Example: If the entry point is \\\`slowSum(n)\\\`, \\\`testData\\\` should be a number like \\\`100\\\` or \\\`500\\\`.\\\n3.  **Format Output as JSON:** Structure your entire response as a single JSON object within a \\\`\\\`\\\`json code block. The JSON object must have the following properties:\\\n    *   \\\`entryPointName\\\` (string): The name of the identified entry point function (e.g., \\\"processNumbers\\\", \\\"slowSum\\\").\\\n    *   \\\`testData\\\` (any): The generated test data suitable for the entry point function.\\\n    *   \\\`implementations\\\` (object): An object where keys are 'Original', 'Alternative 1', 'Alternative 2' and values are strings containing the complete, unmodified source code for each corresponding implementation (including any helper functions as provided above).\\\n\\\n**Example JSON Output:**\\\n\\\n\\\`\\\`\\\`json\\\n{\\\n  \\\"entryPointName\\\": \\\"processNumbers\\\",\\\n  \\\"testData\\\": [5, 10, 15, 8, 12],\\\n  \\\"implementations\\\": {\\\n    \\\"Original\\\": \\\"function naiveFactorial(n) { /*...*/ }\\\\\\\\nfunction processNumbers(numbers) { /*...*/ }\\\",\\\n    \\\"Alternative 1\\\": \\\"function optimizedFactorial(n) { /*...*/ }\\\\\\\\nfunction processNumbersAlt1(numbers) { /*...*/ }\\\",\\\n    \\\"Alternative 2\\\": \\\"/* ... */\\\"\\\n  }\\\n}\\\n\\\`\\\`\\\`\\\n\\\n**IMPORTANT:** Output *only* the JSON object within the code block. Do not include any other text, explanations, or require statements.\\\nGenerate the JSON output now.\\\n`;
    }

    private parseAlternativeImplementations(originalCode: string, responseText: string): FunctionImplementation[] {
        let alternatives: FunctionImplementation[] = [];
        this.outputChannel.appendLine(`Attempting to parse alternatives as JSON...`);

        try {
            // Regex to find JSON code block
            const jsonBlockRegex = /```(?:json)?\s*([\[][\s\S]*[\]])\s*```/;
            const match = responseText.match(jsonBlockRegex);

            let jsonString: string | undefined;

            if (match && match[1]) {
                jsonString = match[1].trim();
                this.outputChannel.appendLine(`Found JSON block.`);
            } else {
                // Fallback: Assume the entire response might be the JSON array if no block found
                this.outputChannel.appendLine(`No JSON block found, attempting to parse entire response as JSON array.`);
                const trimmedResponse = responseText.trim();
                if (trimmedResponse.startsWith('[') && trimmedResponse.endsWith(']')) {
                    jsonString = trimmedResponse;
                }
            }

            if (!jsonString) {
                this.outputChannel.appendLine(`Could not extract a JSON array string from the response.`);
                return [];
            }
            

            const parsed = JSON.parse(jsonString);

            if (!Array.isArray(parsed)) {
                this.outputChannel.appendLine(`Parsed JSON is not an array.`);
                return [];
            }

            // Validate and map the parsed objects
            for (const item of parsed) {
                if (item && typeof item.name === 'string' && typeof item.code === 'string' && typeof item.explanation === 'string') {
                    alternatives.push({
                        name: item.name,
                        code: item.code,
                        description: item.explanation // Use 'explanation' field from JSON
                    });
                } else {
                    this.outputChannel.appendLine(`Skipping invalid item in JSON array: ${JSON.stringify(item)}`);
                }
                if (alternatives.length >= 2) { break; } // Stop after two valid items
            }

        } catch (error) {
            this.outputChannel.appendLine(`Error parsing alternatives JSON: ${error}`);
            // Optionally log the problematic string:
            // this.outputChannel.appendLine(`--- Problematic JSON String ---\n${jsonString || responseText}\n------------------------------`);
            return []; // Return empty array on parsing error
        }

        this.outputChannel.appendLine(`Parsed ${alternatives.length} alternatives from JSON.`);
        this.outputChannel.appendLine(`\n--- Parsed Alternatives (${alternatives.length}) ---\n${JSON.stringify(alternatives, null, 2)}\n----------------------------------\n`);
        return alternatives.slice(0, 2); // Ensure max 2
    }

    /**
     * Extracts function code from a chat prompt (revised approach).
     * Focuses on finding code blocks first, validation happens later.
     */
    private extractFunctionCodeFromPrompt(prompt: string): string | undefined {
        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] Received prompt (first 100 chars): ${prompt.substring(0, 100)}`);
        const cleanPrompt = prompt.replace(/^@perfcopilot\s*/i, '').trim();
        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] Cleaned prompt (first 100 chars): ${cleanPrompt.substring(0, 100)}`);

        // Regex to find all code blocks (captures language tag and content)
        const codeBlockRegex = /```(?:(javascript|js|typescript|ts)\s*)?([\s\S]*?)```/g;
        let match;
        const jsTsBlocks: string[] = [];
        const genericBlocks: string[] = [];

        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] Searching for code blocks...`);
        while ((match = codeBlockRegex.exec(cleanPrompt)) !== null) {
            const language = match[1];
            const code = match[2]?.trim();
            if (!code) {continue;}

            if (language) {
                jsTsBlocks.push(code);
            } else {
                genericBlocks.push(code);
            }
        }

        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] Found ${jsTsBlocks.length} JS/TS blocks and ${genericBlocks.length} generic blocks.`);

        // 1. Return the *first* JS/TS block found (no validation here)
        if (jsTsBlocks.length > 0) {
            this.outputChannel.appendLine('[extractFunctionCodeFromPrompt] Path 1: Returning first JS/TS code block.');
            return jsTsBlocks[0];
        }

        // 2. Return the *first* generic block if no JS/TS block found (no validation here)
        if (genericBlocks.length > 0) {
            this.outputChannel.appendLine('[extractFunctionCodeFromPrompt] Path 2: Returning first generic code block.');
            return genericBlocks[0];
        }

        // 3. If no code blocks, check if the *entire* prompt is a valid function
        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] Path 3: No code blocks found. Checking if entire clean prompt is valid.`);
        const isEntirePromptValid = isValidJavaScriptFunction(cleanPrompt);
        this.outputChannel.appendLine(`[extractFunctionCodeFromPrompt] isValidJavaScriptFunction(cleanPrompt) returned: ${isEntirePromptValid}`);
        if (isValidJavaScriptFunction(cleanPrompt)) {
            this.outputChannel.appendLine('[extractFunctionCodeFromPrompt] Path 3a: Entire prompt is valid. Returning clean prompt.');
            return cleanPrompt;
        }

        // 4. Otherwise, no function found
        this.outputChannel.appendLine('[extractFunctionCodeFromPrompt] Path 4: No function found in blocks or raw prompt. Returning undefined.');
        return undefined;
    }

    /**
     * Creates a prompt to ask the LLM to generate test inputs for a function.
     */
    private createInputGenerationPrompt(functionCode: string): string {
        return `
You are a test data generation assistant.
Analyze the following JavaScript/TypeScript function:

\`\`\`javascript
${functionCode}
\`\`\`

**Your Task:**

Generate a small JSON array containing 3-5 diverse test inputs suitable for calling this function. Consider:
- Typical valid inputs.
- Edge cases (e.g., empty arrays/strings, zero, null, undefined if applicable).
- Different data types if the function seems flexible.

**Output Format:**
Provide your response *strictly* as a JSON array. Each element in the array represents the arguments for one function call. 
- If the function takes one argument, each element is the argument value (e.g., \`[1, [], \"test\"]\`).
- If the function takes multiple arguments, each element should be an array containing those arguments in the correct order (e.g., \`[[1, 2], [null, \"a\"], [10, undefined]]\`).
- If the function takes no arguments, return an empty array \`[]\`
- **Ensure all object keys within the generated data are enclosed in double quotes (e.g., \`\"key\": value\`) as required by strict JSON format.**

**Example (Single Argument Function like sum(arr)):**
\`\`\`json
[
  [1, 2, 3, 4, 5],
  [],
  [-1, 0, 1],
  [1000000, 2000000]
]
\`\`\`

**Example (Multi-Argument Function like add(a, b)):**
\`\`\`json
[
  [1, 2],
  [0, 0],
  [-5, 5],
  [10, null]
]
\`\`\`

**IMPORTANT:** Output *only* the JSON array within a single \`\`\`json code block. Do not include any introductory text or explanations outside the JSON structure.
Generate the JSON array of test inputs now.
`;
    }
}
