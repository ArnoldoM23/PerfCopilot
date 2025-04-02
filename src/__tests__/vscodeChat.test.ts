/**
 * Tests for VS Code Chat Service
 */

import * as vscode from 'vscode';
import { VSCodeChatService } from '../services/vscodeChat';
import { MockOutputChannel } from './mocks';

// Mock the vscode namespace
jest.mock('vscode', () => {
  return require('./vscode-mock');
}, { virtual: true });

// Mock the fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

// Mock the path and os modules
jest.mock('path', () => ({
  join: jest.fn().mockImplementation((...args) => args.join('/'))
}));

jest.mock('os', () => ({
  tmpdir: jest.fn().mockReturnValue('/tmp')
}));

describe('VSCodeChatService', () => {
  let mockOutputChannel: MockOutputChannel;
  let service: VSCodeChatService;
  
  // Setup before each test
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock output channel
    mockOutputChannel = new MockOutputChannel('PerfCopilot');
    
    // Create service instance
    service = new VSCodeChatService(mockOutputChannel as any);
  });
  
  describe('sendChatMessage', () => {
    it('should use VS Code chat when available', async () => {
      // Mock VS Code commands
      const getCommandsMock = jest.fn().mockResolvedValue([
        'workbench.action.chat.open',
        'workbench.action.chat.startEditing',
        'workbench.action.chat.submit'
      ]);
      vscode.commands.getCommands = getCommandsMock;
      
      // Mock command execution
      const executeCommandMock = jest.fn().mockResolvedValue(undefined);
      vscode.commands.executeCommand = executeCommandMock;
      
      // Mock clipboard
      const clipboardWriteTextMock = jest.fn();
      vscode.env.clipboard.writeText = clipboardWriteTextMock;
      
      // Call the method
      const result = await service.sendChatMessage('test prompt');
      
      // Verify commands were called in the right order
      expect(executeCommandMock).toHaveBeenCalledWith('workbench.action.chat.open');
      expect(executeCommandMock).toHaveBeenCalledWith('workbench.action.chat.startEditing');
      expect(executeCommandMock).toHaveBeenCalledWith('workbench.action.chat.submit', 'test prompt');
      
      // Verify clipboard was used
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('test prompt');
      
      // Verify response
      expect(result).toContain('Request sent to VS Code chat');
    });
    
    it('should fall back to Copilot when VS Code chat is not available', async () => {
      // Mock VS Code commands
      const getCommandsMock = jest.fn().mockResolvedValue([
        'github.copilot.chat.focus'
      ]);
      vscode.commands.getCommands = getCommandsMock;
      
      // Mock command execution - but make the paste action fail to trigger the info message
      const executeCommandMock = jest.fn().mockImplementation((cmd) => {
        if (cmd === 'editor.action.clipboardPasteAction') {
          throw new Error('Paste failed');
        }
        return Promise.resolve(undefined);
      });
      vscode.commands.executeCommand = executeCommandMock;
      
      // Mock clipboard
      const clipboardWriteTextMock = jest.fn();
      vscode.env.clipboard.writeText = clipboardWriteTextMock;
      
      // Mock window.showInformationMessage
      const showInfoMock = jest.fn();
      vscode.window.showInformationMessage = showInfoMock;
      
      // Call the method
      const result = await service.sendChatMessage('test prompt');
      
      // Verify commands were called
      expect(executeCommandMock).toHaveBeenCalledWith('github.copilot.chat.focus');
      
      // Verify clipboard was used
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('test prompt');
      
      // Verify info message was shown
      expect(showInfoMock).toHaveBeenCalled();
      
      // Verify response
      expect(result).toContain('Request sent to GitHub Copilot');
    });
    
    it('should create a temporary file as last resort', async () => {
      // Mock VS Code commands with no chat commands
      const getCommandsMock = jest.fn().mockResolvedValue([
        'some.other.command'
      ]);
      vscode.commands.getCommands = getCommandsMock;
      
      // Mock fs module
      const existsSyncMock = jest.fn().mockReturnValue(false);
      const mkdirSyncMock = jest.fn();
      const writeFileSyncMock = jest.fn();
      require('fs').existsSync = existsSyncMock;
      require('fs').mkdirSync = mkdirSyncMock;
      require('fs').writeFileSync = writeFileSyncMock;
      
      // Mock workspace
      const openTextDocumentMock = jest.fn().mockResolvedValue({});
      vscode.workspace.openTextDocument = openTextDocumentMock;
      
      // Mock window
      const showTextDocumentMock = jest.fn().mockResolvedValue(undefined);
      vscode.window.showTextDocument = showTextDocumentMock;
      
      // Mock window.showInformationMessage
      const showInfoMock = jest.fn();
      vscode.window.showInformationMessage = showInfoMock;
      
      // Call the method
      const result = await service.sendChatMessage('test prompt');
      
      // Verify file operations were performed
      expect(existsSyncMock).toHaveBeenCalled();
      expect(mkdirSyncMock).toHaveBeenCalled();
      expect(writeFileSyncMock).toHaveBeenCalled();
      
      // Verify document was opened
      expect(openTextDocumentMock).toHaveBeenCalled();
      expect(showTextDocumentMock).toHaveBeenCalled();
      
      // Verify info message was shown
      expect(showInfoMock).toHaveBeenCalled();
      
      // Verify response
      expect(result).toContain('Prompt saved to temporary file');
    });
    
    it('should handle errors in command execution', async () => {
      // Mock VS Code commands
      const getCommandsMock = jest.fn().mockResolvedValue([
        'workbench.action.chat.open'
      ]);
      vscode.commands.getCommands = getCommandsMock;
      
      // Mock command execution to throw an error
      const executeCommandMock = jest.fn().mockRejectedValue(new Error('Command failed'));
      vscode.commands.executeCommand = executeCommandMock;
      
      // Call the method and expect it to throw
      await expect(service.sendChatMessage('test prompt')).rejects.toThrow('Failed to send chat message');
    });
  });
}); 