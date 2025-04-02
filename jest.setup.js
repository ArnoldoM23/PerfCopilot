/**
 * Jest setup file for PerfCopilot
 * 
 * This file runs before each test file and sets up the test environment
 */

// Increase timeout for all tests to handle potentially slow operations
jest.setTimeout(10000);

// Mock console methods to reduce noise in test output
// but allow errors to show
global.console = {
  ...console,
  // Keep error logging
  error: console.error,
  // Silence or customize other console methods
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Clear all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Handle unhandled promise rejections during tests
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION in tests:', reason);
});

// Additional setup for vscode mocking
jest.mock('vscode', () => {
  // Return a basic mock if not already mocked in the specific test
  return {
    window: {
      createOutputChannel: jest.fn().mockReturnValue({
        appendLine: jest.fn(),
        clear: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
      }),
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn().mockResolvedValue(null),
    },
    commands: {
      registerCommand: jest.fn(),
      executeCommand: jest.fn(),
    },
    extensions: {
      getExtension: jest.fn().mockReturnValue(null),
    },
    ProgressLocation: {
      Notification: 1,
    },
    Uri: {
      parse: jest.fn().mockReturnValue({ with: jest.fn().mockReturnThis() }),
      file: jest.fn().mockReturnValue({ with: jest.fn().mockReturnThis() }),
    },
  };
}, { virtual: true }); 