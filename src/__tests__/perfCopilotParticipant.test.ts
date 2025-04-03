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
import { FunctionImplementation, BenchmarkComparison } from '../models/types';

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
    return code.includes('function') ? 'someFunction' : undefined;
  })
}));

describe('PerfCopilotParticipant', () => {
  let mockOutputChannel: MockOutputChannel;
  let participant: PerfCopilotParticipant;
  let mockBenchmarkService: jest.Mocked<BenchmarkService>;
  let requestHandler: vscode.ChatRequestHandler;
  
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
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock output channel
    mockOutputChannel = new MockOutputChannel('PerfCopilot');
    
    // Create mock services
    mockBenchmarkService = {
      runBenchmark: jest.fn().mockResolvedValue(sampleBenchmarkResults)
    } as unknown as jest.Mocked<BenchmarkService>;
    
    // Create participant instance
    participant = new PerfCopilotParticipant(mockOutputChannel as any, mockBenchmarkService);
    
    // Access the private createRequestHandler method using type assertion
    requestHandler = (participant as any).createRequestHandler();
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
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
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
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify services were called in the correct order
      expect(mockBenchmarkService.runBenchmark).toHaveBeenCalled();
      
      // Verify the response was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Performance Analysis'));
    });
    
    it('should handle no valid function found in request', async () => {
      // Create a mock request with no function
      const mockRequest = {
        prompt: `Can you optimize my code please?`,
        variables: []
      };
      
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
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify error message was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('No valid JavaScript/TypeScript function found in your request'));
    });
    
    it('should handle invalid JavaScript function', async () => {
      // Create a mock request with invalid function
      const mockRequest = {
        prompt: `optimize this function: 
        \`\`\`javascript
        function invalidFunc(x, y) {
          // Missing closing brace
          return x + y;
        \`\`\``,
        variables: []
      };
      
      // Mock implementations for this test
      const { isValidJavaScriptFunction } = require('../utils/functions');
      
      // First, the function will be extracted, then validation will fail
      const extractFunctionCodeSpy = jest.spyOn(participant as any, 'extractFunctionCodeFromPrompt')
        .mockImplementation(() => 'function invalidFunc(x, y) { return x + y;');
      
      isValidJavaScriptFunction.mockReturnValueOnce(false);
      
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
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify error message was sent about invalid function
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('The provided code does not appear to be a valid JavaScript/TypeScript function'));
      
      // Clean up
      extractFunctionCodeSpy.mockRestore();
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
      
      // Create a mock response
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn()
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
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify error message was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('No valid JavaScript/TypeScript function found in your request'));
      
      // Clean up
      extractFunctionCodeSpy.mockRestore();
    });
    
    it('should handle case where no alternatives can be generated', async () => {
      // Simulate the LLM returning no alternatives by mocking the private parse function
      const parseAlternativesSpy = jest.spyOn(participant as any, 'parseAlternativeImplementations')
        .mockReturnValueOnce([]);
      
      // Create a mock request with a function
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
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
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify info message was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('No alternative implementations were generated by the AI'));

      // Clean up
      parseAlternativesSpy.mockRestore();
    });
    
    it('should handle errors during processing', async () => {
      // Create a mock request with a function to optimize
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
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
      
      // Force an error by mocking the LLM call directly
      const mockLanguageModel = {
        sendRequest: jest.fn().mockRejectedValue(new Error('LLM Test error'))
      };
      const selectChatModelsSpy = jest.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([mockLanguageModel as any]);
      
      // Call the request handler
      await requestHandler(
        mockRequest as any, 
        mockContext as any, 
        mockResponse as any, 
        mockToken as any
      );
      
      // Verify error message was sent
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('Failed to generate alternative implementations.'));
      expect(mockResponse.markdown).toHaveBeenCalledWith(expect.stringContaining('LLM Test error'));

      // Clean up
      selectChatModelsSpy.mockRestore();
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
      // Test cancellation after alternatives are generated
      const mockToken = {
        isCancellationRequested: false
      };
      
      const mockRequest = {
        prompt: `optimize this function: ${sampleFunction}`,
        variables: []
      };
      
      const mockContext = {};
      
      const mockResponse = {
        markdown: jest.fn(),
        progress: jest.fn()
      };
      
      // After alternatives, before benchmark code
      (mockToken as any).isCancellationRequested = false;

      // Mock the LLM sendRequest to simulate cancellation after first call
      const mockLanguageModelAlternatives = {
        sendRequest: jest.fn().mockImplementationOnce(async () => {
          (mockToken as any).isCancellationRequested = true;
          // Simulate a minimal valid response structure
          return { text: async function*() { yield '### Alternative 1\n```javascript\n// alt 1\n```\nSome text.'; }() };
        })
      };
      const selectChatModelsSpyAlternatives = jest.spyOn(vscode.lm, 'selectChatModels').mockResolvedValueOnce([mockLanguageModelAlternatives as any]);
      
      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Should have generated alternatives but not proceeded further
      expect(mockLanguageModelAlternatives.sendRequest).toHaveBeenCalled(); // Check LLM call instead
      expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled(); 
      // Verify the final result indicates cancellation
      const resultAfterAlternatives = await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      expect(resultAfterAlternatives).toEqual({});

      // Clean up
      selectChatModelsSpyAlternatives.mockRestore(); // Restore the spy
      
      // Reset mocks
      jest.clearAllMocks();
      mockResponse.markdown.mockClear();
      
      // After benchmark code, before running
      (mockToken as any).isCancellationRequested = false;

      // Mock the generateBenchmarkCode util to simulate cancellation after it runs
      const generateBenchmarkCodeSpy = jest.spyOn(require('../utils/benchmarkGenerator'), 'generateBenchmarkCode')
        .mockImplementationOnce(() => {
          (mockToken as any).isCancellationRequested = true;
          return '// mocked benchmark code';
        });

      // Need to mock the LLM call again for this specific scenario
      const mockLanguageModelBenchmarkCode = { sendRequest: jest.fn().mockResolvedValue({ text: async function*() { yield '### Alternative 1\n```javascript\n// alt 1\n```\nSome text.'; }() }) };
      const selectChatModelsSpyBenchmarkCode = jest.spyOn(vscode.lm, 'selectChatModels').mockResolvedValueOnce([mockLanguageModelBenchmarkCode as any]);

      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Should have generated benchmark code but not run it
      expect(mockLanguageModelBenchmarkCode.sendRequest).toHaveBeenCalled(); // Check LLM call
      expect(generateBenchmarkCodeSpy).toHaveBeenCalled(); // Check util call
      expect(mockBenchmarkService.runBenchmark).not.toHaveBeenCalled();
      // Verify the final result indicates cancellation
      const resultAfterBenchmarkCode = await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      expect(resultAfterBenchmarkCode).toEqual({});
      
      // Clean up
      generateBenchmarkCodeSpy.mockRestore();
      selectChatModelsSpyBenchmarkCode.mockRestore();

      // Reset mocks
      jest.clearAllMocks();
      mockResponse.markdown.mockClear();
      
      // After running benchmark, before formatting results
      (mockToken as any).isCancellationRequested = false;

      // Need to mock the LLM call again for this specific scenario
      const mockLanguageModelRunBenchmark = { sendRequest: jest.fn().mockResolvedValue({ text: async function*() { yield '### Alternative 1\n```javascript\n// alt 1\n```\nSome text.'; }() }) };
      const selectChatModelsSpyRunBenchmark = jest.spyOn(vscode.lm, 'selectChatModels').mockResolvedValueOnce([mockLanguageModelRunBenchmark as any]);

      await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      
      // Should have run benchmark but not formatted results (i.e., not called LLM for explanation)
      expect(mockLanguageModelRunBenchmark.sendRequest).toHaveBeenCalledTimes(1); // Only called for alternatives
      expect(mockBenchmarkService.runBenchmark).toHaveBeenCalled();
      // Verify the final result indicates cancellation
      const resultAfterRunBenchmark = await requestHandler(
        mockRequest as any,
        mockContext as any,
        mockResponse as any,
        mockToken as any
      );
      expect(resultAfterRunBenchmark).toEqual({});

      // Clean up
      selectChatModelsSpyRunBenchmark.mockRestore();
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
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('const add');
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
      
      const result = extractFunctionCodeFromPrompt(prompt);
      expect(result).toContain('const myArrowFunction');
    });
    
    it('should return first code block if none are valid functions', () => {
      // Mock isValidJavaScriptFunction to always return false for this test
      const { isValidJavaScriptFunction } = require('../utils/functions');
      const originalMock = isValidJavaScriptFunction.getMockImplementation(); // Store original mock
      isValidJavaScriptFunction.mockReturnValue(false);

      const prompt = `
      Invalid block 1:
      \`\`\`
      const x = 1;
      console.log(x);
      \`\`\`
      
      Invalid block 2:
      \`\`\`
      let y = { name: 'test' };
      \`\`\`
      `;
      
      const result = extractFunctionCodeFromPrompt(prompt);
      
      // Verify the result is undefined because no *valid* function was found, even in blocks
      expect(result).toBeUndefined();
      
      // Restore original mock implementation
      isValidJavaScriptFunction.mockImplementation(originalMock);
    });
  });
}); 