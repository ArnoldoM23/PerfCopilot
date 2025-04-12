/**
 * ===========================================================================
 * CRUCIAL INTEGRATION TESTS for PerfCopilotParticipant
 * ===========================================================================
 *
 * These tests verify the end-to-end flow of the chat participant,
 * including interaction with mocked language models, the correctness verifier,
 * and the benchmark service (which invokes the benchmark runner).
 *
 * **DO NOT DISABLE OR SKIP THESE TESTS LIGHTLY.**
 * **ALL TESTS IN THIS SUITE MUST PASS BEFORE MERGING CHANGES** to:
 * - src/perfCopilotParticipant.ts
 * - src/utils/correctnessVerifier.ts
 * - src/utils/benchmarkRunner.ts
 * - src/services/benchmarkService.ts
 *
 * These tests are designed to catch regressions in the complex interactions
 * between these components, which have been sources of bugs in the past.
 *
 * ===========================================================================
 */

import * as vscode from 'vscode';
import { PerfCopilotParticipant } from '../perfCopilotParticipant';
import { BenchmarkService } from '../services/benchmarkService';
import { FunctionImplementation } from '../models/types';
import * as CorrectnessVerifier from '../utils/correctnessVerifier'; // To potentially mock verifyFunctionalEquivalence

// --- Mock Dependencies ---

// Mock vscode API
jest.mock('vscode', () => ({
    chat: {
        createChatParticipant: jest.fn().mockImplementation(() => ({ // Return a mock participant object
            onDidReceiveRequest: jest.fn(), // We'll likely simulate the handler call directly
            makeProgress: jest.fn(),
            // Add other properties/methods if needed by the participant code
            iconPath: jest.fn(),
            followupProvider: jest.fn(),
        })),
        // Need to mock ChatLocation enum if used
        ChatLocation: {
            Panel: 1 // Or the correct enum value
        }
    },
    lm: {
        selectChatModels: jest.fn(),
        LanguageModelChatMessage: { // Ensure this constructor is mocked
             User: jest.fn(content => ({ role: 'user', content })),
             Assistant: jest.fn(content => ({ role: 'assistant', content }))
         }
    },
    window: {
        createOutputChannel: jest.fn(() => ({ // Mock OutputChannel
            appendLine: jest.fn((msg) => console.log(`[MockOutput] ${msg}`)), // Log mock output for debugging tests
            show: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            name: 'MockPerfCopilotChannel',
            append: jest.fn(),
            hide: jest.fn(),
            replace: jest.fn(),
        })),
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
    },
    CancellationTokenSource: jest.fn(() => ({
        token: {
            isCancellationRequested: false,
            onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
        },
        cancel: jest.fn(),
        dispose: jest.fn(),
    })),
    ThemeIcon: jest.fn(),
    // Add other vscode parts if needed
}), { virtual: true });

// Mock BenchmarkService
jest.mock('../services/benchmarkService');

// Mock CorrectnessVerifier if needed (alternative: let it run but mock its dependencies)
// jest.mock('../utils/correctnessVerifier');

// --- Test Suite ---

describe('PerfCopilotParticipant - Integration Tests (CRUCIAL)', () => {
    let mockOutputChannel: jest.Mocked<vscode.OutputChannel>;
    let mockBenchmarkService: jest.Mocked<BenchmarkService>;
    let participant: PerfCopilotParticipant;
    let mockLanguageModel: jest.Mocked<vscode.LanguageModelChat>;
    let mockResponseStream: jest.Mocked<vscode.ChatResponseStream>;
    let mockCancellationToken: vscode.CancellationToken;

    // Helper to create mock LLM response
    const createMockLLMResponse = (content: string): vscode.LanguageModelChatResponse => {
        const generator = (async function* () { yield content; })();
        return {
            text: generator,
            stream: generator
        };
    };

     // Helper to get all markdown written to the stream
    const getMarkdownFromStream = (stream: jest.Mocked<vscode.ChatResponseStream>): string => {
        return stream.markdown.mock.calls.map(call => call[0]).join('');
    };

    beforeEach(() => {
        jest.clearAllMocks(); // Ensure mocks are clean for each test

        // Create mocked instances
        mockOutputChannel = vscode.window.createOutputChannel('PerfCopilot') as jest.Mocked<vscode.OutputChannel>;
        mockBenchmarkService = new BenchmarkService(mockOutputChannel) as jest.Mocked<BenchmarkService>;

        // Mock the language model selection and sendRequest
        mockLanguageModel = {
            sendRequest: jest.fn(),
            vendor: 'mock',
            name: 'gpt-mock',
            family: 'mock',
            version: '1.0',
            id: 'mock-lm',
            maxInputTokens: 4000,
            maxOutputTokens: 1000,
            // Added missing properties from LanguageModelChat interface
            tokenCost: { input: 1, output: 1 }, // Example costs
            supportsInputImages: false,
            supportsToolCalling: false,
            countTokens: jest.fn().mockResolvedValue({ count: 100 }) // Example token count
        } as unknown as jest.Mocked<vscode.LanguageModelChat>;
        (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([mockLanguageModel]);

        // Mock response stream
         mockResponseStream = {
             markdown: jest.fn(),
             button: jest.fn(),
             progress: jest.fn(),
             filetree: jest.fn(),
             anchor: jest.fn(),
             reference: jest.fn(),
             push: jest.fn(), // Added push method
             // Add other stream methods if used
         } as unknown as jest.Mocked<vscode.ChatResponseStream>;


        // Mock cancellation token
        mockCancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
        };

        // Instantiate the participant
        participant = new PerfCopilotParticipant(mockOutputChannel, mockBenchmarkService);

    });

    // --- Test Cases ---

    it('CRUCIAL: Should complete the full analysis successfully for a simple case (naiveFactorial)', async () => {
        // Arrange

        // 1. Define Input Code
        const originalCode = `
const naiveFactorial = (n) => {
 if (n < 0) throw new Error('Cannot compute factorial of negative numbers.');
 if (n === 0 || n === 1) return 1;
 let result = 1;
 for (let i = 2; i <= n; i++) {
   let intermediate = 0;
   for (let j = 0; j < i; j++) { intermediate += result; }
   result = intermediate;
 }
 return result;
}
function processNumbers(numbers) {
 const results = [];
 for (const num of numbers) {
   const fact = naiveFactorial(num);
   results.push({ original: num, factorial: fact });
 }
 return results;
}`;

        const mockRequest = {
            prompt: originalCode, // Simple case, no @PerfCopilot prefix needed for direct handler call
            command: undefined, // Or mock command if participant uses it
            references: [],
            toolReferences: [],
            toolInvocationToken: undefined, // Keep undefined, assertion handles the error
            model: mockLanguageModel 
        } as unknown as vscode.ChatRequest; // FIX: Use double type assertion as recommended by linter
        
        const mockContext: vscode.ChatContext = { history: [] }; // Mock context if needed

        // 2. Mock LLM for Alternatives
        const alternativesJson = JSON.stringify([
            {
                name: "Alternative 1",
                code: `const naiveFactorial = (n) => {
                        if (n < 0) throw new Error('Cannot compute factorial of negative numbers.');
                        if (n === 0 || n === 1) return 1;
                        let result = 1;
                        for (let i = 2; i <= n; i++) { result *= i; }
                        return result;
                       };
                       function processNumbers(numbers) { return numbers.map(num => ({ original: num, factorial: naiveFactorial(num) })); }`,
                explanation: "Uses direct multiplication."
            },
            {
                name: "Alternative 2",
                code: `const factMemo = {};
                       const naiveFactorial = (n) => {
                        if (n < 0) throw new Error('Cannot compute factorial of negative numbers.');
                        if (n === 0 || n === 1) return 1;
                        if (factMemo[n]) return factMemo[n];
                        factMemo[n] = n * naiveFactorial(n-1);
                        return factMemo[n];
                       };
                       function processNumbers(numbers) { return numbers.map(num => ({ original: num, factorial: naiveFactorial(num) })); }`,
                explanation: "Uses memoization."
            }
        ]);
        // Ensure JSON within the mock response is properly escaped for string embedding
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(`\`\`\`json\n${alternativesJson.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\n\`\`\``));

        // 3. Mock LLM for Benchmark Config
         const benchmarkConfigJson = JSON.stringify({
             entryPointName: "processNumbers",
             testData: [5, 10, 3], // Simple data for testing
             implementations: { // LLM provides strings back
                 "Original": originalCode,
                 "Alternative 1": `const naiveFactorial = (n) => { if (n < 0) throw new Error('Cannot compute factorial of negative numbers.'); if (n === 0 || n === 1) return 1; let result = 1; for (let i = 2; i <= n; i++) { result *= i; } return result; }; function processNumbers(numbers) { return numbers.map(num => ({ original: num, factorial: naiveFactorial(num) })); }`, // Unabbreviated
                 "Alternative 2": `const factMemo = {}; const naiveFactorial = (n) => { if (n < 0) throw new Error('Cannot compute factorial of negative numbers.'); if (n === 0 || n === 1) return 1; if (factMemo[n]) return factMemo[n]; factMemo[n] = n * naiveFactorial(n-1); return factMemo[n]; }; function processNumbers(numbers) { return numbers.map(num => ({ original: num, factorial: naiveFactorial(num) })); }` // Unabbreviated
             }
         });
         // Ensure JSON within the mock response is properly escaped
         mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(`\`\`\`json\n${benchmarkConfigJson.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\n\`\`\``));

        // 4. Mock Correctness Verifier (Option B: Mock verifyFunctionalEquivalence directly)
        const verifiedAlt1: FunctionImplementation = { name: 'Alternative 1', code: '...', description: 'Uses direct multiplication.' };
        const verifiedAlt2: FunctionImplementation = { name: 'Alternative 2', code: '...', description: 'Uses memoization.' };
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([
             verifiedAlt1,
             verifiedAlt2
         ]);


        // 5. Mock Benchmark Service
        const mockBenchmarkResults = {
            fastest: 'Alternative_1', // Sanitized name
            results: [
                { name: 'Original', ops: 1000, margin: 0.5 },
                { name: 'Alternative_1', ops: 5000, margin: 0.5 },
                { name: 'Alternative_2', ops: 4000, margin: 0.5 }
            ]
        };
        mockBenchmarkService.runBenchmark.mockResolvedValue(mockBenchmarkResults);

        // 6. Mock LLM for Explanation
        const mockExplanation = "# Analysis\nFastest was Alternative 1...";
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(mockExplanation)); // Third call is for explanation

        // Act
        // Directly call the handler function obtained from createRequestHandler
        const handler = (participant as any).createRequestHandler(); // Access private method for test
        await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert

        // Check progress messages
        expect(mockResponseStream.progress).toHaveBeenCalledWith('Extracting function...');
        expect(mockResponseStream.progress).toHaveBeenCalledWith('Generating alternative implementations...');
        // Correctness check progress message is internal to verifyFunctionalEquivalence when mocked
        // expect(mockResponseStream.progress).toHaveBeenCalledWith('Verifying functional correctness...');
        expect(mockResponseStream.progress).toHaveBeenCalledWith('Generating benchmark code via AI...');
         expect(mockResponseStream.progress).toHaveBeenCalledWith('Running benchmarks...');
         expect(mockResponseStream.progress).toHaveBeenCalledWith('Analyzing benchmark results with AI...');


        // Check if alternatives were parsed
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Parsed 2 alternatives from JSON.'));

        // Check verification call (Option B)
        expect(mockVerify).toHaveBeenCalledTimes(1);
        // Check verification logging (based on Option B mock success)
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Verification complete. 2 of 2 alternatives passed.'));

        // Check benchmark service call input (important!)
        expect(mockBenchmarkService.runBenchmark).toHaveBeenCalledTimes(1);
        const benchmarkModuleCodeArg = mockBenchmarkService.runBenchmark.mock.calls[0][0];
        // Use stringContaining for robustness against formatting variations
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('const testData = [ 5, 10, 3 ]'));
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('entryPointName: "processNumbers"'));
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('"Original":'));
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('"Alternative_1":')); // Check sanitized names used as keys
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('"Alternative_2":'));

        // Check final explanation streaming
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(mockExplanation);

        // Check overall success logging
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Request processed successfully.');

        // Clean up explicit spy if used (Option B)
         mockVerify.mockRestore();
    });

    // --- ADDING FAILURE SCENARIO TESTS ---

    it('CRUCIAL: Should handle cases where one alternative fails verification', async () => {
        // Arrange (similar setup to success case)
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const alt1Impl = { name: 'Alternative 1', code: '...', description: 'For loop' };
        // alt2Impl is not used directly in mock return

        // Mock LLM for Alternatives (return 2 valid alternatives initially)
        // FIX: Use template literals for easier JSON embedding
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(
            `\`\`json\n
            [\n              {\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"For loop\"},\n              {\"name\":\"Alternative 2\",\"code\":\"...\",\"explanation\":\"Addition\"}\n            ]\n            \`\`\`
        `));

        // Mock LLM for Benchmark Config
        // FIX: Use template literals for easier JSON embedding
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(
            `\`\`json\n
            {
              \"entryPointName\": \"processNumbers\",
              \"testData\": [1],
              \"implementations\": { \"Original\": \"...\", \"Alternative 1\": \"...\", \"Alternative 2\": \"...\" }
            }
            \`\`\`
        `));

        // !! Mock Correctness Verifier to FAIL one alternative !!
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([alt1Impl]); // Only Alt 1 passes

        // Mock Benchmark Service (expects only Original & Alt 1)
        const mockBenchmarkResults = { fastest: 'Alternative_1', results: [{ name: 'Original', ops: 1000, margin: 0.5 }, { name: 'Alternative_1', ops: 1500, margin: 0.5 }] };
        mockBenchmarkService.runBenchmark.mockResolvedValue(mockBenchmarkResults);

        // Mock LLM for Explanation
        const mockExplanation = "# Analysis\nOnly Alt 1 tested.";
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(mockExplanation));

        // Act
        const handler = (participant as any).createRequestHandler();
        await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Verification complete. 1 of 2 alternatives passed.'));
        // Check that benchmark only includes Original and the verified Alt 1
        expect(mockBenchmarkService.runBenchmark).toHaveBeenCalledTimes(1);
        const benchmarkModuleCodeArg = mockBenchmarkService.runBenchmark.mock.calls[0][0];
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('"Original":'));
        expect(benchmarkModuleCodeArg).toEqual(expect.stringContaining('"Alternative_1":'));
        expect(benchmarkModuleCodeArg).not.toEqual(expect.stringContaining('"Alternative_2":'));
        // Check final explanation was streamed
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(mockExplanation);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Request processed successfully.');

        mockVerify.mockRestore();
    });

    it('CRUCIAL: Should handle errors during benchmark execution', async () => {
        // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const dummyAlternative = { name: 'Alternative 1', code: '...', description: '...' };

        // Mock LLM calls needed before benchmark (Simplified JSON)
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n[{\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"...\"}]\n```'));
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n{\"entryPointName\":\"processNumbers\",\"testData\":[1],\"implementations\":{\"Original\":\"...\",\"Alternative_1\":\"...\"}}\n```'));
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([dummyAlternative]);

        // !! Mock Benchmark Service to REJECT !!
        const benchmarkError = new Error('Benchmark script crashed!');
        mockBenchmarkService.runBenchmark.mockRejectedValue(benchmarkError);

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockBenchmarkService.runBenchmark).toHaveBeenCalledTimes(1);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error running benchmark: Error: Benchmark script crashed!'));
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** Failed to run benchmarks.'));
        // Explanation should NOT be requested
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(2); // Alternatives + Benchmark Config only
        expect(result.metadata?.error).toContain('Benchmark execution error');

        mockVerify.mockRestore();
    });

    it('CRUCIAL: Should handle LLM error getting alternatives', async () => {
        // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };

        // !! Mock LLM to fail on FIRST call (alternatives) !!
        const alternativesError = new Error('LLM unavailable');
        mockLanguageModel.sendRequest.mockRejectedValueOnce(alternativesError);

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(1);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error getting alternatives: Error: LLM unavailable'));
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** Failed to generate alternative implementations.'));
        expect(CorrectnessVerifier.verifyFunctionalEquivalence).not.toHaveBeenCalled();
        expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('LLM error getting alternatives');
    });

    it('CRUCIAL: Should handle LLM error getting benchmark config', async () => {
        // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const dummyAlternative = { name: 'Alternative 1', code: '...', description: '...' };

        // Mock LLM success for alternatives (Simplified JSON)
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n[{\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"...\"}]\n```'));

        // !! Mock LLM to fail on SECOND call (benchmark config) !!
        const benchmarkConfigError = new Error('Quota exceeded');
        mockLanguageModel.sendRequest.mockRejectedValueOnce(benchmarkConfigError);
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([dummyAlternative]);

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(2);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error generating benchmark code via AI: Error: Quota exceeded'));
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** Failed to generate benchmark code using AI.'));
        expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('Benchmark generation error (LLM)');

        mockVerify.mockRestore();
    });

     it('CRUCIAL: Should handle LLM error getting explanation', async () => {
        // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const dummyAlternative = { name: 'Alternative 1', code: '...', description: '...' };

        // Mock successful LLM calls before explanation (Simplified JSON)
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n[{\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"...\"}]\n```'));
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n{\"entryPointName\":\"processNumbers\",\"testData\":[1],\"implementations\":{\"Original\":\"...\",\"Alternative_1\":\"...\"}}\n```'));
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([dummyAlternative]);
        const mockBenchmarkResults = { fastest: 'Alternative_1', results: [{ name: 'Original', ops: 1000, margin: 0.5 }, { name: 'Alternative_1', ops: 1500, margin: 0.5 }] };
        mockBenchmarkService.runBenchmark.mockResolvedValue(mockBenchmarkResults);

        // !! Mock LLM to fail on THIRD call (explanation) !!
        const explanationError = new Error('Content filter triggered');
        mockLanguageModel.sendRequest.mockRejectedValueOnce(explanationError);

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(3);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error getting explanation: Error: Content filter triggered'));
        const markdownOutput = getMarkdownFromStream(mockResponseStream);
        expect(markdownOutput).toContain('🔴 **Error:** Failed to get AI analysis of results.');
        expect(markdownOutput).toContain(JSON.stringify(mockBenchmarkResults, null, 2));
        expect(result.metadata?.error).toContain('LLM error getting explanation');
        expect(result.metadata?.benchmarkResults).toEqual(mockBenchmarkResults);

        mockVerify.mockRestore();
    });

    it('CRUCIAL: Should handle function extraction failure (no code)', async () => {
        // Arrange
        const mockRequest = { prompt: "Analyze this", command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** No JavaScript/TypeScript function found'));
        expect(mockLanguageModel.sendRequest).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('No function code extracted');
    });

    it('CRUCIAL: Should handle function extraction failure (invalid code)', async () => {
        // Arrange
        const invalidCode = `function invalid { return 1;`;
        const mockRequest = { prompt: invalidCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** The extracted code does not appear to be a valid'));
        expect(mockLanguageModel.sendRequest).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('Invalid function code extracted');
    });

    it('CRUCIAL: Should handle benchmark config parsing failure (invalid JSON)', async () => {
         // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const dummyAlternative = { name: 'Alternative 1', code: '...', description: '...' };

        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n[{\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"...\"}]\n```'));
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([dummyAlternative]);

        // !! Mock LLM for Benchmark Config with INVALID JSON !!
        // Malformed JSON string (missing comma)
        const invalidBenchmarkConfigJson = '```json\n{\n  \"entryPointName\": \"processNumbers\",\n  \"testData\": [1, 2, 3] \n  \"implementations\": { \"Original\": \"...\" }}\n```';
        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(invalidBenchmarkConfigJson));

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(2);
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Failed to parse benchmark config JSON'));
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** Failed to generate benchmark code using AI.'));
        expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('Benchmark generation error (LLM)');

        mockVerify.mockRestore();
    });

     it('CRUCIAL: Should handle benchmark config parsing failure (missing fields)', async () => {
         // Arrange
        const originalCode = `function processNumbers(numbers) { return numbers.map(n => n*2); }`;
        const mockRequest = { prompt: originalCode, command: undefined, references: [], toolReferences: [], toolInvocationToken: undefined, model: mockLanguageModel } as unknown as vscode.ChatRequest;
        const mockContext: vscode.ChatContext = { history: [] };
        const dummyAlternative = { name: 'Alternative 1', code: '...', description: '...' };

        mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse('```json\n[{\"name\":\"Alternative 1\",\"code\":\"...\",\"explanation\":\"...\"}]\n```'));
        const mockVerify = jest.spyOn(CorrectnessVerifier, 'verifyFunctionalEquivalence').mockResolvedValue([dummyAlternative]);

        // !! Mock LLM for Benchmark Config with MISSING FIELDS JSON !!
        // FIX: Define the object correctly before stringifying
        const incompleteBenchmarkConfig = {
             // entryPointName: "processNumbers", // MISSING
             testData: [1, 2, 3],
             implementations: { "Original": originalCode }
         };
         const incompleteBenchmarkConfigJson = JSON.stringify(incompleteBenchmarkConfig);
         // FIX: Correct the closing backticks in the template literal
         mockLanguageModel.sendRequest.mockResolvedValueOnce(createMockLLMResponse(`\`\`\`json\n${incompleteBenchmarkConfigJson}\n\`\`\``)); // Use standard closing ```

        // Act
        const handler = (participant as any).createRequestHandler();
        const result = await handler(mockRequest, mockContext, mockResponseStream, mockCancellationToken);

        // Assert
        expect(mockLanguageModel.sendRequest).toHaveBeenCalledTimes(2);
        // This error now originates from the validation logic within the participant
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON structure received for benchmark config'));
        expect(mockResponseStream.markdown).toHaveBeenCalledWith(expect.stringContaining('🔴 **Error:** Failed to generate benchmark code using AI.'));
        expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled();
        expect(result.metadata?.error).toContain('Benchmark generation error (LLM)');

        mockVerify.mockRestore();
    });

// --- END OF ADDED TESTS ---

});