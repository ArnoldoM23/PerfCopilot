/**
 * Tests for extension.ts
 */

// Mock vscode module before importing anything else
jest.mock('vscode', () => {
  // Create main mocks
  const mockOutputChannel = {
    appendLine: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  };
  
  return {
    window: {
      createOutputChannel: jest.fn().mockReturnValue(mockOutputChannel),
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn().mockResolvedValue(null),
      activeTextEditor: {
        document: {
          getText: jest.fn().mockReturnValue('function test() { return 1; }')
        },
        selection: {
          isEmpty: false
        }
      }
    },
    commands: {
      registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      executeCommand: jest.fn().mockResolvedValue(undefined)
    },
    extensions: {
      getExtension: jest.fn().mockReturnValue({
        isActive: true,
        activate: jest.fn().mockResolvedValue(undefined)
      })
    },
    env: {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined)
      }
    },
    Uri: {
      parse: jest.fn().mockReturnValue({ with: jest.fn().mockReturnThis() })
    },
    chat: {
      createChatParticipant: jest.fn().mockReturnValue({
        dispose: jest.fn()
      })
    },
    ThemeIcon: jest.fn()
  };
});

// Mock modules
jest.mock('../services/copilotChatService');
jest.mock('../services/benchmarkService');
jest.mock('../perfCopilotParticipant');
jest.mock('fs');
jest.mock('path');
jest.mock('os');

// Import the module to test
import { activate, deactivate } from '../extension';
import { CopilotChatService } from '../services/copilotChatService';
import { BenchmarkService } from '../services/benchmarkService';
import { PerfCopilotParticipant } from '../perfCopilotParticipant';

// Add mock for clipboard API
mockVscode.env = {
  ...mockVscode.env,
  clipboard: {
    readText: jest.fn().mockResolvedValue(''),
    writeText: jest.fn().mockResolvedValue(undefined)
  }
};

describe('PerfCopilot Extension', () => {
  // Mock context for extension activation
  const mockContext: any = {
    subscriptions: []
  };
  
  // Access the VS Code mock
  const vscode = require('vscode');

    beforeEach(() => {
    // Reset all mocks before each test
        jest.clearAllMocks();
        
    // Set up default active editor
        vscode.window.activeTextEditor = {
            document: {
        getText: jest.fn().mockImplementation((_selection: any) => 'function test() { return 1; }')
      },
      selection: {}
    };
    
    // Ensure we have a default implementation for extension.getExtension
    vscode.extensions.getExtension.mockReturnValue({
      isActive: true,
      activate: jest.fn().mockResolvedValue(undefined)
    });
    
    // Mock successful command execution
    vscode.commands.executeCommand.mockResolvedValue(undefined);
  });
  
  describe('activate', () => {
    it('should create an output channel', async () => {
      await activate(mockContext);
      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PerfCopilot');
    });
    
    it('should initialize services', async () => {
      await activate(mockContext);
      expect(CopilotChatService).toHaveBeenCalled();
      expect(BenchmarkService).toHaveBeenCalled();
    });
    
    it('should register the chat participant', async () => {
      await activate(mockContext);
      expect(PerfCopilotParticipant).toHaveBeenCalled();
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });
    
    it('should register the analyzeFunction command', async () => {
      await activate(mockContext);
        expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
            'perfcopilot.analyzeFunction',
            expect.any(Function)
        );
    });

    it('should register the showLogs command', async () => {
      await activate(mockContext);
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'perfcopilot.showLogs',
        expect.any(Function)
        );
    });

    it('should handle errors when registering the chat participant', async () => {
      // Force an error when creating the participant
      (PerfCopilotParticipant as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      await activate(mockContext);
      
      // Verify error was logged
      const outputChannel = vscode.window.createOutputChannel.mock.results[0].value;
      expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Failed to register'));
    });
  });
  
  describe('analyzeFunction command', () => {
    // Test that we can get the command handler
    it('should register a handler for analyzeFunction command', async () => {
      await activate(mockContext);
      
      // Get the handler for the analyzeFunction command
      const registerCommandCalls = vscode.commands.registerCommand.mock.calls;
      const analyzeCommandCall = registerCommandCalls.find(
        (call: any[]) => call[0] === 'perfcopilot.analyzeFunction'
      );
      
      // Verify the handler is a function
      expect(analyzeCommandCall).toBeDefined();
      expect(typeof analyzeCommandCall[1]).toBe('function');
    });
    
    // Test error handling for no active editor
    it('should show error when no active editor (synchronous part)', async () => {
      await activate(mockContext);
      
      // Get the handler for the analyzeFunction command
      const registerCommandCalls = vscode.commands.registerCommand.mock.calls;
      const analyzeCommandHandler = registerCommandCalls.find(
        (call: any[]) => call[0] === 'perfcopilot.analyzeFunction'
      )[1];
      
      // Set activeTextEditor to undefined
      vscode.window.activeTextEditor = undefined;
      
      // Execute just the beginning of the handler
      const handlerPromise = analyzeCommandHandler();
      
      // Verify error is shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor found');
      
      // Since we're not checking full execution, we don't need to await the promise
      // Just make sure it exists
      expect(handlerPromise).toBeDefined();
    });
    
    // Test error handling for empty text selection
    it('should show error when no function is selected (synchronous part)', async () => {
      await activate(mockContext);
      
      // Get the handler for the analyzeFunction command
      const registerCommandCalls = vscode.commands.registerCommand.mock.calls;
      const analyzeCommandHandler = registerCommandCalls.find(
        (call: any[]) => call[0] === 'perfcopilot.analyzeFunction'
      )[1];
      
      // Set getText to return an empty string
      vscode.window.activeTextEditor.document.getText.mockReturnValue('');
      
      // Execute just the beginning of the handler
      const handlerPromise = analyzeCommandHandler();
      
      // Verify error is shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No function selected');
      
      // Since we're not checking full execution, we don't need to await the promise
      // Just make sure it exists
      expect(handlerPromise).toBeDefined();
    });
  });
  
  describe('deactivate', () => {
    it('should dispose the output channel', async () => {
      // First activate the extension to create the output channel
      await activate(mockContext);
      
      // Get the output channel
      const outputChannel = vscode.window.createOutputChannel.mock.results[0].value;
      
      // Then deactivate
      deactivate();
      
      // Verify the output channel was disposed
      expect(outputChannel.dispose).toHaveBeenCalled();
    });
  });
}); 