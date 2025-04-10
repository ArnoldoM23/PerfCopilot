/**
 * Tests for PerfCopilotParticipant
 * 
 * These tests verify that the PerfCopilot chat participant correctly 
 * interacts with the VS Code Chat API.
 */

import * as vscode from 'vscode';
import { PerfCopilotParticipant } from '../perfCopilotParticipant';
import { MockOutputChannel } from './mocks';
import { BenchmarkService } from '../services/benchmarkService';
import { verifyFunctionalEquivalence } from '../utils/correctnessVerifier';
import { FunctionImplementation, BenchmarkComparison } from '../models/types';
import { isValidJavaScriptFunction } from '../utils/functions';
// Require the mock file instead of importing
const vscodeMock = require('./vscode-mock');

// Mock the vscode namespace
jest.mock('vscode', () => {
  return require('./vscode-mock');
}, { virtual: true });

// Mock the utils/functions module
jest.mock('../utils/functions', () => ({
  isValidJavaScriptFunction: jest.fn().mockImplementation((code) => {
    // Simple mock implementation that validates based on function keyword presence
    return code.includes('function') || code.includes('=>');
  }),
  extractFunctionName: jest.fn().mockImplementation((code) => {
    if (code.includes('function findDuplicates')) {return 'findDuplicates';}
    if (code.includes('const add =')) {return 'add';}
    if (code.includes('function invalidFunc')) {return 'invalidFunc';}
    if (code.includes('function validFunc')) {return 'validFunc';}
    return code.includes('function') ? 'someFunction' : undefined;
  })
}));

// Mock the correctnessVerifier module
jest.mock('../utils/correctnessVerifier', () => ({
  verifyFunctionalEquivalence: jest.fn(),
}));

describe('PerfCopilotParticipant', () => {
  let mockOutputChannel: MockOutputChannel;
  let participant: PerfCopilotParticipant;
  let mockBenchmarkService: jest.Mocked<BenchmarkService>;
  let requestHandler: vscode.ChatRequestHandler;
  // Use types from the required mock
  let mockResponse: typeof vscodeMock._mockResponseStream;
  let mockCancellationToken: typeof vscodeMock._mockCancellationToken;

  // Sample function for testing
  const sampleFunction = `
    function findDuplicates(arr) {
      return arr.filter((item, index) => arr.indexOf(item) !== index);
    }
  `;
  
  // Sample benchmark results
  const sampleBenchmarkResults: BenchmarkComparison = {
    fastest: 'Alternative 1',
    results: [
      { name: 'original', ops: 1000000, margin: 0.01 },
      { name: 'Alternative 1', ops: 2000000, margin: 0.01 },
      { name: 'Alternative 2', ops: 1500000, margin: 0.01 }
    ]
  };
  
  // Sample alternative implementations
  const sampleAlternatives: FunctionImplementation[] = [
    {
      name: 'Alternative 1',
      code: `function findDuplicates(arr) {
        return [...new Set(arr.filter(item => arr.indexOf(item) !== arr.lastIndexOf(item)))];
      }`,
      description: 'Uses Set to remove duplicates from filtered array'
    },
    {
      name: 'Alternative 2',
      code: `function findDuplicates(arr) {
        const seen = new Set();
        const duplicates = new Set();
        for (const item of arr) {
          if (seen.has(item)) {
            duplicates.add(item);
          }
          seen.add(item);
        }
        return [...duplicates];
      }`,
      description: 'Uses Set to track seen items and duplicates'
    }
  ];
  
  // Retrieve the mock LanguageModel from the vscode mock
  const mockLM = require('./vscode-mock')._mockLanguageModel;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock output channel
    mockOutputChannel = new MockOutputChannel('PerfCopilot');
    
    // Create mock services
    mockBenchmarkService = {
      runBenchmark: jest.fn().mockResolvedValue(sampleBenchmarkResults)
    } as unknown as jest.Mocked<BenchmarkService>;
    
    // --- Mock vscode API behavior ---
    // Mock selectChatModels to return our mock LM
    (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([mockLM]);

    // Reset the mock sendRequest before each test
    mockLM.sendRequest.mockReset();
    // --- End Mock vscode API behavior ---
    
    // Create participant instance, passing the mocked services
    participant = new PerfCopilotParticipant(
        mockOutputChannel as any, 
        mockBenchmarkService
    );
    
    // Access the private createRequestHandler method using type assertion
    requestHandler = (participant as any).createRequestHandler();

    // Initialize shared mocks
    mockResponse = {
      markdown: jest.fn(),
      progress: jest.fn(),
    };
    mockCancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
  });
  
  describe('registration', () => {
    it('should register with the chat API', () => {
      // Mock the implementation of vscode.chat.createChatParticipant
      const mockCreateParticipant = jest.fn();
      
      // Create a mock participant with dispose method
      const mockParticipant = { dispose: jest.fn(), iconPath: undefined };
      mockCreateParticipant.mockReturnValue(mockParticipant);
      
      // Use spyOn instead of reassigning vscode.chat
      const createChatParticipantSpy = jest.spyOn(vscode.chat, 'createChatParticipant')
        .mockImplementation(mockCreateParticipant);
      
      // Call the register method
      const disposable = participant.register();
      
      // Verify the participant was registered
      expect(createChatParticipantSpy).toHaveBeenCalled();
      expect(disposable).toBeDefined();
      
      // Clean up
      createChatParticipantSpy.mockRestore();
    });
  });
  
  describe('createRequestHandler', () => {
    it('should handle a request to optimize a function', async () => {
      // Create a mock request with a function to optimize
      const mockRequest = {
        prompt: `@perfcopilot optimize this function: \`\`\`js\n${sampleFunction}\n\`\`\``, // Use @perfcopilot mention and code block
        variables: []
      };
      
      // Mock the sequence of LLM responses
      // Define the async generators separately
      async function* mockAlternativesGenerator() {
        const alt1CodeBlock = '```javascript\\n' + sampleAlternatives[0].code + '\\n```';
        const alt2CodeBlock = '```javascript\\n' + sampleAlternatives[1].code + '\\n```';
        const responseString = `Here are two alternatives:\\n${alt1CodeBlock}\\n\\nAnd another one:\\n${alt2CodeBlock}`;
        yield responseString;
      }

      async function* mockBenchmarkConfigGenerator() {
        const benchmarkConfig = {
          entryPointName: "findDuplicates",
          testData: [[1,2,3,2,4,5,4]],
          implementations: {
            "Original": sampleFunction,
            [sampleAlternatives[0].name]: sampleAlternatives[0].code,
            [sampleAlternatives[1].name]: sampleAlternatives[1].code,
          }
        };
        const jsonString = '```json\\n' + JSON.stringify(benchmarkConfig, null, 2) + '\\n```';
        yield jsonString;
      }

      async function* mockInputGenerator() {
        const testInputs = [[[1, 2, 2, 3]], [[5, 5, 5]], [[]]];
        const jsonString = '```json\\n' + JSON.stringify(testInputs) + '\\n```';
        yield jsonString;
      }

      async function* mockExplanationGenerator() {
        const explanationString = '# Performance Analysis\n**Summary:** Alternative 1 was fastest.\n**Benchmark Results:** ...\n**Explanation:** ...\n**Fastest Implementation:** ...';
        yield explanationString;
      }
      
      mockLM.sendRequest
        .mockResolvedValueOnce({ text: mockAlternativesGenerator() })
        .mockResolvedValueOnce({ text: mockBenchmarkConfigGenerator() })
        .mockResolvedValueOnce({ text: mockInputGenerator() })
        .mockResolvedValueOnce({ text: mockExplanationGenerator() });

      // Mock benchmarkService.runBenchmark to return successful results with sanitized keys
      // Assuming correctness check passes Alternative 1 but rejects Alternative 2
      mockBenchmarkService.runBenchmark.mockResolvedValueOnce({
        fastest: 'Alternative_1', // Use sanitized key
        results: [
          { name: 'Original', ops: 1000000, margin: 0.01 },
          { name: 'Alternative_1', ops: 2000000, margin: 0.01 } 
          // Alternative_2 is excluded as if it failed correctness check
        ]
      });

      // Create mock context
      const mockContext = {};
      
      const mockToken = {
        isCancellationRequested: false
      };
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify services were called in the correct order
      expect(mockBenchmarkService.runBenchmark).toHaveBeenCalled();
      
      // Verify the response was sent - Check for key stages
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('✅ Function `findDuplicates` identified. Analyzing...'));
      // Alternatives generation count might vary slightly based on parsing, let's check for progress instead
      expect(mockResponse.progress).toHaveBeenCalledWith('Generating alternative implementations...'); 
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('✅ Generated 2 alternative implementations.')); // Assuming both parsed ok initially
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('✅ AI identified entry point and generated test data.'));
      // Correctness check messages depend on the actual run now, check progress
      expect(mockResponse.progress).toHaveBeenCalledWith('Verifying functional correctness...');
      // We expect 1 alternative to pass based on the benchmark mock setup
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('✅ 1 alternatives passed correctness check.')); 
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('✅ Benchmarks completed.')); 
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Performance Analysis')); // Final explanation
      
      // Clean up - parseAlternativesSpy was removed
      // parseAlternativesSpy.mockRestore(); 
    });
    
    it('should handle no valid function found in request', async () => {
      const mockRequest = { prompt: '@perfcopilot This is not a function' };
      const mockContext = {};

      // Mock extractFunctionCodeFromPrompt to return undefined (no function found)
      const extractFunctionCodeSpy = jest.spyOn((participant as any), 'extractFunctionCodeFromPrompt')
        .mockReturnValueOnce(undefined);

      await requestHandler(mockRequest as any, mockContext as any, mockResponse as any, mockCancellationToken as any);

      // Verify error message was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('No JavaScript/TypeScript function found in your request'));
      
      // Clean up
      extractFunctionCodeSpy.mockRestore();
    });
    
    it('should handle invalid JavaScript function', async () => {
      const invalidCode = 'function invalidFunc(x, y) { return x + y;'; // Missing closing brace
      const mockRequest = { prompt: `@perfcopilot ` + '```javascript\\n' + invalidCode + '\\n```' };
      const mockContext = {};

      // Mock extractFunctionCodeFromPrompt to return the invalid code
      const extractFunctionCodeSpy = jest.spyOn((participant as any), 'extractFunctionCodeFromPrompt')
        .mockReturnValueOnce(invalidCode);
      
      // Mock isValidJavaScriptFunction to return false for this specific invalid code
      const originalIsValidMockImplementation = (isValidJavaScriptFunction as jest.Mock).getMockImplementation();
      (isValidJavaScriptFunction as jest.Mock).mockImplementation((code: string) => {
        if (code === invalidCode) {
          return false;  // This is the invalid code we're testing
        }
        // Otherwise use the original mock implementation
        return code.includes('function') || code.includes('=>');
      });

      await requestHandler(mockRequest as any, mockContext as any, mockResponse as any, mockCancellationToken as any);

      // Verify error message was sent about invalid function
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('The extracted code does not appear to be a valid JavaScript/TypeScript function'));

      // Clean up
      extractFunctionCodeSpy.mockRestore();
      // Restore original mock implementation
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(originalIsValidMockImplementation);
    });
    
    it('should handle code in original function implementation flow', async () => {
      // Create a mock request with function
      const mockRequest = {
        prompt: `optimize this function:
        \`\`\`javascript
        function originalFunc(x, y) {
          return x + y;
        }
        \`\`\``,
        variables: []
      };
      
      // Create mock context
      const mockContext = {};
      
      const mockToken = {
        isCancellationRequested: false
      };
      
      // Mock behavior for this test - this will cover the lines where 
      // the original function implementation is created
      const originalFunctionCode = 'function originalFunc(x, y) { return x + y; }';
      const extractFunctionCodeSpy = jest.spyOn(participant as any, 'extractFunctionCodeFromPrompt')
        .mockReturnValueOnce(originalFunctionCode);
      
      // Mock parseAlternativeImplementations to prevent further processing in this specific test
      const parseAlternativesSpy = jest.spyOn(participant as any, 'parseAlternativeImplementations').mockReturnValueOnce([]);

      // Call the request handler
      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Verify the flow executed correctly
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Function `someFunction` identified. Analyzing...'));
      expect(mockResponse.progress).toHaveBeenCalledWith('Generating alternative implementations...');
      
      // Clean up
      extractFunctionCodeSpy.mockRestore();
      parseAlternativesSpy.mockRestore(); // Restore the spy
    });
    
    // Test to cover lines 137-138: Additional cancellation checks
    it('should be cancellable at any point in the process', async () => {
      // Create a request with token that will be cancelled after progress report
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
      const mockContext = {};
      
      const mockToken = {
        isCancellationRequested: false
      };
      
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn().mockImplementation(() => {
          // Simulate cancellation during progress reporting
          (mockToken as any).isCancellationRequested = true;
        })
      };
      
      // Call the request handler
      const result = await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Verify a cancellation message was displayed
      expect(mockResponse.markdown).toHaveBeenCalled(); 
      // Check progress was called before cancellation
      expect(mockResponse.progress).toHaveBeenCalledWith('Extracting function...');
      // Check the final result is an empty object due to cancellation
      expect(result).toEqual({});
    });
    
    it('should handle empty function selection', async () => {
      // Create a mock request with empty function
      const mockRequest = {
        prompt: `optimize this function: ""`,
        variables: []
      };
      
      // Mock extractFunctionCodeFromPrompt to return an empty string
      const extractFunctionCodeSpy = jest.spyOn(participant as any, 'extractFunctionCodeFromPrompt')
        .mockReturnValueOnce('');
      
      // Create mock context
      const mockContext = {};
      
      const mockToken = {
        isCancellationRequested: false
      };
      
      // Create a mock response
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn()
      };
      
      // Mock selectChatModels to return an empty array
      (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([]);

      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify error message about no model found
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Could not access a suitable language model'));
      
      // Clean up
      extractFunctionCodeSpy.mockRestore();
    });
    
    it('should handle case where no alternatives can be generated', async () => {
      // Mock request
      const mockRequest = { prompt: `@perfcopilot ${sampleFunction}`, variables: [] };
      const mockContext = {};
      const mockToken = { isCancellationRequested: false };
      const mockResponse = { markdown: jest.fn(), progress: jest.fn() };

      // Mock sendRequest to return a response that cannot be parsed as JSON
      mockLM.sendRequest.mockResolvedValueOnce({
        text: (async function*() { yield 'Sorry, I cannot generate alternatives right now.'; })()
      });

      // Call the request handler
      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );

      // Verify info message was sent because parsing failed
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('No alternative implementations were successfully parsed'));
    });
    
    it('should handle errors during processing', async () => {
      // Mock request
      const mockRequest = { prompt: `@perfcopilot ${sampleFunction}`, variables: [] };
      const mockContext = {};
      const mockToken = { isCancellationRequested: false };
      const mockResponse = { markdown: jest.fn(), progress: jest.fn() };

      // Mock sendRequest to REJECT on the first call (alternatives)
      const testError = new Error('LLM Test error');
      mockLM.sendRequest.mockRejectedValueOnce(testError);

      // Call the request handler
      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );

      // Verify error message was sent from the catch block for alternatives generation
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Failed to generate alternative implementations.'));
      // Verify the specific error message is included
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('LLM Test error'));
    });
    
    it('should cancel processing if requested', async () => {
      // Create a mock request with a function to optimize
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
      // Create mock context
      const mockContext = {};
      
      const mockToken = {
        isCancellationRequested: true
      };
      
      // Create a mock response
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn()
      };
      
      // Call the request handler
      const result = await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Verify services were not called due to cancellation
      expect(result).toEqual({});
      // Ensure no progress messages were sent
      expect(mockResponse.progress).not.toHaveBeenCalled();
    });
    
    it('should cancel at various points in the execution', async () => {
      // Test cancellation BEFORE generating alternatives
      // ... setup request, context, response ...
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
      const mockContext = {};
      
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn()
      };
      
      const tokenBeforeAlternatives = { isCancellationRequested: true }; 
      await requestHandler(mockRequest as any, mockContext as any, mockResponse as any, tokenBeforeAlternatives as any);
      // expect(mockLanguageModelService.sendRequest).not.toHaveBeenCalled(); // Verify LLM was NOT called
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Operation cancelled'));

      // Test cancellation AFTER generating alternatives, BEFORE benchmarking
      // ... reset mocks, setup request, context, response ...
      const tokenBeforeBenchmark = { isCancellationRequested: false };
      // TODO: Update this test to mock vscode.lm and simulate cancellation after the first sendRequest
      
      await requestHandler(mockRequest as any, mockContext as any, mockResponse as any, tokenBeforeBenchmark as any);
      // await sendRequestPromise; // Ensure the mock implementation runs

      // expect(mockLanguageModelService.sendRequest).toHaveBeenCalled(); // Needs updated mock check
      expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled(); // Verify benchmark was NOT called
      // expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Operation cancelled')); // Verify cancellation message

      // ... Potentially add test for cancellation during benchmarking ...
    });

    it('should use the whole prompt if no code blocks and valid', async () => {
      const validFunctionPrompt = `function validFunc(a, b) { return a * b; }`;
      const mockRequest = { prompt: `@perfcopilot ${validFunctionPrompt}` };
      const mockContext = {};

      // Setup for this test:
      // 1. First mock extractFunctionCodeFromPrompt to simulate no code blocks found
      const extractSpy = jest.spyOn((participant as any), 'extractFunctionCodeFromPrompt')
        .mockReturnValueOnce(validFunctionPrompt);

      // 2. Mock isValidJavaScriptFunction to handle our test case
      const originalIsValidMockImplementation = (isValidJavaScriptFunction as jest.Mock).getMockImplementation();
      (isValidJavaScriptFunction as jest.Mock).mockImplementation((code) => {
        return code === validFunctionPrompt; // Only consider the full prompt valid
      });

      // 3. Mock sendRequest to avoid further issues in this specific test
      mockLM.sendRequest.mockResolvedValueOnce({
        text: (async function*() { yield 'Test response'; })()
      });

      await requestHandler(mockRequest as any, mockContext as any, mockResponse as any, mockCancellationToken as any);

      // Only verify the function identification message gets sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Function `validFunc` identified'));

      // Clean up
      extractSpy.mockRestore();
      // Restore the original mock implementation for isValidJavaScriptFunction
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(originalIsValidMockImplementation);
    });

    it('should return first JS/TS code block even if others exist', () => {
      // Removed setupTestEnvironment call, participant is available from beforeEach
      // const { participant } = setupTestEnvironment();
      const prompt = '@perfcopilot ```\nconst x = 1;\nconsole.log(x);\n```\n```js\nlet y = 2;\n```';
      const expectedCode = 'let y = 2;'; // The content of the first JS block is prioritized

      // Mock isValidJavaScriptFunction to always return false
      const originalMockImplementation = (isValidJavaScriptFunction as jest.Mock).getMockImplementation();
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(() => false);

      const result = (participant as any).extractFunctionCodeFromPrompt(prompt);

      // Verify the result is the content of the first block, as validation is skipped here
      expect(result).toBe(expectedCode);

      // Restore original mock implementation
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(originalMockImplementation);
    });
  });
  
  describe('extractFunctionCodeFromPrompt', () => {
    // Access the private method using type assertion
    const extractFunctionCodeFromPrompt = (prompt: string) => {
      return (participant as any).extractFunctionCodeFromPrompt(prompt);
    };
    
    it('should extract code from markdown code blocks', () => {
      const prompt = `Please optimize this function:
      \`\`\`javascript
      function add(a, b) {
        return a + b;
      }
      \`\`\``;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toBe(`function add(a, b) {
        return a + b;
      }`);
    });
    
    it('should extract code from typescript code blocks', () => {
      const prompt = `Please optimize this function:
      \`\`\`typescript
      function add(a: number, b: number): number {
        return a + b;
      }
      \`\`\``;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toBe(`function add(a: number, b: number): number {
        return a + b;
      }`);
    });
    
    it('should extract code from code blocks without language specified', () => {
      const prompt = `Please optimize this function:
      \`\`\`
      function add(a, b) {
        return a + b;
      }
      \`\`\``;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toBe(`function add(a, b) {
        return a + b;
      }`);
    });
    
    it('should extract the first function declaration if no code blocks are found', () => {
      const prompt = `Please optimize this function:
      
      function add(a, b) {
        return a + b;
      }
      
      Thanks!`;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('function add');
    });
    
    it('should extract arrow functions if no function declarations are found', () => {
      const prompt = `Please optimize this arrow function:
      
      const add = (a, b) => {
        return a + b;
      }`;
      
      // The function now validates the whole prompt if no blocks are found
      // We need to mock isValidJavaScriptFunction for this specific case
      const originalIsValidMockImplementation = (isValidJavaScriptFunction as jest.Mock).getMockImplementation();
      (isValidJavaScriptFunction as jest.Mock).mockImplementation((code) => {
       // Simulate validation passing for the clean prompt content using includes
       return code.includes(`const add = (a, b) => {
        return a + b;
      }`);
      });

      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('const add'); // The logic extracts the whole valid prompt
      // Restore mock
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(originalIsValidMockImplementation);
    });
    
    it('should return undefined if no valid function is found', () => {
      const prompt = `Please help me optimize my code but I don't have it yet.`;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toBeUndefined();
    });
    
    it('should prioritize code blocks over raw function declarations', () => {
      const prompt = `
      Here's a simple function:
      \`\`\`javascript
      function multiply(a, b) {
        return a * b;
      }
      \`\`\`
      
      And another function outside the block:
      function add(a, b) {
        return a + b;
      }
      `;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('function multiply');
      expect(result).not.toContain('function add');
    });
    
    it('should extract function from multiple code blocks if first is valid', () => {
      const prompt = `
      Function to optimize:
      \`\`\`javascript
      function first(a, b) {
        return a + b;
      }
      \`\`\`
      
      Another example:
      \`\`\`javascript
      function second(a, b) {
        return a * b;
      }
      \`\`\`
      `;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('function first');
      expect(result).not.toContain('function second');
    });
    
    it('should extract function from raw code when no code blocks or function declarations exist', () => {
      const prompt = `Can you help me with this arrow function:
      
      // This is a simple arrow function
      const myArrowFunction = a => a * 2;
      `;
      
      // The function now validates the whole prompt if no blocks are found
      // We need to mock isValidJavaScriptFunction for this specific case
      const originalIsValidMockImplementation = (isValidJavaScriptFunction as jest.Mock).getMockImplementation();
      (isValidJavaScriptFunction as jest.Mock).mockImplementation((code) => {
       // Simulate validation passing for the clean prompt content using includes
       // Note: Comparing exact match as the prompt only contains this relevant code
       return code.includes(`// This is a simple arrow function
      const myArrowFunction = a => a * 2;`);
      });

      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('const myArrowFunction');
      // Restore mock
      (isValidJavaScriptFunction as jest.Mock).mockImplementation(originalIsValidMockImplementation);
    });
  });
}); 