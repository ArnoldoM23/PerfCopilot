/**
 * Mock for the vscode module
 */

const vscode = {
  // Mock the window namespace
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    })),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    createWebviewPanel: jest.fn(() => ({
      webview: {
        html: '',
        onDidReceiveMessage: jest.fn()
      },
      onDidDispose: jest.fn(),
      reveal: jest.fn(),
      dispose: jest.fn()
    })),
    withProgress: jest.fn((options, task) => task({
      report: jest.fn()
    })),
    activeTextEditor: {
      document: {
        getText: jest.fn(),
        save: jest.fn()
      },
      selection: {
        isEmpty: false
      }
    }
  },
  
  // Mock the workspace namespace
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
      update: jest.fn()
    })),
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
  },
  
  // Mock the commands namespace
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn()
  },
  
  // Mock the extensions namespace
  extensions: {
    getExtension: jest.fn()
  },
  
  // Mock the progress namespace
  ProgressLocation: {
    Notification: 1
  },
  
  // Mock the Uri namespace
  Uri: {
    file: jest.fn(path => ({ fsPath: path })),
    parse: jest.fn()
  },
  
  // Mock the env namespace
  env: {
    clipboard: {
      writeText: jest.fn(),
      readText: jest.fn()
    }
  },
  
  // Mock the chat namespace
  chat: {
    createChatParticipant: jest.fn(() => ({
      dispose: jest.fn(),
      iconPath: null
    }))
  },
  
  // Mock the ThemeIcon class
  ThemeIcon: class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  },
  
  // Mock the ViewColumn enum
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3
  },
  
  // Mock CancellationTokenSource class
  CancellationTokenSource: class CancellationTokenSource {
    constructor() {
      this.token = { isCancellationRequested: false };
    }
    
    cancel() {
      this.token.isCancellationRequested = true;
    }
    
    dispose() {}
  }
};

module.exports = vscode; 