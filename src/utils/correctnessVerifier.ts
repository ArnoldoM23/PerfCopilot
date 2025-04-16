/**
 * @fileoverview Correctness Verifier Utility
 * 
 * This utility is responsible for verifying the functional equivalence of alternative 
 * function implementations against an original implementation.
 * 
 * Core Logic:
 * 1.  Uses the Language Model (LLM) to generate a set of diverse test inputs based on the 
 *     original function's code.
 * 2.  Executes the *original* function safely within a `vm` sandbox for each generated input 
 *     to establish the expected outputs (or expected errors).
 * 3.  Executes each *alternative* function safely within a `vm` sandbox for each input where 
 *     the original function succeeded.
 * 4.  Compares the output of the alternative (JSON stringified) against the expected output.
 * 5.  Handles errors during execution (e.g., timeouts, exceptions) and marks the alternative 
 *     as non-equivalent if it fails where the original succeeded.
 * 6.  Returns an array containing only the alternatives that produced functionally equivalent 
 *     results across all applicable test inputs.
 * 
 * Safety Mechanisms:
 * - Uses Node.js `vm` module to run function code in an isolated context, preventing 
 *   interference with the main extension process.
 * - Implements timeouts (`vm.runInContext` options and potentially async waits) to prevent 
 *   runaway code execution (e.g., infinite loops) within the verified functions.
 * - Compares outputs using JSON stringification for robustness against subtle differences 
 *   (e.g., `undefined` vs. `null` in certain JS contexts, although `undefined` is sanitized 
 *   during input parsing).
 */

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
        // CRITICAL: Interaction with LLM to get diverse test inputs
        const request = await languageModel.sendRequest(messages, {}, token);

        // --- Fix 1: Correct Stream Handling for Input Generation ---
        try { // Add try block around stream processing
            outputChannel.appendLine('[CorrectnessVerifier DEBUG] Starting stream processing...');
            for await (const chunk of request.stream) { 
                if (token.isCancellationRequested) { 
                    outputChannel.appendLine('[CorrectnessVerifier:InputGen] Operation cancelled during stream.');
                    throw new Error('Operation cancelled'); 
                }
                // Add more robust check for expected chunk structure
                 if (typeof chunk === 'object' && chunk !== null && 'value' in chunk && typeof chunk.value === 'string') {
                     responseText += chunk.value;
                 } else {
                     outputChannel.appendLine(`[CorrectnessVerifier:InputGen] Received unexpected chunk structure: ${JSON.stringify(chunk)}`);
                     // Optionally throw an error if the structure is wrong
                     // throw new Error('Received unexpected chunk structure during stream processing.');
                 }
            }
            outputChannel.appendLine('[CorrectnessVerifier DEBUG] Finished stream processing.');
        } catch (streamError: any) {
             outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Error DURING stream processing: ${streamError.message}`);
             throw streamError; // Re-throw to be caught by the outer try/catch
        }
        // --- End Fix 1 ---

        // CRITICAL: Parses JSON test inputs from LLM response
        outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Attempting to parse JSON from responseText: ${responseText}`); // Log text before parsing
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        const match = responseText.match(jsonBlockRegex);
        if (match && match[1]) {
            const potentialJson = match[1].trim();
            // Further validation: ensure it looks like an array
            if (potentialJson.startsWith('[') && potentialJson.endsWith(']')) {
                try {
                    // Sanitize: Replace standalone 'undefined' with 'null' as undefined is not valid JSON
                    const sanitizedJson = potentialJson.replace(/\bundefined\b/g, 'null');
                    outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Attempting JSON.parse on: ${sanitizedJson}`); // Log before parse
                    testInputs = JSON.parse(sanitizedJson);
                    outputChannel.appendLine(`[CorrectnessVerifier] Successfully parsed ${testInputs.length} test inputs.`);
                    // --- DIAGNOSTIC LOG: Parsed Inputs ---
                    outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Parsed testInputs: ${JSON.stringify(testInputs, null, 2)}`);
                    // --- END DIAGNOSTIC LOG ---
                } catch (parseError: any) {
                    outputChannel.appendLine(`[CorrectnessVerifier] Error parsing extracted JSON: ${parseError.message}. Content: ${potentialJson}`);
                    outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Caught JSON parse error. Stack: ${parseError.stack}`); // Log stack
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
        outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Caught OUTER error during input gen. Stack: ${error.stack}`); // Log stack
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
    // CRITICAL: Loop executing original function for each input via vm
    for (const input of testInputs) {
        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
        const args = Array.isArray(input) ? input : [input]; // Ensure args are always in an array
        // --- DIAGNOSTIC LOG: Original Execution Args ---
        outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Executing Original with args: ${JSON.stringify(args)}`);
        // --- END DIAGNOSTIC LOG ---
        try {
            // CRITICAL: Safe execution using vm context and timeout
            const output = await executeFunctionSafely(originalFunction.code, originalFunctionName, args);
            // --- DIAGNOSTIC LOG: Original Execution Output ---
            outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Original output: ${JSON.stringify(output)}`);
            // --- END DIAGNOSTIC LOG ---
            expectedOutputs.push({ input, output });
        } catch (error: any) {
            // --- DIAGNOSTIC LOG: Original Execution Error ---
            outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Original error: ${error.message}`);
            // --- END DIAGNOSTIC LOG ---
            outputChannel.appendLine(`[CorrectnessVerifier] Original function ('${originalFunctionName}') failed for input ${JSON.stringify(input)}: ${error.message}`);
            expectedOutputs.push({ input, error: error.message });
            // If the original fails, we can't verify alternatives against it for this input
        }
    }

    // 3. Execute Alternatives and Compare Outputs
    const resultsWithStatus: Array<{ alternative: FunctionImplementation, status: 'VERIFIED' | 'REJECTED' | 'INDETERMINATE' }> = [];
    outputChannel.appendLine('[CorrectnessVerifier] Verifying alternatives...');

    // CRITICAL: Loop verifying each alternative
    for (const alt of alternatives) {
        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
        let isEquivalent = true;
        let comparisonPerformed = false; 
        outputChannel.appendLine(`--- Verifying ${alt.name} ---`);
        for (let i = 0; i < testInputs.length; i++) {
            if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
            const input = testInputs[i];
            const expected = expectedOutputs[i];
            const args = Array.isArray(input) ? input : [input];

            // --- DIAGNOSTIC LOG: Alt Verification Input ---
            outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Verifying ${alt.name} - Input ${i + 1}`);
            outputChannel.appendLine(`  - Args: ${JSON.stringify(args)}`);
            outputChannel.appendLine(`  - Expected Result/Error: ${expected.error ? `Error(${expected.error})` : JSON.stringify(expected.output)}`);
            // --- END DIAGNOSTIC LOG ---

            if (expected.error) {
                outputChannel.appendLine(` - Input ${i + 1}: SKIPPED (original function failed)`);
                continue; // Cannot compare if original failed
            }

            comparisonPerformed = true; 

            try {
                // CRITICAL: Safe execution of alternative via vm context and timeout
                const altOutput = await executeFunctionSafely(alt.code, originalFunctionName, args); 
                // --- DIAGNOSTIC LOG: Alt Execution Output ---
                outputChannel.appendLine(`[CorrectnessVerifier DEBUG] ${alt.name} raw output: ${JSON.stringify(altOutput)}`);
                // --- END DIAGNOSTIC LOG ---
                
                // CRITICAL: Compares alternative output (JSON) against original output
                // Compare using JSON stringification for robustness
                const expectedJson = JSON.stringify(expected.output);
                const altJson = JSON.stringify(altOutput);

                if (altJson !== expectedJson) {
                    outputChannel.appendLine(` - Input ${i + 1}: FAILED. Expected JSON: ${expectedJson}, Got JSON: ${altJson}`);
                    isEquivalent = false;
                    break; // No need to check further inputs for this alternative
                } else {
                    outputChannel.appendLine(` - Input ${i + 1}: PASSED`);
                }
            } catch (error: any) {
                 // --- DIAGNOSTIC LOG: Alt Execution Error ---
                 outputChannel.appendLine(`[CorrectnessVerifier DEBUG] ${alt.name} execution error: ${error.message}`);
                 // --- END DIAGNOSTIC LOG ---
                 // FIX: Log the specific error format expected by the test
                outputChannel.appendLine(` - Input ${i + 1}: FAILED (Execution Error).`); 
                outputChannel.appendLine(`   Error: ${error.message}`); // Log the actual error message separately
                isEquivalent = false;
                break; // <<< Ensure break happens
            }
        }

        // Store results with status
        if (isEquivalent && comparisonPerformed) { 
             outputChannel.appendLine(` => ${alt.name}: VERIFIED`);
             resultsWithStatus.push({ alternative: alt, status: 'VERIFIED' }); // Store with status
         } else if (!comparisonPerformed) {
              outputChannel.appendLine(` => ${alt.name}: INDETERMINATE (Original function failed on all inputs)`);
              resultsWithStatus.push({ alternative: alt, status: 'INDETERMINATE' }); // Store with status
         } else {
             outputChannel.appendLine(` => ${alt.name}: REJECTED (Not equivalent)`); // Log rejection reason
             resultsWithStatus.push({ alternative: alt, status: 'REJECTED' }); // Store with status
         }
    }

    // Filter results before returning
    const finalVerifiedAlternatives = resultsWithStatus
        .filter(result => result.status === 'VERIFIED')
        .map(result => result.alternative);

    outputChannel.appendLine(`[CorrectnessVerifier] Verification complete. ${finalVerifiedAlternatives.length} of ${alternatives.length} alternatives passed.`);
    return finalVerifiedAlternatives; // Return only the strictly verified alternatives
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
    // Revert to context that includes __result
    // CRITICAL: Setup of isolated vm context
    const context = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __args: args,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Math: Math,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __result: undefined as any
    };
    vm.createContext(context);

    let isAsync = false;
    let functionRef: any; // Revert to less specific type

    try {
        // Revert async check if needed, or keep simple one
        isAsync = functionCode.includes('async'); // Simple check

        // CRITICAL: Runs the function code within the vm context with timeout
        // Step 1: Run the entire user code in the context to define functions (timeout 1000)
        vm.runInContext(functionCode, context, { timeout: 1000 });

        // CRITICAL: Retrieves the function reference from the context
        // Step 2: Get the function reference by evaluating its name in the context (timeout 50)
        functionRef = vm.runInContext(functionName, context, { timeout: 50 });

        // Step 3: Check if we got a function
        if (typeof functionRef !== 'function') {
            // FIX: Ensure this error message matches test expectation for syntax errors
            // The mock catches syntax errors earlier, but this check is also important.
            throw new Error(`Target function '${functionName}' was not defined or is not a function after evaluating the code.`);
        }

        // +++ Add Log: Before Call +++
        console.error(`[executeFunctionSafely DEBUG] About to call ${functionName} for verification. Args: ${JSON.stringify(context.__args)}`);
        // +++ End Log +++

        // CRITICAL: Executes the actual function call within the vm context with timeout
        // Step 4: Call the function reference within a timed context
        const executionOptions = { timeout: 2000 }; // Timeout for the actual function call (e.g., 2 seconds)
        const callArgsString = JSON.stringify(context.__args); // Serialize args for the script

        const script = `
            const fn = ${functionName};
            const args = ${callArgsString};
            // Assign directly to context.__result, not global.__result
            __result = fn(...args); 
            if (__result instanceof Promise) {
                 (async () => {
                    try {
                        // Await and assign back to context.__result
                        __result = await __result; 
                    } catch (asyncError) {
                        throw asyncError;
                    }
                 })(); // Immediately invoked async function expression
            }
        `;

        vm.runInContext(script, context, executionOptions);

        // If the result was a promise, we need to wait for the IIAFE above to potentially update __result
        // Note: This simplistic wait might not be perfect for all async scenarios,
        // but avoids complex promise handling within the limited context.
        // If the promise resolved or the function was sync, __result is set.
        // If the promise rejected inside the IIAFE, the error should propagate.
        // If the execution timed out, vm.runInContext would throw.

         // +++ Add Log: After Call (use console.error) +++
         // Log the result potentially captured by the script execution
         console.error(`[executeFunctionSafely DEBUG] Call to ${functionName} completed. Raw Result: ${JSON.stringify(context.__result)}`);
         // +++ End Log +++

        return context.__result; // Return the stored result

    } catch (error: any) {
         // +++ Add Log: On Error +++
         console.error(`[executeFunctionSafely DEBUG] Error during execution for ${functionName}. Args: ${JSON.stringify(args)}. Error: ${error.message}`, error.stack);
         // +++ End Log +++
        // FIX: Ensure thrown error message matches test expectation
        // The specific error (like SyntaxError) caught by the mock might be more detailed,
        // but the message thrown *from* executeFunctionSafely should be consistent.
        const errorMessage = `Execution failed for ${functionName}: ${error.message}`;
        console.error(`[executeFunctionSafely] Error: ${errorMessage}`, error.stack);
        const executionError = new Error(errorMessage);
        executionError.stack = error.stack || executionError.stack;
        throw executionError; // Re-throw the combined error
    }
} 
