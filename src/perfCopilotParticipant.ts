/**
 * PerfCopilot Chat Participant
 * 
 * This file implements a VS Code Chat participant that handles performance optimization requests
 * for JavaScript/TypeScript functions via the chat interface.
 */

import * as vscode from 'vscode';
import { BenchmarkService } from './services/benchmarkService';
import { FunctionImplementation, BenchmarkComparison } from './models/types';
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
     * Creates a request handler function using vscode.lm for LLM interaction.
     */
    private createRequestHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            response: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            // Add one top-level try-catch for the entire handler body
            try {
                this.outputChannel.appendLine('DEBUG: Request Handler Entered.');
                
                let languageModel: vscode.LanguageModelChat | undefined;
                try {
                    this.outputChannel.appendLine('DEBUG: Attempting to select language model...');
                    const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
                    languageModel = models[0];
                    this.outputChannel.appendLine(`DEBUG: Language model selected: ${languageModel ? 'OK' : 'NOT FOUND'}`);
                    
                    if (!languageModel) {
                        this.outputChannel.appendLine('DEBUG: Language model not found, returning error.');
                        response.markdown('🔴 **Error:** Could not access a suitable language model (Copilot GPT-4). Please ensure the GitHub Copilot Chat extension is enabled and logged in.');
                        return { metadata: { error: 'Language model not found.' } };
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`DEBUG: Error during language model selection: ${error}`);
                    this.outputChannel.appendLine(`Error selecting language model: ${error}`);
                    response.markdown(`🔴 **Error:** Failed to select language model. \n\`\`\`\n${error}\n\`\`\``);
                    return { metadata: { error: `Language model selection error: ${error}` } };
                }

                this.outputChannel.appendLine('DEBUG: Proceeding to extract function...');
                response.progress('Extracting function...');

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
                    const alternativesRequest = await languageModel.sendRequest(alternativesMessages, {}, token);
                    for await (const chunk of alternativesRequest.text) {
                        if (token.isCancellationRequested) {
                            response.markdown("Operation cancelled by user.");
                            break;
                        }
                        alternativesResponseText += chunk;
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

                response.progress('Generating benchmark code via AI...');
                let benchmarkCode: string | undefined;
                let benchmarkResults: BenchmarkComparison | undefined;

                this.outputChannel.appendLine('DEBUG: Entering main benchmark generation/processing try block...');
                try {
                    // Use only verified alternatives for benchmarking
                    const benchmarkPrompt = this.createBenchmarkPrompt(originalFunction, alternatives);
                    const benchmarkMessages = [vscode.LanguageModelChatMessage.User(benchmarkPrompt)];
                    let benchmarkResponseText = '';
                    const benchmarkRequest = await languageModel.sendRequest(benchmarkMessages, {}, token);

                    for await (const chunk of benchmarkRequest.text) {
                        if (token.isCancellationRequested) {
                            response.markdown("Operation cancelled by user.");
                            break;
                        }
                        benchmarkResponseText += chunk;
                    }
                    if (token.isCancellationRequested) { return {}; }

                    // Parse the JSON response containing entry point, test data, and implementations
                    let benchmarkConfig: { entryPointName: string; testData: any; implementations: Record<string, string> };
                    const jsonBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/s; // Match JSON object
                    
                    // ---> Log the raw response text before parsing
                    this.outputChannel.appendLine(`DEBUG: Raw benchmark config response text:\n${benchmarkResponseText}`);
                    
                    const match = jsonBlockRegex.exec(benchmarkResponseText);
                    if (match && match[1]) {
                        const jsonString = match[1].trim();
                        // ---> Log the extracted JSON string
                        this.outputChannel.appendLine(`DEBUG: Extracted JSON string for benchmark config:\n${jsonString}`);
                        try {
                            benchmarkConfig = JSON.parse(jsonString);
                            // ---> Log the parsed object
                            this.outputChannel.appendLine(`DEBUG: Parsed benchmark config object: ${JSON.stringify(benchmarkConfig)}`);
                            
                            // Basic validation
                            if (!benchmarkConfig.entryPointName || typeof benchmarkConfig.entryPointName !== 'string' ||
                                !benchmarkConfig.implementations || typeof benchmarkConfig.implementations !== 'object' ||
                                benchmarkConfig.testData === undefined) { // Allow null for testData
                                // ---> Log validation failure
                                this.outputChannel.appendLine(`DEBUG: Benchmark config JSON validation failed.`);
                                throw new Error('Invalid JSON structure received for benchmark config.');
                            }
                            this.outputChannel.appendLine(`Parsed benchmark config JSON. Entry Point: ${benchmarkConfig.entryPointName}`);
                            
                            // ---> Log before AI ID message
                            this.outputChannel.appendLine(`DEBUG: About to send 'AI identified' markdown...`);
                            response.markdown(`✅ AI identified entry point and generated test data.`);
                            // ---> Log after AI ID message
                            this.outputChannel.appendLine(`DEBUG: Finished sending 'AI identified' markdown.`);

                            // --- Correctness Check (Moved HERE) ---
                            // ---> Log before Correctness Progress message
                            this.outputChannel.appendLine(`DEBUG: About to send 'Verifying correctness' progress...`);
                            response.progress('Verifying functional correctness...');
                            // ---> Log after Correctness Progress message
                            this.outputChannel.appendLine(`DEBUG: Finished sending 'Verifying correctness' progress.`);
                            try {
                                // ---> Check context and config before calling verifier
                                this.outputChannel.appendLine(`DEBUG: Before verify call - this.outputChannel defined? ${!!this.outputChannel}`);
                                this.outputChannel.appendLine(`DEBUG: Before verify call - benchmarkConfig defined? ${!!benchmarkConfig}`);
                                this.outputChannel.appendLine(`DEBUG: Before verify call - entryPointName: ${benchmarkConfig?.entryPointName}`);
                                
                                this.outputChannel.appendLine(`DEBUG: Calling verifyFunctionalEquivalence with entry point: ${benchmarkConfig.entryPointName}`);
                                const checkResults = await verifyFunctionalEquivalence(
                                    originalFunction,
                                    alternatives, // Use original alternatives list for the check
                                    languageModel,
                                    this.createInputGenerationPrompt.bind(this),
                                    this.outputChannel,
                                    token,
                                    benchmarkConfig.entryPointName // Now in scope
                                );
                                this.outputChannel.appendLine(`DEBUG: verifyFunctionalEquivalence returned ${checkResults?.length ?? 'undefined'} results.`);
                                verifiedAlternatives = checkResults; // Update verifiedAlternatives with results

                                if (token.isCancellationRequested) { 
                                    this.outputChannel.appendLine('DEBUG: Cancellation requested during correctness check.');
                                    throw new Error('Operation cancelled'); 
                                }
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
                                this.outputChannel.appendLine(`DEBUG: Error during functional verification: ${error.message}`);
                                this.outputChannel.appendLine(`DEBUG: Stack: ${error.stack}`);
                                response.markdown(`⚠️ **Warning:** Could not verify functional correctness due to an error: ${error.message}. Proceeding with all originally generated alternatives.`);
                                // verifiedAlternatives still holds the original list as fallback
                            }
                            this.outputChannel.appendLine(`DEBUG: Proceeding after correctness check with ${verifiedAlternatives?.length ?? 'undefined'} alternatives.`);
                            // --- End Correctness Check ---

                        } catch (parseError) {
                             // ---> Log parsing error
                             this.outputChannel.appendLine(`DEBUG: JSON parsing error for benchmark config: ${parseError}`);
                             this.outputChannel.appendLine(`Failed to parse benchmark config JSON: ${parseError}\nRaw JSON string: ${jsonString}`);
                             throw new Error('Failed to parse benchmark configuration from AI response.');
                        }
                    } else {
                        // ---> Log JSON block extraction failure
                        this.outputChannel.appendLine(`DEBUG: Could not extract JSON block from benchmark config response.`);
                        this.outputChannel.appendLine(`Could not extract benchmark config JSON from LLM response: ${benchmarkResponseText}`);
                        throw new Error('Failed to extract benchmark configuration JSON from AI response.');
                    }

                    // --- Process Implementations and Prepare Benchmark Code ---
                    this.outputChannel.appendLine('DEBUG: Starting implementation processing...'); 
                    let processedImplementations: Record<string, string> = {}; // Define here
                    
                    // ---> Log verifiedAlternatives state
                    this.outputChannel.appendLine(`DEBUG: verifiedAlternatives before loop: ${JSON.stringify(verifiedAlternatives)}`);

                    const implementationsToProcess = {
                        [originalFunction.name]: originalFunction.code,
                        ...Object.fromEntries(verifiedAlternatives.map(alt => [alt.name, alt.code]))
                    };
                    // ---> Log implementationsToProcess state
                    this.outputChannel.appendLine(`DEBUG: implementationsToProcess keys: ${Object.keys(implementationsToProcess).join(', ')}`);
                    
                    this.outputChannel.appendLine(`DEBUG: Processing ${Object.keys(implementationsToProcess).length} implementations...`);

                    this.outputChannel.appendLine('DEBUG: Entering implementation processing loop...');
                    for (const [rawKey, code] of Object.entries(implementationsToProcess)) {
                        this.outputChannel.appendLine(`DEBUG: Processing key: ${rawKey}`);
                        const sanitizedKey = rawKey.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                        this.outputChannel.appendLine(`DEBUG: Sanitized key: ${sanitizedKey}`);
                        
                        const processedCode = this.benchmarkService.replaceRecursiveCalls(
                            code,
                            benchmarkConfig.entryPointName, // Use entryPointName from benchmarkConfig
                            sanitizedKey
                        );
                        processedImplementations[sanitizedKey] = processedCode;
                        this.outputChannel.appendLine(`DEBUG: Processed code for ${sanitizedKey}. Length: ${processedCode?.length ?? 'undefined'}`);
                        if (!processedCode) {
                            throw new Error(`Failed to process code for implementation: ${rawKey}`);
                        }
                    }
                    this.outputChannel.appendLine('DEBUG: Finished processing implementations.');

                    // Construct the actual code module
                    this.outputChannel.appendLine('DEBUG: Constructing benchmark code module...');
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
                    this.outputChannel.appendLine('DEBUG: Benchmark code module constructed. Length: ' + benchmarkCode?.length);

                    this.outputChannel.appendLine(`DEBUG: Checking benchmarkCode before run... (Is undefined? ${benchmarkCode === undefined})`);
                    if (!benchmarkCode) {
                        throw new Error('Failed to construct benchmark code module.');
                    }

                    if (token.isCancellationRequested) { return {}; }

                    this.outputChannel.appendLine('DEBUG: Proceeding to call runBenchmark...');
                    this.outputChannel.appendLine(`DEBUG: benchmarkCode value before call:\n${benchmarkCode?.substring(0, 300) ?? 'undefined'}...`);
                    response.progress('Running benchmarks...');

                    // Run the benchmark (nested try-catch)
                    try { 
                        // ---> Log entry into the benchmark try block
                        this.outputChannel.appendLine('DEBUG: Entering runBenchmark try block...');
                        benchmarkResults = await this.benchmarkService.runBenchmark(benchmarkCode); 
                        this.outputChannel.appendLine('DEBUG: runBenchmark call completed.');
                        this.outputChannel.appendLine(`Benchmark results received. Fastest: ${benchmarkResults?.fastest}`);
                        if (!benchmarkResults || !benchmarkResults.results || benchmarkResults.results.length === 0) {
                            throw new Error('Benchmark process did not produce valid results.');
                        }
                        response.markdown(`✅ Benchmarks completed.`);
                    } catch (benchmarkError: any) {
                        this.outputChannel.appendLine(`🔴 Error running benchmark: ${benchmarkError?.message || benchmarkError}`);
                        response.markdown(`🔴 **Error:** Failed to run benchmarks. Please check the PerfCopilot logs for details.\\n\`\`\`\\n${benchmarkError?.message || benchmarkError}\\n\`\`\``);
                        return { metadata: { error: `Benchmark execution failed: ${benchmarkError?.message || benchmarkError}` } };
                    }

                    // --- Generate Explanation --- 
                    response.progress('Generating explanation...');
                    try {
                        const explanationPrompt = this.createExplanationPrompt(originalFunction, verifiedAlternatives, benchmarkResults!); 
                        const explanationMessages = [vscode.LanguageModelChatMessage.User(explanationPrompt)];
                        let explanationResponseText = '';
                        const explanationRequest = await languageModel.sendRequest(explanationMessages, {}, token);

                        for await (const chunk of explanationRequest.text) {
                            if (token.isCancellationRequested) {
                                response.markdown("Operation cancelled by user.");
                                break;
                            }
                            explanationResponseText += chunk;
                        }
                        if (token.isCancellationRequested) { return {}; } 

                        response.markdown(explanationResponseText);
                    } catch (explanationError: any) { 
                        this.outputChannel.appendLine(`🔴 Error generating explanation: ${explanationError?.message || explanationError}`);
                        response.markdown(`⚠️ **Warning:** Failed to generate explanation. \n\`\`\`\n${explanationError?.message || explanationError}\n\`\`\``);
                    }
                    // --- End Explanation Generation ---

                } catch (processingError: any) { 
                    this.outputChannel.appendLine(`🔴 DEBUG: Error during benchmark prep/run/explanation: ${processingError?.message || processingError}`);
                    this.outputChannel.appendLine(`🔴 DEBUG: Stack: ${processingError?.stack}`); 
                    response.markdown(`🔴 **Error:** An internal error occurred while preparing or running the benchmarks. Please check the PerfCopilot logs.\\n\`\`\`\\n${processingError?.message || processingError}\\n\`\`\``);
                    return { metadata: { error: `Benchmark processing/setup/explanation failed: ${processingError?.message || processingError}` } };
                }

                this.outputChannel.appendLine('Request processed successfully.');
                 // Use existing functionName variable declared earlier
                return { 
                    metadata: { 
                        functionName, // Use existing variable
                        benchmarkResults: { 
                             fastest: benchmarkResults?.fastest ?? 'N/A', 
                             resultCount: benchmarkResults?.results?.length ?? 0 
                        }
                     } 
                };

            } catch (topLevelError: any) {
                 // Catch ANY error that occurred anywhere in the handler
                 this.outputChannel.appendLine(`🔴 DEBUG: TOP LEVEL HANDLER ERROR CAUGHT: ${topLevelError?.message || topLevelError}`);
                 this.outputChannel.appendLine(`🔴 DEBUG: Stack: ${topLevelError?.stack}`);
                 // Try to send an error message if possible
                 try {
                     response.markdown(`🔴 **Internal Error:** An unexpected error occurred while processing your request. Please check PerfCopilot logs.`);
                 } catch (responseError) {
                     this.outputChannel.appendLine(`🔴 Error sending error message to response stream: ${responseError}`);
                 }
                 // Return an error metadata object
                 return { metadata: { error: `Top level handler error: ${topLevelError?.message || topLevelError}` } };
            }
        };
    }
    
    private createAlternativesPrompt(functionCode: string): string {
         return `
Analyze the following JavaScript/TypeScript function for performance optimization opportunities:

\`\`\`javascript
${functionCode}
\`\`\`

Generate exactly two distinct alternative implementations aiming for improved performance. Maintain the original function's signature and core functionality.

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
        this.outputChannel.appendLine(`DEBUG: Entering parseAlternativeImplementations.`);
        this.outputChannel.appendLine(`DEBUG: responseText (first 500 chars):\n${responseText.substring(0, 500)}...`);

        let alternatives: FunctionImplementation[] = [];
        let jsonString: string | undefined;

        try {
            const jsonBlockRegex = /```(?:json)?\s*([\[][\s\S]*[\]])\s*```/;
            const match = responseText.match(jsonBlockRegex);

            if (match && match[1]) {
                jsonString = match[1].trim();
                this.outputChannel.appendLine(`DEBUG: Found JSON block.`);
            } else {
                this.outputChannel.appendLine(`DEBUG: No JSON block found, checking if entire response is JSON array.`);
                const trimmedResponse = responseText.trim();
                if (trimmedResponse.startsWith('[') && trimmedResponse.endsWith(']')) {
                    jsonString = trimmedResponse;
                    this.outputChannel.appendLine(`DEBUG: Using entire response as JSON string.`);
                }
            }

            if (!jsonString) {
                this.outputChannel.appendLine(`DEBUG: Could not extract a JSON array string. Returning empty.`);
                return [];
            }
            this.outputChannel.appendLine(`DEBUG: Attempting to parse JSON string: ${jsonString.substring(0, 200)}...`);
            const parsed = JSON.parse(jsonString);

            if (!Array.isArray(parsed)) {
                this.outputChannel.appendLine(`DEBUG: Parsed JSON is not an array. Returning empty.`);
                return [];
            }
            this.outputChannel.appendLine(`DEBUG: Parsed JSON array with ${parsed.length} items.`);

            for (const item of parsed) {
                if (item && typeof item.name === 'string' && typeof item.code === 'string' && typeof item.explanation === 'string') {
                    this.outputChannel.appendLine(`DEBUG: Processing valid item: ${item.name}`);
                    alternatives.push({
                        name: item.name,
                        code: item.code,
                        description: item.explanation
                    });
                } else {
                    this.outputChannel.appendLine(`DEBUG: Skipping invalid item in JSON array: ${JSON.stringify(item)}`);
                }
                // Limit parsing? Original code had a limit, let's keep it for now.
                 if (alternatives.length >= 2) { 
                     this.outputChannel.appendLine(`DEBUG: Reached limit of 2 alternatives.`);
                     break; 
                 }
            }

        } catch (error) {
            this.outputChannel.appendLine(`DEBUG: Error parsing alternatives JSON: ${error}`);
            this.outputChannel.appendLine(`DEBUG: Problematic JSON string: ${jsonString || '(jsonString not extracted)'}`);
            return []; 
        }
        this.outputChannel.appendLine(`DEBUG: Exiting parseAlternativeImplementations. Found ${alternatives.length} valid alternatives.`);
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
        if (isEntirePromptValid) {
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
        // ***** Restore original prompt string *****
        return `\nYou are a test data generation assistant.\nAnalyze the following JavaScript/TypeScript function:\n\n\`\`\`javascript\n${functionCode}\n\`\`\`\n\n**Your Task:**\n\nGenerate a small JSON array containing 3-5 diverse test inputs suitable for calling this function. Consider:\n- Typical valid inputs.\n- Edge cases (e.g., empty arrays/strings, zero, null, undefined if applicable).\n- Different data types if the function seems flexible.\n\n**Output Format:**\nProvide your response *strictly* as a JSON array. Each element in the array represents the arguments for one function call. \n- If the function takes one argument, each element is the argument value (e.g., \`[1, [], \"test\"]\`).\n- If the function takes multiple arguments, each element should be an array containing those arguments in the correct order (e.g., \`[[1, 2], [null, \"a\"], [10, undefined]]\`).\n- If the function takes no arguments, return an empty array \`[]\`\n\n**Example (Single Argument Function like sum(arr)):**\n\`\`\`json\n[\n  [1, 2, 3, 4, 5],\n  [],\n  [-1, 0, 1],\n  [1000000, 2000000]\n]\n\`\`\`\n\n**Example (Multi-Argument Function like add(a, b)):**\n\`\`\`json\n[\n  [1, 2],\n  [0, 0],\n  [-5, 5],\n  [10, null]\n]\n\`\`\`\n\n**IMPORTANT:** Output *only* the JSON array within a single \`\`\`json code block. Do not include any introductory text or explanations outside the JSON structure.\nGenerate the JSON array of test inputs now.\n`;
        // ***** End Restore *****
    }
}