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
 * @returns A promise that resolves to an array of functionally equivalent alternatives.
 * @throws If verification cannot be completed due to errors.
 */
export async function verifyFunctionalEquivalence(
    originalFunction: FunctionImplementation,
    alternatives: FunctionImplementation[],
    languageModel: vscode.LanguageModelChat,
    createInputGenerationPrompt: (code: string) => string,
    outputChannel: vscode.OutputChannel,
    token: vscode.CancellationToken
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
        const args = Array.isArray(input) ? input : [input]; // Ensure args are always in an array
        try {
            const output = await executeFunctionSafely(originalFunction.code, args);
            expectedOutputs.push({ input, output });
        } catch (error: any) {
            outputChannel.appendLine(`[CorrectnessVerifier] Original function failed for input ${JSON.stringify(input)}: ${error.message}`);
            expectedOutputs.push({ input, error: error.message });
            // If the original fails, we can't verify alternatives against it for this input
        }
        if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
    }

    // 3. Execute Alternatives and Compare Outputs
    const verifiedAlternatives: FunctionImplementation[] = [];
    outputChannel.appendLine('[CorrectnessVerifier] Verifying alternatives...');

    for (const alt of alternatives) {
        let isEquivalent = true;
        outputChannel.appendLine(`--- Verifying ${alt.name} ---`);
        for (let i = 0; i < testInputs.length; i++) {
            const input = testInputs[i];
            const expected = expectedOutputs[i];
            const args = Array.isArray(input) ? input : [input];

            if (expected.error) {
                outputChannel.appendLine(` - Skipping input ${i + 1} (original failed)`);
                continue; // Cannot compare if original failed
            }

            try {
                const altOutput = await executeFunctionSafely(alt.code, args);
                // Use util.isDeepStrictEqual which returns a boolean
                if (!util.isDeepStrictEqual(altOutput, expected.output)) {
                    outputChannel.appendLine(` - Input ${i + 1}: FAILED. Expected: ${JSON.stringify(expected.output)}, Got: ${JSON.stringify(altOutput)}`);
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
            if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }
        }

        if (isEquivalent) {
            outputChannel.appendLine(` => ${alt.name}: VERIFIED`);
            verifiedAlternatives.push(alt);
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
 * @param args - An array of arguments to pass to the function.
 * @returns The result of the function execution.
 * @throws If the code cannot be compiled or execution fails.
 */
export async function executeFunctionSafely(functionCode: string, args: any[]): Promise<any> {
    // Create a context for the VM script, passing arguments
    const context = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __args: args,
        // Add any other globals needed, carefully (e.g., Math)
        console: {
            log: () => {}, // Suppress console.log within the function
            warn: () => {},
            error: () => {}
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Math: Math,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __result: undefined, // Variable to store the result
        // Pass vm module itself ONLY if absolutely necessary for advanced sandboxing cases,
        // but generally avoid it. Avoid other Node.js globals like 'process', 'require'.
    };
    vm.createContext(context); // Contextify the object

    let targetFunctionName: string | undefined;
    let isAsync = false;

    try {
        // Step 1: Run the entire user code in the context to define functions
        // Use a timeout to prevent infinite loops in the user code itself during definition.
        vm.runInContext(functionCode, context, { timeout: 1000 });

        // Step 2: Identify the primary function to execute
        // Attempt to find the *first* declared function or assigned arrow function
        // This is a limitation: assumes the first function is the entry point.
        const functionNameMatch = functionCode.match(/(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
        const arrowFunctionNameMatch = functionCode.match(/^(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*(?:async\s*)?\(/);

        if (functionNameMatch && functionNameMatch[1]) {
            targetFunctionName = functionNameMatch[1];
             isAsync = /async\s+function/.test(functionCode.substring(0, functionNameMatch[0].length + functionNameMatch[1].length + 10)); // Check if async keyword precedes function
        } else if (arrowFunctionNameMatch && arrowFunctionNameMatch[1]) {
             targetFunctionName = arrowFunctionNameMatch[1];
             isAsync = /=\s*async\s*\(/.test(functionCode.substring(0, arrowFunctionNameMatch[0].length + arrowFunctionNameMatch[1].length + 15)); // Check if async keyword precedes arrow func
        } else {
             // Fallback: Maybe it's an immediately exported anonymous function or similar?
             // Try a broader regex, less reliable.
             const broaderMatch = functionCode.match(/^(?:module\.exports\s*=\s*)?(?:async\s+)?function\s*\(/);
             if (broaderMatch) {
                 // Difficult to get a name here, execution needs different approach if truly anonymous.
                 // For now, let's throw, as our primary mechanism needs a name.
                  throw new Error('Could not reliably determine the target function name to execute.');
             } else {
                  throw new Error('Could not find a function declaration or assignment to execute.');
             }
        }
        
        // Ensure targetFunctionName is defined before using it as index
        if (!targetFunctionName) {
            throw new Error('Failed to identify target function name.');
        }
        if (typeof (context as any)[targetFunctionName] !== 'function') {
            throw new Error(`Target function '${targetFunctionName}' was not defined or is not a function after evaluating the code.`);
        }

        // Step 3: Construct and run a script to CALL the target function
        // Use an async IIFE if the target function is async
        const callScriptContent = `
            (async () => {
                // Double check function exists in context just before calling
                if (typeof ${(context as any)[targetFunctionName!] ? targetFunctionName : 'undefined'} !== 'function') {
                     throw new Error('Target function ${targetFunctionName} disappeared from context');
                 }
                __result = ${isAsync ? 'await ' : ''}${targetFunctionName}(...__args);
            })();
        `;

        const callScript = new vm.Script(callScriptContent, { filename: 'executionScript.js' });
        // Use a separate timeout for the actual execution.
        // Needs to be awaited because the script runs an async IIFE.
        // Removed microtaskMode as it caused linting error
        await callScript.runInContext(context, { timeout: 2000 }); 

        return context.__result; // Return the stored result

    } catch (error: any) {
        // Improve error reporting
        const errorMessage = `Execution failed: ${error.message}${targetFunctionName ? ` (targeting function: ${targetFunctionName})` : ''}`;
        console.error(`[executeFunctionSafely] Error: ${errorMessage}`, error.stack); // Log stack trace too
        // Re-throw a new error with combined info, preserving original stack if possible
        const executionError = new Error(errorMessage);
        executionError.stack = error.stack || executionError.stack; // Preserve original stack if available
        throw executionError;
    }
} 