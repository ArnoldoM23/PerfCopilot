/**
 * Tests for CopilotChatService
 */

import { CopilotChatService } from '../services/copilotChatService';
import { FunctionImplementation } from '../models/types';

// Mock the VSCodeChatService
const mockSendChatMessage = jest.fn();
jest.mock('../services/vscodeChat', () => {
  return {
    VSCodeChatService: jest.fn().mockImplementation(() => {
      return {
        sendChatMessage: mockSendChatMessage
      };
    })
  };
});

// Mock vscode namespace
jest.mock('vscode', () => {
  return {
    window: {
      showErrorMessage: jest.fn().mockReturnValue(Promise.resolve('Open Extensions')),
      showInformationMessage: jest.fn().mockReturnValue(Promise.resolve('Ok')),
      showTextDocument: jest.fn().mockReturnValue(Promise.resolve())
    },
    commands: {
      executeCommand: jest.fn().mockReturnValue(Promise.resolve()),
      getCommands: jest.fn().mockReturnValue(Promise.resolve(['github.copilot.chat.focus']))
    },
    env: {
      clipboard: {
        writeText: jest.fn().mockReturnValue(Promise.resolve())
      }
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/test' } }],
      fs: {
        writeFile: jest.fn().mockReturnValue(Promise.resolve())
      },
      openTextDocument: jest.fn().mockReturnValue(Promise.resolve({}))
    },
    Uri: {
      joinPath: jest.fn().mockImplementation((uri, path) => ({ fsPath: `/mock/${path}` }))
    }
  };
});

describe('CopilotChatService', () => {
  let copilotChatService: CopilotChatService;
  let mockOutputChannel: any;
  const vscode = require('vscode');

  // Sample function for testing
  const sampleFunction = `function findDuplicates(array) {
  const duplicates = [];
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] === array[j] && !duplicates.includes(array[i])) {
        duplicates.push(array[i]);
      }
    }
  }
  return duplicates;
}`;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create output channel mock
    mockOutputChannel = {
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
      replace: jest.fn()
    };
    
    // Set the default response for the mockSendChatMessage
    mockSendChatMessage.mockResolvedValue('Test response');
    
    // Create the service instance
    copilotChatService = new CopilotChatService(mockOutputChannel);
  });

  describe('sendPrompt', () => {
    it('should send a prompt and return the response', async () => {
      // Send a prompt
      const response = await copilotChatService.sendPrompt('Test prompt');
      
      // Verify the response
      expect(response).toBe('Test response');
      
      // Verify the prompt was sent to VSCodeChatService
      expect(mockSendChatMessage).toHaveBeenCalledWith('Test prompt');
      
      // Verify logging occurred
      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
    });
    
    it('should log errors when sending a prompt fails', async () => {
      // Set up the mock to throw an error
      mockSendChatMessage.mockRejectedValue(new Error('Test error'));
      
      // Expect the method to throw
      await expect(copilotChatService.sendPrompt('Test prompt')).rejects.toThrow();
      
      // Verify error was logged
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Chat methods failed'));
    });
  });

  describe('getAlternativeImplementations', () => {
    it('should generate and parse alternative implementations', async () => {
      // Mock the API response with sample alternatives
      const mockResponse = `
Here are two alternative implementations for the findDuplicates function:

## Alternative 1

This approach uses a Set for O(n) time complexity:

\`\`\`javascript
function findDuplicates(array) {
  const seen = new Set();
  const duplicates = new Set();
  
  for (const item of array) {
    if (seen.has(item)) {
      duplicates.add(item);
    } else {
      seen.add(item);
    }
  }
  
  return Array.from(duplicates);
}
\`\`\`

Using Sets makes this much faster by avoiding the nested loop and the includes() operation.

## Alternative 2

This approach uses an object for tracking:

\`\`\`javascript
function findDuplicates(array) {
  const counts = {};
  const duplicates = [];
  
  for (const item of array) {
    counts[item] = (counts[item] || 0) + 1;
    if (counts[item] === 2) {
      duplicates.push(item);
    }
  }
  
  return duplicates;
}
\`\`\`

Using an object to track counts avoids the expensive includes() checks and is O(n).
`;

      mockSendChatMessage.mockResolvedValue(mockResponse);
      
      // Get alternative implementations
      const alternatives = await copilotChatService.getAlternativeImplementations(sampleFunction);
      
      // Verify the prompt was sent with the correct format
      expect(mockSendChatMessage).toHaveBeenCalledWith(
        expect.stringContaining(sampleFunction)
      );
      
      // Verify the alternatives were parsed correctly
      expect(alternatives).toHaveLength(2);
      expect(alternatives[0].name).toBe('Alternative 1');
      expect(alternatives[0].code).toContain('function findDuplicates(array)');
      expect(alternatives[0].code).toContain('const seen = new Set()');
      expect(alternatives[1].name).toBe('Alternative 2');
      expect(alternatives[1].code).toContain('function findDuplicates(array)');
      expect(alternatives[1].code).toContain('const counts = {}');
    });

    it('should handle empty or invalid responses', async () => {
      // Mock an empty response
      mockSendChatMessage.mockResolvedValue('No implementations found');
      
      // Get alternative implementations
      const alternatives = await copilotChatService.getAlternativeImplementations(sampleFunction);
      
      // Verify an empty array is returned
      expect(alternatives).toHaveLength(0);
    });
    
    it('should properly handle error cases', async () => {
      // Mock API to throw error
      mockSendChatMessage.mockRejectedValue(new Error('API error'));
      
      // Test that the method throws appropriately
      await expect(copilotChatService.getAlternativeImplementations(sampleFunction))
        .rejects.toThrow('Failed to get alternatives');
      
      // Verify error was logged
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error getting alternative implementations'));
    });
  });

  describe('getBenchmarkCode', () => {
    it('should generate benchmark code for comparing implementations', async () => {
      // Sample functions for testing
      const originalFunction: FunctionImplementation = {
        name: 'original',
        code: sampleFunction
      };
      
      const alternativeImplementations: FunctionImplementation[] = [
        {
          name: 'Alternative 1',
          code: `function findDuplicates(array) {
  const seen = new Set();
  const duplicates = new Set();
  
  for (const item of array) {
    if (seen.has(item)) {
      duplicates.add(item);
    } else {
      seen.add(item);
    }
  }
  
  return Array.from(duplicates);
}`,
          description: 'Uses Sets for faster lookups'
        }
      ];
      
      // Get the benchmark code
      const benchmarkCode = await copilotChatService.getBenchmarkCode(
        originalFunction, 
        alternativeImplementations
      );
      
      // Verify the benchmark code contains key elements
      expect(benchmarkCode).toContain('const benny = require(\'benny\')');
      expect(benchmarkCode).toContain('benny.suite');
      expect(benchmarkCode).toMatch(/findDuplicates\s*\(\s*testData\s*\)/);
      expect(benchmarkCode).toContain('benny.cycle()');
      expect(benchmarkCode).toContain('benny.complete');
    });
    
    it('should log the generation process', async () => {
      const originalFunction: FunctionImplementation = {
        name: 'original',
        code: sampleFunction
      };
      
      const alternativeImplementations: FunctionImplementation[] = [
        {
          name: 'Alternative 1',
          code: 'function findDuplicates(array) { return []; }'
        }
      ];
      
      await copilotChatService.getBenchmarkCode(
        originalFunction, 
        alternativeImplementations
      );
      
      // Verify logging occurred
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Generating benchmark code with Benny.js...');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Generated'));
    });
  });

  describe('displayResults', () => {
    it('should attempt to display results in GitHub Copilot Chat', async () => {
      // Set up vscode.commands.getCommands to return a list with the chat command
      vscode.commands.getCommands.mockResolvedValue(['github.copilot.chat.focus']);
      
      const success = await copilotChatService.displayResults('Test results');
      
      // Verify command was executed and clipboard was used
      expect(vscode.commands.getCommands).toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('github.copilot.chat.focus');
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('Test results');
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
      expect(success).toBe(true);
    });
    
    it('should fall back to creating a temporary file when chat display fails', async () => {
      // Set up vscode.commands.getCommands to return an empty list (no chat commands)
      vscode.commands.getCommands.mockResolvedValue([]);
      
      const success = await copilotChatService.displayResults('Test results');
      
      // Verify fallback method was used
      expect(vscode.commands.getCommands).toHaveBeenCalled();
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
      expect(success).toBe(true);
    });
    
    it('should handle case where creating temporary file fails', async () => {
      // Set up vscode.commands.getCommands to return an empty list (no chat commands)
      vscode.commands.getCommands.mockResolvedValue([]);
      
      // Set up workspace folders to be null
      const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
      vscode.workspace.workspaceFolders = null;
      
      const success = await copilotChatService.displayResults('Test results');
      
      // Restore original value
      vscode.workspace.workspaceFolders = originalWorkspaceFolders;
      
      // Verify error was logged and method returns false
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error displaying results'));
      expect(success).toBe(false);
    });
  });

  describe('formatResultsAsMarkdown', () => {
    it('should format benchmark results as markdown', async () => {
      // Sample functions for testing
      const originalFunction: FunctionImplementation = {
        name: 'original',
        code: sampleFunction
      };
      
      const alternativeImplementations: FunctionImplementation[] = [
        {
          name: 'Alternative 1',
          code: `function findDuplicates(array) {
  const seen = new Set();
  const duplicates = new Set();
  
  for (const item of array) {
    if (seen.has(item)) {
      duplicates.add(item);
    } else {
      seen.add(item);
    }
  }
  
  return Array.from(duplicates);
}`,
          description: 'Uses Sets for faster lookups'
        }
      ];
      
      // Create sample benchmark results
      const benchmarkResults = {
        fastest: 'Alternative 1',
        results: [
          { name: 'Alternative 1', ops: 15000, margin: 0.01 },
          { name: 'original', ops: 500, margin: 0.02 }
        ]
      };
      
      // Format the results
      const markdown = copilotChatService.formatResultsAsMarkdown(
        originalFunction,
        alternativeImplementations,
        benchmarkResults
      );
      
      // Verify the markdown output
      expect(markdown).toContain('# 🚀 PerfCopilot Performance Analysis Results');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('✅ The **Alternative 1** implementation is the fastest');
      expect(markdown).toContain('| Implementation | Operations/sec | Improvement |');
      expect(markdown).toContain('Alternative 1');
      expect(markdown).toContain('original');
      expect(markdown).toContain('## Function Implementations');
      expect(markdown).toContain('## Recommendation');
    });
    
    it('should handle the case where the original implementation is fastest', async () => {
      // Sample functions for testing
      const originalFunction: FunctionImplementation = {
        name: 'original',
        code: sampleFunction
      };
      
      const alternativeImplementations: FunctionImplementation[] = [
        {
          name: 'Alternative 1',
          code: `function findDuplicates(array) { /* slower implementation */ }`
        }
      ];
      
      // Create sample benchmark results with original as fastest
      const benchmarkResults = {
        fastest: 'original',
        results: [
          { name: 'original', ops: 1500, margin: 0.01 },
          { name: 'Alternative 1', ops: 1000, margin: 0.02 }
        ]
      };
      
      // Format the results
      const markdown = copilotChatService.formatResultsAsMarkdown(
        originalFunction,
        alternativeImplementations,
        benchmarkResults
      );
      
      // Verify the markdown indicates the original is fastest
      expect(markdown).toContain('✅ The original implementation is already the fastest version tested');
    });
    
    it('should handle missing or empty results', async () => {
      // Sample functions for testing
      const originalFunction: FunctionImplementation = {
        name: 'original',
        code: sampleFunction
      };
      
      const alternativeImplementations: FunctionImplementation[] = [
        {
          name: 'Alternative 1',
          code: 'function findDuplicates(array) { return []; }'
        }
      ];
      
      // Create empty benchmark results
      const benchmarkResults = {
        fastest: '',
        results: []
      };
      
      // Format the results
      const markdown = copilotChatService.formatResultsAsMarkdown(
        originalFunction,
        alternativeImplementations,
        benchmarkResults
      );
      
      // Verify the markdown indicates no results available
      expect(markdown).toContain('⚠️ No benchmark results available');
    });
    
    it('should handle error cases when formatting markdown', async () => {
      // Create invalid benchmark results that will cause an error
      const benchmarkResults = null;
      
      // Format the results with invalid data
      const markdown = copilotChatService.formatResultsAsMarkdown(
        { name: 'original', code: 'function test(){}' },
        [],
        benchmarkResults
      );
      
      // Verify the error message in the markdown
      expect(markdown).toContain('# Error Formatting Results');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Error formatting markdown'));
    });
  });
  
  describe('parseAlternativeImplementations', () => {
    it('should extract multiple alternatives from the response', async () => {
      const response = `
Alternative 1:
Using Set for faster lookups

\`\`\`javascript
function test1(arr) {
  const result = new Set(arr);
  return [...result];
}
\`\`\`

Alternative 2:
Using Map for better performance

\`\`\`javascript
function test2(arr) {
  const map = new Map();
  arr.forEach(item => map.set(item, true));
  return [...map.keys()];
}
\`\`\`
`;
      
      const originalCode = 'function test(arr) { return arr; }';
      const alternatives = copilotChatService['parseAlternativeImplementations'](originalCode, response);
      
      expect(alternatives).toHaveLength(2);
      expect(alternatives[0].name).toBe('Alternative 1');
      expect(alternatives[0].code).toContain('function test1');
      expect(alternatives[1].name).toBe('Alternative 2');
      expect(alternatives[1].code).toContain('function test2');
    });
    
    it('should skip the original code if included in response', async () => {
      const originalCode = 'function test(arr) { return arr; }';
      const response = `
Original function:

\`\`\`javascript
function test(arr) { return arr; }
\`\`\`

Alternative 1:

\`\`\`javascript
function test1(arr) {
  return [...new Set(arr)];
}
\`\`\`
`;
      
      const alternatives = copilotChatService['parseAlternativeImplementations'](originalCode, response);
      
      expect(alternatives).toHaveLength(1);
      expect(alternatives[0].name).toBe('Alternative 1');
      expect(alternatives[0].code).toContain('function test1');
    });
  });
}); 