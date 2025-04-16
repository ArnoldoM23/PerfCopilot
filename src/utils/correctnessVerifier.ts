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

        // --- Fix 1: Correct Stream Handling for Input Generation ---
        for await (const chunk of request.stream) { 
            if (token.isCancellationRequested) { 
                outputChannel.appendLine('[CorrectnessVerifier:InputGen] Operation cancelled during stream.');
                throw new Error('Operation cancelled'); 
            }
            if (chunk instanceof vscode.LanguageModelTextPart) {
                responseText += chunk.value;
            } else {
                // Log unexpected chunk types just in case
                outputChannel.appendLine(`[CorrectnessVerifier:InputGen] Received unexpected chunk type: ${typeof chunk}`);
            }
        }
        // --- End Fix 1 ---

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
                    // --- DIAGNOSTIC LOG: Parsed Inputs ---
                    outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Parsed testInputs: ${JSON.stringify(testInputs, null, 2)}`);
                    // --- END DIAGNOSTIC LOG ---
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
        // --- DIAGNOSTIC LOG: Original Execution Args ---
        outputChannel.appendLine(`[CorrectnessVerifier DEBUG] Executing Original with args: ${JSON.stringify(args)}`);
        // --- END DIAGNOSTIC LOG ---
        try {
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
    const verifiedAlternatives: FunctionImplementation[] = [];
    outputChannel.appendLine('[CorrectnessVerifier] Verifying alternatives...');

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
                const altOutput = await executeFunctionSafely(alt.code, originalFunctionName, args);
                // --- DIAGNOSTIC LOG: Alt Execution Output ---
                outputChannel.appendLine(`[CorrectnessVerifier DEBUG] ${alt.name} raw output: ${JSON.stringify(altOutput)}`);
                // --- END DIAGNOSTIC LOG ---
                
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
                outputChannel.appendLine(` - Input ${i + 1}: FAILED (Execution Error). Error: ${error.message}`);
                isEquivalent = false;
                break; // Alternative threw an error, not equivalent
            }
        }

        if (isEquivalent && comparisonPerformed) { 
            outputChannel.appendLine(` => ${alt.name}: VERIFIED`);
            verifiedAlternatives.push(alt);
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
    // Revert to context that includes __result
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

        // Step 1: Run the entire user code in the context to define functions (timeout 1000)
        vm.runInContext(functionCode, context, { timeout: 1000 });

        // Step 2: Get the function reference by evaluating its name in the context (timeout 50)
        functionRef = vm.runInContext(functionName, context, { timeout: 50 });

        // Step 3: Check if we got a function
        if (typeof functionRef !== 'function') {
            throw new Error(`Target function '${functionName}' was not defined or is not a function after evaluating the code.`);
        }

        // +++ Add Log: Before Call +++
        console.error(`[executeFunctionSafely DEBUG] About to call ${functionName} for verification. Args: ${JSON.stringify(context.__args)}`);
        // +++ End Log +++

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
        const errorMessage = `Execution failed for ${functionName}: ${error.message}`;
        console.error(`[executeFunctionSafely] Error: ${errorMessage}`, error.stack);
        const executionError = new Error(errorMessage);
        executionError.stack = error.stack || executionError.stack;
        throw executionError;
    }
} 
