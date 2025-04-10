import * as vscode from 'vscode';
import * as vm from 'vm';
import * as util from 'util';
import { FunctionImplementation } from '../models/types';

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
            const output = await executeFunctionSafely(originalFunction.code, originalFunction.name, args);
            expectedOutputs.push({ input, output });
        } catch (error: any) {
            outputChannel.appendLine(`[CorrectnessVerifier] Original function ('${originalFunction.name}') failed for input ${JSON.stringify(input)}: ${error.message}`);
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
                const altOutput = await executeFunctionSafely(alt.code, alt.name, args);
                
                // Compare using JSON stringification for robustness
                const expectedJson = JSON.stringify(expected.output);
                const altJson = JSON.stringify(altOutput);

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
                outputChannel.appendLine(` - Input ${i + 1}: FAILED (Execution Error). Error: ${error.message}`);
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
            outputChannel.appendLine(` => ${alt.name}: REJECTED (Not equivalent)`);
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
 * @returns The result of the function execution.
 * @throws If the code cannot be compiled or execution fails.
 */
export async function executeFunctionSafely(functionCode: string, functionName: string, args: any[]): Promise<any> {
    const context = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __args: args,
        console: {
            log: () => {}, 
            warn: () => {},
            error: () => {}
        },
        // Pass common globals explicitly
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Math: Math,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        JSON: JSON, 
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Date: Date,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __theFunction: undefined, // To store the function reference
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __result: undefined, // To store the result
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __error: undefined   // To store potential async errors
    };
    vm.createContext(context); 

    try {
        // Step 1: Define the function within the context
        // Assign the evaluated function expression directly to context.__theFunction
        const defineScript = `__theFunction = (${functionCode});`;
        
        // Use a timeout during definition to catch potential infinite loops in the function code itself
        vm.runInContext(defineScript, context, { timeout: 1000 }); 

        // Step 2: Check if the function reference was successfully captured
        // (The name check inside defineScript is removed as we assign directly)
        if (typeof context.__theFunction !== 'function') {
            // This might happen if the provided code string doesn't evaluate to a function
            throw new Error(`Provided code does not evaluate to a function (targeting function: ${functionName}). Code: ${functionCode}`);
        }

        // Step 3: Call the captured function reference
        const functionRef: any = context.__theFunction; // Cast to any after capture
        
        // Add a type guard before accessing properties
        if (typeof functionRef !== 'function') {
            // This should technically be caught earlier, but provides robustness
            throw new Error(`Internal error: Captured function reference is not a function.`); 
        }
        const isAsync = functionRef.toString().startsWith('async'); // Safer check for async

        // Use a longer timeout for the actual execution
        const executionTimeout = 5000; 

        if (isAsync) {
             // Execute async function and capture result/error in context
            const callScript = `
                (async () => {
                    try {
                        __result = await __theFunction(...__args);
                    } catch (e) {
                        __error = e;
                    }
                })();
            `;
            await vm.runInContext(callScript, context, { timeout: executionTimeout });
             if (context.__error) {
                 throw context.__error; // Re-throw error caught inside async IIFE
             }
        } else {
            // Execute sync function directly
             const callScript = `__result = __theFunction(...__args);`;
             vm.runInContext(callScript, context, { timeout: executionTimeout });
        }

        return context.__result; // Return the stored result

    } catch (error: any) {
        // Improve error reporting
        let errorMessage = `Execution failed: ${error.message} (targeting function: ${functionName})`;
        if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
             errorMessage = `Execution timed out after ${error.timeout || 'N/A'}ms (targeting function: ${functionName})`;
        } else if (error instanceof Error) {
            // Use original error message if available
            errorMessage = `Execution failed: ${error.message} (targeting function: ${functionName})`;
        }

        console.error(`[executeFunctionSafely] Error: ${errorMessage}`, error.stack); 
        
        // Re-throw a new error with combined info
        const executionError = new Error(errorMessage);
        executionError.stack = error.stack || executionError.stack; 
        throw executionError;
    }
} 