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
                    return alternatives; // Skip verification on parse error
                }
            } else {
                outputChannel.appendLine(`[CorrectnessVerifier] Extracted block doesn\'t look like a JSON array. Content: ${potentialJson}`);
                return alternatives; // Skip verification if content isn\'t an array
            }
        } else {
            outputChannel.appendLine('[CorrectnessVerifier] Could not extract JSON test inputs from LLM response. Skipping correctness check.');
            return alternatives; // Skip verification if inputs aren't generated
        }
    } catch (error: any) {
        outputChannel.appendLine(`[CorrectnessVerifier] Error generating/parsing test inputs: ${error.message}. Skipping correctness check.`);
        return alternatives; // Skip verification on error
    }

    if (token.isCancellationRequested) { throw new Error('Operation cancelled'); }

    if (testInputs.length === 0) {
        outputChannel.appendLine('[CorrectnessVerifier] No test inputs generated. Skipping correctness check.');
        return alternatives;
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
async function executeFunctionSafely(functionCode: string, args: any[]): Promise<any> {
    try {
        // Create a context for the VM script, passing arguments
        const context = { 
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __args: args,
            __functionCodeString: functionCode, // Pass the code string itself into the context
            // Add any other globals needed, carefully (e.g., console, Math)
            console: {
                log: () => {}, // Suppress console.log within the function
                warn: () => {}, 
                error: () => {}
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Math: Math // Allow Math operations
            // Avoid adding Node.js globals like 'process', 'require' unless absolutely necessary
        };
        vm.createContext(context); // Contextify the object

        // Script that uses Function constructor inside the VM to create and run the function
        const scriptContent = `
            let __fn;
            try {
                // Use Function constructor for potentially safer evaluation within the VM context
                __fn = new Function('return (' + __functionCodeString + ')')();
            } catch (e1) {
                // If the above fails (e.g., it's a statement like 'function name(){...}'), try evaluating directly
                try {
                    vm.runInContext(__functionCodeString, context); // Evaluate declaration
                    const funcNameMatch = __functionCodeString.match(/^(?:async\\s+)?function\\s+([a-zA-Z_$][\\w$]*)/);
                    if (!funcNameMatch) throw new Error('Could not find function name after direct evaluation');
                    __fn = context[funcNameMatch[1]]; // Get the function from the context
                } catch (e2) {
                    throw new Error('Could not create function from code string: ' + e1.message + ' / ' + e2.message);
                }
            }
            if (typeof __fn !== 'function') {
                throw new Error('Provided code did not resolve to a function.');
            }
            __fn(...__args); // Execute the function
        `;

        // Compile and run the script in the isolated context
        const script = new vm.Script(scriptContent);
        const result = script.runInContext(context, { timeout: 2000 }); // Increase timeout slightly
        return result;
    } catch (error: any) { 
        throw new Error(`Execution failed: ${error.message}`);
    }
} 