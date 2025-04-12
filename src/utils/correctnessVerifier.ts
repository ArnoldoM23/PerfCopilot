import * as vscode from 'vscode';
import * as vm from 'vm';
import * as util from 'util';
import { FunctionImplementation } from '../models/types';
import { extractFunctionName } from './functions';

/**
 * Verifies the functional equivalence of alternative function implementations 
 * against the original function using LLM-generated test cases.
 * 
 * @param originalFunction - The original function implementation.
 * @param alternatives - An array of alternative implementations to verify.
 * @param languageModel - The VS Code Language Model chat instance.
 * @param createInputGenerationPrompt - Function to generate the LLM prompt for inputs.
 * @param outputChannel - The output channel for logging.
 * @param token - Cancellation token.
 * @param originalFunctionName - The name of the original function.
 * @returns A promise that resolves to an array of functionally equivalent alternatives.
 * @throws If verification cannot be completed due to errors.
 */
export async function verifyFunctionalEquivalence(
    originalFunction: FunctionImplementation,
    alternatives: FunctionImplementation[],
    languageModel: vscode.LanguageModelChat,
    createInputGenerationPrompt: (code: string) => string,
    outputChannel: vscode.OutputChannel,
    token: vscode.CancellationToken,
    originalFunctionName: string
): Promise<FunctionImplementation[]> {

    outputChannel.appendLine('[CorrectnessVerifier] Starting functional equivalence check...');

    // Add initial cancellation check
    if (token.isCancellationRequested) {
        outputChannel.appendLine("[CorrectnessVerifier] Cancellation requested before verification could start.");
        return [];
    }

    let testInputs: any[] = [];

    // 1. Generate Test Inputs using LLM
    try {
        outputChannel.appendLine('[CorrectnessVerifier] Generating test inputs via LLM...');
        const prompt = createInputGenerationPrompt(originalFunction.code);
        const messages = [vscode.LanguageModelChatMessage.User(prompt)];
        let responseText = '';
        const request = await languageModel.sendRequest(messages, {}, token);

        for await (const chunk of request.text) {
            if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
            responseText += chunk;
        }

        // --- Debugging Log ---
        console.log('[DEBUG] Raw responseText before regex:', JSON.stringify(responseText)); 
        // --- End Debugging Log ---

        // Use a regex that matches a JSON array block potentially containing data
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        const match = responseText.match(jsonBlockRegex);
        if (match && match[1]) {
            const potentialJson = match[1].trim();
            // Further validation: ensure it looks like an array
            if (potentialJson.startsWith('[') && potentialJson.endsWith(']')) {
                try {
                    // Sanitize: Replace standalone 'undefined' with 'null' as undefined is not valid JSON
                    const sanitizedJson = potentialJson.replace(/\bundefined\b/g, 'null');
                    testInputs = JSON.parse(sanitizedJson);
                    outputChannel.appendLine(`[CorrectnessVerifier] Successfully parsed ${testInputs.length} test inputs.`);
                } catch (parseError: any) {
                    outputChannel.appendLine(`[CorrectnessVerifier] Error parsing extracted JSON: ${parseError.message}. Content: ${potentialJson}`);
                    return []; // Skip verification on parse error
                }
            } else {
                outputChannel.appendLine(`[CorrectnessVerifier] Extracted block doesn\'t look like a JSON array. Content: ${potentialJson}`);
                return []; // Skip verification if content isn\'t an array
            }
        } else {
            outputChannel.appendLine('[CorrectnessVerifier] Could not extract JSON test inputs from LLM response. Skipping correctness check.');
            return []; // Skip verification if inputs aren't generated
        }
    } catch (error: any) {
        outputChannel.appendLine(`[CorrectnessVerifier] Error generating/parsing test inputs: ${error.message}. Skipping correctness check.`);
        return []; // Skip verification on error
    }

    if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }

    if (testInputs.length === 0) {
        outputChannel.appendLine('[CorrectnessVerifier] No test inputs generated. Skipping correctness check.');
        return [];
    }

    // 2. Execute Original Function to get Expected Outputs
    const expectedOutputs: { input: any; output?: any; error?: string }[] = [];
    outputChannel.appendLine('[CorrectnessVerifier] Executing original function...');
    for (const input of testInputs) {
        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
        const args = Array.isArray(input) ? input : [input]; // Ensure args are always in an array
        try {
            const output = await executeFunctionSafely(originalFunction.code, originalFunctionName, args, outputChannel);
            expectedOutputs.push({ input, output });
        } catch (error: any) {
            outputChannel.appendLine(`[CorrectnessVerifier] Original function ('${originalFunctionName}') failed for input ${JSON.stringify(input)}: ${error.message}`);
            expectedOutputs.push({ input, error: error.message });
            // If the original fails, we can't verify alternatives against it for this input
        }
    }

    // 3. Execute Alternatives and Compare Outputs
    const verifiedAlternatives: FunctionImplementation[] = [];
    outputChannel.appendLine('[CorrectnessVerifier] Verifying alternatives...');

    for (const alt of alternatives) {
        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
        let isEquivalent = true;
        let comparisonPerformed = false; // --- ADDED: Track if any valid comparison happened ---
        outputChannel.appendLine(`--- Verifying ${alt.name} ---`);

        // --- FIX: Extract the actual function name from the alternative code --- 
        const altFunctionName = extractFunctionName(alt.code);
        if (!altFunctionName) {
            outputChannel.appendLine(` - Could not extract function name from ${alt.name}. Skipping verification for this alternative.`);
            continue; // Skip if we can't find the function name in the alternative code
        }
        outputChannel.appendLine(` - Identified function name in ${alt.name} as: ${altFunctionName}`);
        // --- End Fix ---

        for (let i = 0; i < testInputs.length; i++) {
            if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
            const input = testInputs[i];
            const expected = expectedOutputs[i];
            const args = Array.isArray(input) ? input : [input];

            if (expected.error) {
                outputChannel.appendLine(` - Input ${i + 1}: SKIPPED (original function failed)`);
                continue; // Cannot compare if original failed
            }

            // --- If we reach here, a comparison is possible ---
            comparisonPerformed = true; 

            try {
                // --- FIX: Use the extracted altFunctionName --- 
                const altOutput = await executeFunctionSafely(alt.code, altFunctionName, args, outputChannel);
                // --- End Fix ---
                
                // Compare using JSON stringification for robustness
                const expectedJson = JSON.stringify(expected.output?.result);
                const altJson = JSON.stringify(altOutput.result);

                if (altJson !== expectedJson) {
                    outputChannel.appendLine(` - Input ${i + 1}: FAILED. Expected JSON: ${expectedJson}, Got JSON: ${altJson}`);
                    // Optional: Log full objects if helpful for debugging complex cases
                    // outputChannel.appendLine(`   Expected Object: ${util.inspect(expected.output, { depth: null })}`);
                    // outputChannel.appendLine(`   Got Object: ${util.inspect(altOutput, { depth: null })}`);
                    isEquivalent = false;
                    break; // No need to check further inputs for this alternative
                } else {
                    outputChannel.appendLine(` - Input ${i + 1}: PASSED`);
                }
            } catch (error: any) {
                // Use altFunctionName in the error message
                outputChannel.appendLine(` - Input ${i + 1}: FAILED (Execution Error for ${altFunctionName}). Error: ${error.error}`);
                isEquivalent = false;
                break; // Alternative threw an error, not equivalent
            }
        }

        // --- MODIFIED Condition ---
        if (isEquivalent && comparisonPerformed) { 
            outputChannel.appendLine(` => ${alt.name}: VERIFIED`);
            verifiedAlternatives.push(alt);
        // --- ADDED Condition ---
        } else if (!comparisonPerformed) {
             outputChannel.appendLine(` => ${alt.name}: INDETERMINATE (Original function failed on all inputs)`);
        } else {
            outputChannel.appendLine(` => ${alt.name}: REJECTED (Not equivalent or execution error)`);
        }
    }

    outputChannel.appendLine(`[CorrectnessVerifier] Verification complete. ${verifiedAlternatives.length} of ${alternatives.length} alternatives passed.`);
    return verifiedAlternatives;
}

/**
 * Safely executes function code with given arguments in an isolated context.
 * 
 * @param functionCode - The string representation of the function.
 * @param functionName - The name of the function.
 * @param args - An array of arguments to pass to the function.
 * @param outputChannel - The output channel for logging.
 * @param timeoutMs - The timeout in milliseconds for the function execution.
 * @returns A promise that resolves to the result of the function execution.
 * @throws If the code cannot be compiled, execution fails, or times out.
 */
async function executeFunctionSafely(
    code: string, 
    entryPointName: string,
    args: any[], 
    outputChannel: vscode.OutputChannel,
    timeoutMs: number = 1000 // Default timeout
): Promise<{ result?: any; error?: string }> {
    const context = vm.createContext({
        console: { log: () => {}, error: (msg: any) => { throw new Error(msg); }, warn: () => {} }, // Throw on console.error
        module: { exports: {} }, // Basic module context
        require: require, // Allow require if absolutely necessary (use cautiously)
        // Pass arguments into the context if needed, but direct call is safer
        // __args: args 
    });

    try {
        // Step 1: Define the function
        vm.runInContext(code, context, { timeout: timeoutMs, displayErrors: true }); 

        // Step 2: Retrieve the defined function using the entry point name
        const funcToExecute = context[entryPointName];
        if (typeof funcToExecute !== 'function') {
            return { error: `Function '${entryPointName}' not defined in context after execution.` };
        }

        // Step 3: Execute the function with arguments
        // Use vm.runInContext again for the *call* to apply timeout
        // Note: This requires function and args to be accessible within the context
        context.__args = args; // Make args available in context
        const executionCode = `module.exports.result = ${entryPointName}(...__args);`;

        vm.runInContext(executionCode, context, { timeout: timeoutMs, displayErrors: true });
        
        // Retrieve result from context
        const result = (context.module as any).exports.result;
        return { result };

    } catch (e: any) {
        // Handle errors, including potential TimeoutError from vm
        const errorMessage = e instanceof Error ? e.message : String(e);
        // Check if it's a timeout error
        if (errorMessage.includes('timed out') || (e.code && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')) {
             return { error: `Execution timed out after ${timeoutMs}ms` };
        }
        return { error: errorMessage };
    }
} 
