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
            const output = await executeFunctionSafely(originalFunction.code, originalFunctionName, args);
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
                const altOutput = await executeFunctionSafely(alt.code, originalFunctionName, args);
                
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
    // Create a context for the VM script, passing arguments
    const context = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __args: args,
        console: {
            log: () => {}, // Suppress console.log within the function
            warn: () => {},
            error: () => {}
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Math: Math,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __result: undefined, // Variable to store the result
    };
    vm.createContext(context); // Contextify the object

    let isAsync = false;
    let functionRef: any; // Variable to hold the actual function reference

    try {
        // Simple check for 'async function functionName' or 'async (...) =>' assigned to functionName
        const asyncFuncRegex = new RegExp(`(?:async\s+function\s+${functionName}\b|\b${functionName}\s*=\s*async\b)`);
        isAsync = asyncFuncRegex.test(functionCode);

        // Step 1: Run the entire user code in the context to define functions
        // Use a timeout to prevent infinite loops in the user code itself during definition.
        vm.runInContext(functionCode, context, { timeout: 1000 }); 

        // Step 2: Get the function reference by evaluating its name in the context
        functionRef = vm.runInContext(functionName, context); 

        // Check if we got a function
        if (typeof functionRef !== 'function') {
            throw new Error(`Target function '${functionName}' was not defined or is not a function after evaluating the code.`);
        }

        // Step 3: Construct and run a script to CALL the target function
        // We call the reference directly now, no need for IIFE or checking context again
        if (isAsync) {
             context.__result = await functionRef(...context.__args);
        } else {
             context.__result = functionRef(...context.__args);
        }

        return context.__result; // Return the stored result

    } catch (error: any) {
        // Improve error reporting
        const errorMessage = `Execution failed: ${error.message} (targeting function: ${functionName})`;
        console.error(`[executeFunctionSafely] Error: ${errorMessage}`, error.stack); // Log stack trace too
        // Re-throw a new error with combined info, preserving original stack if possible
        const executionError = new Error(errorMessage);
        executionError.stack = error.stack || executionError.stack; // Preserve original stack if available
        throw executionError;
    }
} 