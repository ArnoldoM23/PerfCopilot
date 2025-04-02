/**
 * Jest setup file
 * 
 * This file runs before each test file to set up the test environment.
 */

// Import necessary types
import { MockOutputChannel } from './mocks';

// Mock output channel
export const mockOutputChannel = new MockOutputChannel('PerfCopilot');

// Create mock webview panel
export const mockWebviewPanel = {
  webview: {
    html: '',
    onDidReceiveMessage: jest.fn()
  },
  onDidDispose: jest.fn(),
  reveal: jest.fn(),
  dispose: jest.fn()
};

// Mock the vscode module
jest.mock('vscode', () => {
  return require('./vscode-mock');
}, { virtual: true });

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  mockOutputChannel.clear();
  mockWebviewPanel.webview.html = '';
});

// Helper function to simulate a complete function analysis
export function simulateCompleteAnalysis() {
  // This function can be expanded to provide testing data as needed
}

// Add Jest's expect extensions if needed
expect.extend({
  toContainString(received: string[], expected: string) {
    const pass = received.some(item => item.includes(expected));
    return {
      pass,
      message: () => `Expected ${received} ${pass ? 'not ' : ''}to contain string "${expected}"`
    };
  }
}); 