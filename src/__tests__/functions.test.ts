/**
 * Tests for utility functions
 */

import { extractFunctionName } from '../utils/functions';
import { runNodeScript } from '../utils/functions';
import path from 'path';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { spawn } from 'child_process';

// Mock the fs, path, and os modules
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
}), { virtual: true });

jest.mock('path', () => ({
  join: jest.fn().mockImplementation((...args) => args.join('/'))
}), { virtual: true });

jest.mock('os', () => ({
  tmpdir: jest.fn().mockReturnValue('/tmp')
}), { virtual: true });

// Define mockSpawn at the module scope so jest.mock can see it
let mockSpawn: jest.Mock;
let mockChildProcess: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
let mockStdout: EventEmitter;
let mockStderr: EventEmitter;

// Mock child_process at the module level
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'), // Keep other exports
  spawn: (...args: any[]) => { // Use a function factory
    // If mockSpawn is defined (i.e., inside a test), call it
    if (mockSpawn) {
      return mockSpawn(...args);
    }
    // Otherwise, maybe return a default mock or throw? For tests, it should be defined.
    throw new Error("mockSpawn was not defined before calling spawn"); 
  },
}));

// Mock fs promises for createTempFile tests (if needed, keep if already there)
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        ...jest.requireActual('fs').promises,
        writeFile: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
    },
    existsSync: jest.fn(),
}));

describe('Utility Functions', () => {
  describe('extractFunctionName', () => {
    it('should extract function name from standard function declaration', () => {
      const code = `function calculateSum(a, b) {
        return a + b;
      }`;
      
      const name = extractFunctionName(code);
      expect(name).toBe('calculateSum');
    });
    
    it('should extract function name from arrow function with variable declaration', () => {
      const code = `const calculateSum = (a, b) => {
        return a + b;
      }`;
      
      const name = extractFunctionName(code);
      expect(name).toBe('calculateSum');
    });
    
    it('should extract function name from async arrow function', () => {
      const code = `const fetchData = async (url) => {
        const response = await fetch(url);
        return response.json();
      }`;
      
      const name = extractFunctionName(code);
      expect(name).toBe('fetchData');
    });
    
    it('should extract function name from method declaration', () => {
      const code = `calculateSum(a, b) {
        return a + b;
      }`;
      
      const name = extractFunctionName(code);
      expect(name).toBe('calculateSum');
    });
    
    it('should return undefined for anonymous functions', () => {
      const code = `(function(a, b) {
        return a + b;
      })`;
      
      const name = extractFunctionName(code);
      expect(name).toBeUndefined();
    });
  });

  // Add tests for runNodeScript
  describe('runNodeScript', () => {
    let runNodeScript: (scriptPath: string) => Promise<string>; // Type for the function

    beforeEach(() => {
      // Reset modules to ensure we get a fresh import with the mock
      jest.resetModules();

      // Re-require the specific function *after* resetting modules
      // This ensures it picks up the mocked 'child_process'
      runNodeScript = require('../utils/functions').runNodeScript;

      // Create mock emitters
      mockStdout = new EventEmitter();
      mockStderr = new EventEmitter();
      mockChildProcess = Object.assign(new EventEmitter(), {
          stdout: mockStdout,
          stderr: mockStderr,
      });

      // Assign the mock implementation for spawn for this test
      mockSpawn = jest.fn().mockReturnValue(mockChildProcess);
    });

    afterEach(() => {
        jest.clearAllMocks();
         // Important: Clear the mock function itself between tests
        mockSpawn = undefined as any; 
    });

    it('should resolve with combined stdout and stderr on successful execution (code 0)', async () => {
      // Arrange
      const scriptPath = '/tmp/test-script.js'; 
      const stdoutData = 'Standard output data.';
      const stderrData = 'Error output data.';
      const promise = runNodeScript(scriptPath); // Call the function which calls spawn

      // Act: Simulate process output and closing
      mockStdout.emit('data', stdoutData); 
      mockStderr.emit('data', stderrData); 
      mockChildProcess.emit('close', 0); 

      // Assert
      await expect(promise).resolves.toBe(`${stdoutData}\n--- STDERR ---\n${stderrData}`);
      expect(mockSpawn).toHaveBeenCalledWith('node', [scriptPath]); // Simplified assertion
    });

     it('should resolve with only stdout if stderr is empty on success', async () => {
         // Arrange
         const scriptPath = '/tmp/test-script.js';
         const stdoutData = 'Standard output only.';
         const promise = runNodeScript(scriptPath); 

         // Act
         mockStdout.emit('data', stdoutData);
         // No stderr data emitted
         mockChildProcess.emit('close', 0);

         // Assert
         await expect(promise).resolves.toBe(stdoutData); 
         expect(mockSpawn).toHaveBeenCalledWith('node', [scriptPath]); 
     });

    it('should reject with an error including stderr and stdout on non-zero exit code', async () => {
      // Arrange
      const scriptPath = '/tmp/error-script.js';
      const stderrData = 'Script failed!';
      const stdoutData = 'Some output before failing';
      const exitCode = 1;
      const promise = runNodeScript(scriptPath); 

      // Act
      mockStdout.emit('data', stdoutData);
      mockStderr.emit('data', stderrData);
      mockChildProcess.emit('close', exitCode);

      // Assert
      await expect(promise).rejects.toThrow(`Script exited with code ${exitCode}. Stderr: ${stderrData}. Stdout: ${stdoutData}`);
      expect(mockSpawn).toHaveBeenCalledWith('node', [scriptPath]);
    });

    it('should reject with an error if the process emits an error', async () => {
      // Arrange
      const scriptPath = '/tmp/spawn-error-script.js';
      const error = new Error('Spawn error');
      const promise = runNodeScript(scriptPath); 

      // Act
      mockChildProcess.emit('error', error); // Emit the 'error' event

      // Assert
      await expect(promise).rejects.toThrow(error); 
       expect(mockSpawn).toHaveBeenCalledWith('node', [scriptPath]);
    });
  });
}); 