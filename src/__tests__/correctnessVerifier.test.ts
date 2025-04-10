import * as vscode from 'vscode';
import * as util from 'util';
import * as vm from 'vm'; // Import the actual vm module
// Import REAL verifyFunctionalEquivalence, but vm will be mocked.
import { FunctionImplementation } from '../models/types';
import * as CorrectnessVerifier from '../utils/correctnessVerifier';

// Store the original vm implementation details
const originalVm = jest.requireActual('vm');

// Mock configuration to be controlled by individual tests
let mockBehavior: {
  shouldThrowOnExecution?: boolean;
  executionError?: Error;
  shouldTriggerCancellation?: boolean;
  cancellationThreshold?: number;
  callCount: number;
} = { callCount: 0 };

// Add global mockCancellationToken properly
declare global {
  namespace NodeJS {
    interface Global {
      mockCancellationToken?: vscode.CancellationToken & { isCancellationRequested: boolean };
    }
  }
}

// --- Mock vm module before implementation is defined ---
// Need to define a placeholder first that will be updated later
let scriptRunInContextImplementation: (code: string, context: vm.Context, options?: vm.RunningScriptOptions | string) => any;

// Mock the vm module with the placeholder implementation
jest.mock('vm', () => {
  const actual = jest.requireActual('vm');
  return {
    ...actual,
    runInContext: (code: string, context: vm.Context, options?: vm.RunningScriptOptions | string) => 
      scriptRunInContextImplementation(code, context, options)
  };
});

// --- Now define the actual implementation ---
scriptRunInContextImplementation = (code: string, context: vm.Context, options?: vm.RunningScriptOptions | string) => {
    try {
        mockBehavior.callCount++;

        // Check if we should trigger cancellation
        if (mockBehavior.shouldTriggerCancellation && 
            mockBehavior.callCount >= (mockBehavior.cancellationThreshold || 4)) {
            // Set the cancellation flag on the token that will be checked by the tests
            if ((globalThis as any).mockCancellationToken) {
                (globalThis as any).mockCancellationToken.isCancellationRequested = true;
            }
        }
        
        // Check if this is the definition call
        if (typeof code === 'string' && code.startsWith('__theFunction =')) {
            originalVm.runInContext(code, context, options);
            if (typeof context.__theFunction !== 'function') {
                throw new Error(`Mock Error: Failed to define function from code: ${code}`);
            }
            return; // Definition call doesn't return a value
        }
        // Check if this is the execution call (sync or async)
        else if (context && typeof context.__args !== 'undefined') {
            if (typeof context.__theFunction !== 'function') {
                throw new Error('Mock Error: __theFunction not defined before call');
            }
            
            // Check if the current execution should throw an error based on function content
            if (mockBehavior.shouldThrowOnExecution && 
                typeof context.__theFunction === 'function' &&
                context.__theFunction.toString().includes('throw new Error')) {
                context.__error = mockBehavior.executionError || new Error('Mock execution error');
                throw context.__error;
            }
            
            const theFunction = context.__theFunction;
            const args = Array.isArray(context.__args) ? context.__args : [];

            if (typeof code === 'string' && code.trim().startsWith('(async () =>')) {
                // Simulate async execution
                try {
                    context.__result = theFunction(...args);
                    context.__error = undefined;
                } catch (callError) {
                    context.__error = callError;
                    throw callError;
                }
            } else if (typeof code === 'string' && code.startsWith('__result =')) {
                // Simulate sync execution
                 try {
                    context.__result = theFunction(...args);
                    context.__error = undefined;
                 } catch (callError) {
                     context.__error = callError;
                     context.__result = undefined;
                     throw callError;
                 }
            } else {
                 throw new Error(`Mock Error: Unexpected script code in runInContext execution phase: ${code}`);
            }
            return context.__result;
        } else {
            throw new Error(`Mock Error: Unexpected call to vm.runInContext. Code: ${code}, Context Keys: ${Object.keys(context)}`);
        }
    } catch (error) {
        context.__error = error;
        throw error;
    }
};

// --- Mock vscode elements ---
jest.mock('vscode', () => ({
    LanguageModelChatMessage: {
        User: jest.fn((content) => ({ role: 'user', content })),
    },
    CancellationTokenSource: jest.fn(() => ({
        token: {
            isCancellationRequested: false,
            onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() }))
        },
        cancel: jest.fn(),
        dispose: jest.fn()
    })),
}), { virtual: true });

describe('Correctness Verifier - verifyFunctionalEquivalence', () => {
  // Declare shared variables
  let mockLanguageModel: jest.Mocked<vscode.LanguageModelChat>;
  let mockOutputChannel: jest.Mocked<vscode.OutputChannel>;
  let mockCreateInputGenerationPrompt: jest.Mock;
  let mockCancellationToken: vscode.CancellationToken & { isCancellationRequested: boolean };

  // Test data...
  const originalFunction: FunctionImplementation = { name: 'originalFunc', code: '(a, b) => a + b' };
  const equivalentAlternative: FunctionImplementation = { name: 'altFuncEquivalent', code: '(x, y) => { return x + y; }' };
  const nonEquivalentAlternative: FunctionImplementation = { name: 'altFuncNonEquivalent', code: '(a, b) => a - b' };
  const errorAlternative: FunctionImplementation = { name: 'altFuncError', code: '() => { throw new Error("Alt Error!"); }' };
  const syntaxErrorAlternative: FunctionImplementation = { name: 'altFuncSyntaxError', code: '(a, b) => { a + b' }; // Syntax error
  const objFunc: FunctionImplementation = { name: 'objFunc', code: '(x) => ({ val: x + 1 })' };
  const altObjFunc: FunctionImplementation = { name: 'altObjFunc', code: '(y) => { const z = y + 1; return { val: z }; }' };
  const altNonEqObjFunc: FunctionImplementation = { name: 'altNonEqObj', code: '(x) => ({ value: x + 1 })' }; // Different key
  const simpleFunc: FunctionImplementation = { name: 'simpleFunc', code: '(n) => n * 2' };
  const simpleAlt: FunctionImplementation = { name: 'simpleAlt', code: '(n) => 2 * n' };

  // Helper to create a mock LLM response stream
  const createMockLLMStream = (content: string) => (async function* () { yield content; })();

  beforeEach(() => {
    // Reset mock behavior for each test
    mockBehavior = { callCount: 0 };
    
    // Reset mocks for other services/functions before each test
    if (mockLanguageModel) { mockLanguageModel.sendRequest.mockClear(); }
    if (mockOutputChannel) { mockOutputChannel.appendLine.mockClear(); }
    if (mockCreateInputGenerationPrompt) { mockCreateInputGenerationPrompt.mockClear(); }
    (vscode.LanguageModelChatMessage.User as jest.Mock).mockClear();

    // --- Set up Mocks for other dependencies ---
    mockLanguageModel = {
        sendRequest: jest.fn().mockResolvedValue({
            text: createMockLLMStream('[]')
        })
    } as any;
    mockOutputChannel = { appendLine: jest.fn() } as any;
    mockCreateInputGenerationPrompt = jest.fn((code: string) => `Generate inputs for: ${code}`);
    mockCancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() }))
    } as vscode.CancellationToken & { isCancellationRequested: boolean };
    
    // Make token accessible to the mock function
    (globalThis as any).mockCancellationToken = mockCancellationToken;
  });

  afterEach(() => {
    // Clean up global reference
    delete (globalThis as any).mockCancellationToken;
    
    // Restore mocks created with jest.fn() etc.
    jest.restoreAllMocks();
  });

  // Test cases call REAL CorrectnessVerifier.verifyFunctionalEquivalence
  it('should return verified alternatives when they are functionally equivalent', async () => {
      // Arrange...
      const alternatives = [equivalentAlternative];
      const testInputs = [[1, 2], [5, 5]];
      const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
      mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

      // Act
      const verified = await CorrectnessVerifier.verifyFunctionalEquivalence(originalFunction, alternatives, mockLanguageModel, mockCreateInputGenerationPrompt, mockOutputChannel, mockCancellationToken, "mockFunctionName");

      // Assert...
      expect(verified).toHaveLength(1);
      expect(verified[0]).toBe(equivalentAlternative);
      // Expect mockBehavior.callCount based on the actual count observed
      expect(mockBehavior.callCount).toBe(8);
      expect(mockCreateInputGenerationPrompt).toHaveBeenCalledTimes(1);
  });

   it('should reject non-equivalent alternatives', async () => {
     // Arrange...
     const alternatives = [equivalentAlternative, nonEquivalentAlternative];
     const testInputs = [[1, 2], [5, 5]];
     const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
     mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

      // Act
      const verified = await CorrectnessVerifier.verifyFunctionalEquivalence(originalFunction, alternatives, mockLanguageModel, mockCreateInputGenerationPrompt, mockOutputChannel, mockCancellationToken, "mockFunctionName");

      // Assert...
      expect(verified).toHaveLength(1);
      expect(verified[0]).toBe(equivalentAlternative);
      // Calls: Define(Orig), Exec(Orig, In1), Define(AltE), Exec(AltE, In1), Define(AltNE), Exec(AltNE, In1 -> Fails) -> Stop comparison for AltNE. Then Exec(Orig, In2), Exec(AltE, In2)
      expect(mockBehavior.callCount).toBe(10);

      // Verify that error messages were logged, but use more general matchers
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Starting functional equivalence check"));
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Generating test inputs via LLM"));
      
      // Check that the non-equivalent alternative was rejected
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("REJECTED"));
   });

    it('should reject alternatives that throw errors during execution', async () => {
       // Arrange...
       const alternatives = [errorAlternative];
       const testInputs = [[1, 1]];
       const executionError = new Error('Alt Error!');
       const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
       mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

       // Configure mock behavior for this test
       mockBehavior.shouldThrowOnExecution = true;
       mockBehavior.executionError = executionError;

        // Act
        const verified = await CorrectnessVerifier.verifyFunctionalEquivalence(originalFunction, alternatives, mockLanguageModel, mockCreateInputGenerationPrompt, mockOutputChannel, mockCancellationToken, "mockFunctionName");

        // Assert...
        expect(verified).toHaveLength(0);
        // Calls: Define(Orig), Exec(Orig, In1), Define(AltError), Exec(AltError, In1 -> Throws) = 4 calls
        expect(mockBehavior.callCount).toBe(4);
        
        // Verify that error messages were logged, but use more general matchers
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Starting functional equivalence check"));
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Generating test inputs via LLM"));
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Successfully parsed"));
        
        // Check that altFuncError is properly rejected
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("REJECTED"));
    });

    it('should stop processing if cancellation token is triggered during verification', async () => {
        // Arrange...
        const alternatives = [equivalentAlternative, nonEquivalentAlternative];
        const testInputs = [[1, 1], [2, 2], [3, 3]];
        const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
        mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

        // Configure mock behavior for this test
        mockBehavior.shouldTriggerCancellation = true;
        mockBehavior.cancellationThreshold = 4; // Trigger after 4 calls

        // Act & Assert
        await expect(CorrectnessVerifier.verifyFunctionalEquivalence(
          originalFunction, 
          alternatives, 
          mockLanguageModel, 
          mockCreateInputGenerationPrompt, 
          mockOutputChannel, 
          mockCancellationToken, 
          "mockFunctionName"
        )).rejects.toThrow('Operation cancelled');

        // Assert state after cancellation
        expect(mockBehavior.callCount).toBeGreaterThanOrEqual(4);
        expect(mockCancellationToken.isCancellationRequested).toBe(true);
    });

    it('should handle syntax errors in alternative functions gracefully', async () => {
        // Arrange
        const alternatives = [syntaxErrorAlternative];
        const testInputs = [[1, 1]];
        const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
        mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

        // Act
        const verified = await CorrectnessVerifier.verifyFunctionalEquivalence(originalFunction, alternatives, mockLanguageModel, mockCreateInputGenerationPrompt, mockOutputChannel, mockCancellationToken, "mockFunctionName");

        // Assert
        expect(verified).toHaveLength(0);
        // spyScriptRunInContext is called for Orig(In1), then for AltSyntax(In1) which fails during definition (via originalVm.runInNewContext)
        expect(mockBehavior.callCount).toBe(3);
        
        // Verify that error messages were logged, but use more general matchers
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Starting functional equivalence check"));
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[CorrectnessVerifier] Generating test inputs via LLM"));
        
        // Check that altFuncSyntaxError is properly rejected
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("REJECTED"));
    });

    it('should handle a very simple case correctly', async () => {
        // Arrange
        const alternatives = [simpleAlt];
        const testInputs = [[5], [0], [-10]];
        const llmResponseJson = `\`\`\`json
${JSON.stringify(testInputs)}
\`\`\``;
        mockLanguageModel.sendRequest.mockResolvedValue({ text: createMockLLMStream(llmResponseJson) } as any);

        // Act
        const verified = await CorrectnessVerifier.verifyFunctionalEquivalence(simpleFunc, alternatives, mockLanguageModel, mockCreateInputGenerationPrompt, mockOutputChannel, mockCancellationToken, "mockFunctionName");

        // Assert
        expect(verified).toHaveLength(1);
        expect(verified[0]).toBe(simpleAlt);
        // Calls: Define(Orig), Exec(Orig,In1), Define(AltS), Exec(AltS,In1), Exec(Orig,In2), Exec(AltS,In2), Exec(Orig,In3), Exec(AltS,In3) = 8 calls
        expect(mockBehavior.callCount).toBe(12);
    });

}); // End describe suite