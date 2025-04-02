/**
 * Mock implementation of the vscode API for Jest tests.
 */

const mockLanguageModel = {
  vendor: 'mockVendor',
  name: 'mockModel',
  sendRequest: jest.fn().mockResolvedValue({ text: (async function*() { yield 'Mock LLM response'; })() }),
  // Add other properties/methods if needed
};

const mockChatParticipant = {
  iconPath: undefined,
  followupProvider: undefined,
  dispose: jest.fn(),
  // Add other properties/methods if needed
};

const mockCancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
};

const mockResponseStream = {
  markdown: jest.fn(),
  progress: jest.fn(),
  // Add other methods if needed by tests
};

const mockTextEditor = {
    document: {
        uri: { fsPath: '/fake/path/file.ts' },
        getText: jest.fn().mockReturnValue(''), // Default mock, override in tests if needed
        // Add other document properties/methods if needed
    },
    selection: {
        active: { line: 0, character: 0 },
        anchor: { line: 0, character: 0 },
        isEmpty: true,
        isSingleLine: true,
        // Add other selection properties if needed
    },
    // Add other editor properties/methods if needed
};

// Add mock for LanguageModelChatMessage
const mockLanguageModelChatMessage = {
  user: jest.fn((content) => ({ role: 'user', content })),
  assistant: jest.fn((content) => ({ role: 'assistant', content })),
};

module.exports = {
  // Language Model API Mock
  lm: {
    selectChatModels: jest.fn().mockResolvedValue([mockLanguageModel]),
  },

  // Chat API Mock
  chat: {
    createChatParticipant: jest.fn().mockReturnValue(mockChatParticipant),
  },

  // Window API Mock
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    })),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    activeTextEditor: mockTextEditor, // Provide a default mock editor
    // Add other window properties/methods if needed
  },

  // Commands API Mock
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand: jest.fn(),
  },

  // Other Mocks
  themeIcon: jest.fn((id) => ({ id })),
  uri: {
    file: jest.fn((path) => ({ fsPath: path })),
  },
  cancellationTokenSource: jest.fn(() => ({
    token: mockCancellationToken,
    cancel: jest.fn(),
    dispose: jest.fn(),
  })),
  eventEmitter: jest.fn(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
  })),
  languageModelChatMessage: mockLanguageModelChatMessage,

  // Export mock instances for potential use in tests
  _mockLanguageModel: mockLanguageModel,
  _mockChatParticipant: mockChatParticipant,
  _mockCancellationToken: mockCancellationToken,
  _mockResponseStream: mockResponseStream,
  _mockTextEditor: mockTextEditor,
}; 