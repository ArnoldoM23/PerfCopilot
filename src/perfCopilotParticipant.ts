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
import { generateBenchmarkCode } from './utils/benchmarkGenerator';

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

                } catch (error) {
                     this.outputChannel.appendLine(`Error getting alternatives: ${error}`);
                     response.markdown(`🔴 **Error:** Failed to generate alternative implementations. \n\`\`\`\n${error}\n\`\`\``);
                     return { metadata: { error: `LLM error getting alternatives: ${error}` } };
                }

                const alternatives = this.parseAlternativeImplementations(functionCode, alternativesResponseText);
                if (alternatives.length === 0) {
                    response.markdown(`ℹ️ No alternative implementations were generated by the AI. This might happen if the function is already simple or highly optimized.`);
                    return { metadata: { message: 'No alternatives generated.' } };
                }
                 response.markdown(`✅ Generated ${alternatives.length} alternative implementations.`);

                 if (token.isCancellationRequested) {return {};}

                response.progress('Generating benchmark code...');
                let benchmarkCode: string;
                try {
                     benchmarkCode = generateBenchmarkCode(originalFunction, alternatives);
                     this.outputChannel.appendLine(`Generated benchmark code length: ${benchmarkCode.length}`);
                     response.markdown(`✅ Generated benchmark code.`);
                } catch(error) {
                    this.outputChannel.appendLine(`Error generating benchmark code: ${error}`);
                    response.markdown(`🔴 **Error:** Failed to generate benchmark code. \n\`\`\`\n${error}\n\`\`\``);
                    return { metadata: { error: `Benchmark generation error: ${error}` } };
                }

                response.progress('Running benchmarks...');
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
Analyze this JavaScript/TypeScript function for performance optimization:

\`\`\`javascript
${functionCode}
\`\`\`

Please provide exactly 2 alternative implementations that aim for better performance while maintaining the same functionality and function signature. 

For each alternative:
1. Label it clearly (e.g., "### Alternative 1").
2. Provide the complete function code within a \`\`\`javascript code block.
3. Include a brief explanation (1-2 sentences) of the optimization strategy used.

Focus on common optimization techniques like improved algorithms, better data structures, loop unrolling, reducing redundant computations, or using more efficient built-in methods. Do not suggest changes that alter the core purpose or output of the function. Provide only the 2 alternatives as requested.
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

    private parseAlternativeImplementations(originalCode: string, response: string): FunctionImplementation[] {
        const alternatives: FunctionImplementation[] = [];
        const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/gs;
        const headerRegex = /###\s*(Alternative\s*\d+)/i;

        const sections = response.split(/###\s*(?:Alternative|Implementation)\s*\d+/i);

        let altIndex = 1;
        for (const section of sections) {
            if (!section.trim()) {continue;}

            const codeMatch = codeBlockRegex.exec(section);
            if (codeMatch && codeMatch[1]) {
                const code = codeMatch[1].trim();
                if (code.length > 10 && !originalCode.includes(code.substring(0, 20))) { 
                    const descriptionMatch = section.substring(0, codeMatch.index).trim();
                    const description = descriptionMatch.replace(/[*_`]/g, ''); 
                    
                    alternatives.push({
                        name: `Alternative ${altIndex++}`,
                        code: code,
                        description: description || "AI-generated alternative."
                    });
                }
            }
            codeBlockRegex.lastIndex = 0; 
        }

        this.outputChannel.appendLine(`Parsed ${alternatives.length} alternatives.`);
        return alternatives.slice(0, 2); 
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