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

                if (token.isCancellationRequested) {return {};}

                response.progress('Extracting function...');
                const functionCode = this.extractFunctionCodeFromPrompt(request.prompt);
                if (!functionCode) {
                    response.markdown(`🔴 **Error:** No valid JavaScript/TypeScript function found in your request. 
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
                    return { metadata: { error: 'No valid function code found in prompt.' } };
                }

                if (!isValidJavaScriptFunction(functionCode)) {
                     response.markdown(`🔴 **Error:** The provided code does not appear to be a valid JavaScript/TypeScript function. 
Please ensure it has a correct structure (e.g., \`function name(...){...}\` or \`const name = (...) => {...}\`).`);
                    return { metadata: { error: 'Invalid function code provided.' } };
                }

                 const functionName = extractFunctionName(functionCode) || 'anonymous function';
                 const originalFunction: FunctionImplementation = { name: 'Original', code: functionCode, description: 'Original implementation' };
                 response.markdown(`✅ Function \`${functionName}\` identified. Analyzing...`);

                if (token.isCancellationRequested) {return {};}

                response.progress('Generating alternative implementations...');
                const alternativesPrompt = this.createAlternativesPrompt(functionCode);
                this.outputChannel.appendLine(`\n--- Alternatives Prompt ---\n${alternativesPrompt}\n--------------------------\n`);
                const alternativesMessages = [vscode.LanguageModelChatMessage.User(alternativesPrompt)];
                let alternativesResponseText = '';
                try {
                    const alternativesRequest = await languageModel.sendRequest(alternativesMessages, {}, token);
                    for await (const chunk of alternativesRequest.text) {
                        if (token.isCancellationRequested) {break;}
                        alternativesResponseText += chunk;
                    }
                    if (token.isCancellationRequested) {return {};}
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

                 if (token.isCancellationRequested) {return {};}

                response.progress('Generating benchmark code via AI...');
                let benchmarkCode: string | undefined;
                try {
                    const benchmarkPrompt = this.createBenchmarkPrompt(originalFunction, alternatives);
                    const benchmarkMessages = [vscode.LanguageModelChatMessage.User(benchmarkPrompt)];
                    let benchmarkResponseText = '';
                    const benchmarkRequest = await languageModel.sendRequest(benchmarkMessages, {}, token);

                    for await (const chunk of benchmarkRequest.text) {
                        if (token.isCancellationRequested) { break; }
                        benchmarkResponseText += chunk;
                    }
                    if (token.isCancellationRequested) { return {}; }

                    // Extract the benchmark code from the response
                    const codeBlockRegex = /```(?:javascript|js)?\s*([\s\S]*?)```/s;
                    const match = codeBlockRegex.exec(benchmarkResponseText);
                    if (match && match[1]) {
                        benchmarkCode = match[1].trim();
                        this.outputChannel.appendLine(`Extracted benchmark code length: ${benchmarkCode.length}`);
                        response.markdown(`✅ AI generated benchmark code.`);
                    } else {
                        this.outputChannel.appendLine(`Could not extract benchmark code from LLM response: ${benchmarkResponseText}`);
                        throw new Error('Failed to extract benchmark code from AI response.');
                    }

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

                if (token.isCancellationRequested) {return {};}

                response.progress('Analyzing benchmark results with AI...');
                const explanationPrompt = this.createExplanationPrompt(originalFunction, alternatives, benchmarkResults);
                const explanationMessages = [vscode.LanguageModelChatMessage.User(explanationPrompt)];
                
                try {
                    const explanationRequest = await languageModel.sendRequest(explanationMessages, {}, token);
                    for await (const chunk of explanationRequest.text) {
                         if (token.isCancellationRequested) {break;}
                         response.markdown(chunk);
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

**Function Implementations:**
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
    *   A detailed **Explanation** section covering point #2 above.
    *   Optionally, include the full code of the **Fastest Implementation** in a code block at the end.

Provide *only* the markdown analysis. Do not include introductory or concluding remarks outside the markdown structure.
`;
    }

    private createBenchmarkPrompt(
        originalFunction: FunctionImplementation,
        alternatives: FunctionImplementation[]
    ): string {
        const allImplementations = [originalFunction, ...alternatives];

        const functionDefinitions = allImplementations.map((impl, index) => {
            // Attempt to make function names unique for the benchmark script if needed
            // Note: Benny adds use the 'name' property, the actual function name in the script needs care.
            // Simple renaming convention: original -> originalFn, Alternative 1 -> alternative1Fn, etc.
            let scriptFunctionName = impl.name.toLowerCase().replace(/\s+/g, '');
            // Ensure it's a valid JS identifier
             if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(scriptFunctionName)) {
                 scriptFunctionName = `func${index}`;
             } else {
                 scriptFunctionName += 'Fn';
             }


            // Modify the function code slightly to use the new name
            let functionCode = impl.code;
             const originalNameMatch = impl.code.match(/(?:function|const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
             if (originalNameMatch && originalNameMatch[1]) {
                 // Basic replacement, might not cover all function declaration styles perfectly
                 functionCode = impl.code.replace(originalNameMatch[1], scriptFunctionName);
             } else if (impl.code.match(/^\s*async\s*function/)) {
                 // Handle async function case if needed
             } else if (impl.code.match(/^\s*\(.*\)\s*=>/) || impl.code.match(/^\s*async\s*\(.*\)\s*=>/)) {
                 // Handle arrow function assigned to variable
                 functionCode = `const ${scriptFunctionName} = ${impl.code};`;
             } else {
                 // Fallback if name extraction is tricky, wrap it?
                 functionCode = `const ${scriptFunctionName} = ${impl.code};`;
             }

            return `// Implementation for: ${impl.name}\n${functionCode}\n`;
        }).join('\n');

        const benchmarkAdds = allImplementations.map((impl, index) => {
            let scriptFunctionName = impl.name.toLowerCase().replace(/\s+/g, '');
             if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(scriptFunctionName)) {
                 scriptFunctionName = `func${index}`;
             } else {
                 scriptFunctionName += 'Fn';
             }
            // Assume functions take simple comparable arguments like numbers or strings for basic benchmarking
            // More complex input data generation might be needed for real-world cases
            return `    .add('${impl.name}', () => { ${scriptFunctionName}(testData); }) // Using placeholder testData`;
        }).join('\n');

        return `
You are a benchmark code generation assistant.
Your task is to create a complete Node.js script using the 'benny' library to benchmark the following JavaScript/TypeScript functions.

**Function Implementations:**

\`\`\`javascript
${functionDefinitions}
\`\`\`

**Requirements:**

1.  **Include Benny:** Start the script with \`const benny = require('benny');\`.
2.  **Define Test Data:** Create simple, representative test data suitable for the functions provided. Assign it to a variable named \`testData\`. For example, if the functions seem to operate on arrays, create a sample array. If they take numbers, use sample numbers. *Crucially, ensure this \`testData\` is defined BEFORE the \`benny.suite\` call.*
3.  **Create Suite:** Use \`benny.suite('Function Performance Benchmark', ...)\` to define the benchmark suite.
4.  **Add Cases:** For each function implementation provided above, add a benchmark case using \`benny.add()\`.
    *   The first argument to \`benny.add\` should be the implementation's name (e.g., 'Original', 'Alternative 1').
    *   The second argument should be an arrow function that calls the corresponding function implementation with the \`testData\`. Make sure to call the correctly named function (e.g., \`originalFn\`, \`alternative1Fn\`).
    *   Chain the \`.add\` calls.
5.  **Add Cycle and Complete:** Include \`benny.cycle()\` and \`benny.complete((summary) => { ... })\`.
6.  **Output JSON:** Inside the \`benny.complete\` callback, format the results minimally: Extract only the 'name' and 'ops' (operations per second) for each result. Construct a JSON object containing a \`results\` array with these objects \`{ name: string, ops: number }\` and a \`fastest\` property containing the name of the fastest suite. Log this JSON object to the console *exactly* as follows: \`console.log('RESULTS_JSON: ' + JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));\`. **Do not log anything else.** This specific format is crucial for parsing.
7.  **Provide Only Code:** Output *only* the complete Node.js script within a single \`\`\`javascript code block. Do not include any explanations or introductory text outside the code block.

**Example \`benny.add\` calls structure:**

\`\`\`javascript
benny.suite(
    'Function Performance Benchmark',
    // Make sure testData is defined here or above
    // const testData = ...;

${benchmarkAdds}
    , // Ensure comma separation for chained calls
    benny.cycle(),
    benny.complete((summary) => {
        const formattedResults = summary.results.map(res => ({ name: res.name, ops: res.ops }));
        const fastestSuiteName = summary.results.find(res => res.rank === 1)?.name || 'Unknown'; // Find fastest based on rank
        console.log('RESULTS_JSON: ' + JSON.stringify({ results: formattedResults, fastest: fastestSuiteName }));
    })
)
\`\`\`

Generate the complete benchmark script now based on the provided functions.
`;
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
     * Extracts function code from a chat prompt (improved).
     */
    private extractFunctionCodeFromPrompt(prompt: string): string | undefined {
        const cleanPrompt = prompt.replace(/^@perfcopilot\s*/i, '').trim();

        const codeBlockRegex = /```(?:javascript|js|typescript|ts)\s*([\s\S]*?)```/g;
        let match = codeBlockRegex.exec(cleanPrompt);
        if (match && match[1] && isValidJavaScriptFunction(match[1].trim())) {
            this.outputChannel.appendLine('Extracted function from explicit JS/TS code block.');
            return match[1].trim();
        }
        codeBlockRegex.lastIndex = 0;

         const genericCodeBlockRegex = /```\s*([\s\S]*?)```/g;
         match = genericCodeBlockRegex.exec(cleanPrompt);
         if (match && match[1] && isValidJavaScriptFunction(match[1].trim())) {
             this.outputChannel.appendLine('Extracted function from generic code block.');
             return match[1].trim();
         }
         genericCodeBlockRegex.lastIndex = 0;

        if (isValidJavaScriptFunction(cleanPrompt)) {
            this.outputChannel.appendLine('Using the entire prompt as function code.');
            return cleanPrompt;
        }

        this.outputChannel.appendLine('Could not extract a valid function from the prompt.');
        return undefined;
    }
} 