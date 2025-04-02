/**
 * Tests for utility functions
 */

import { extractFunctionName, calculateImprovement } from '../utils/functions';

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

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    const eventHandlers: Record<string, Array<(...args: any[]) => void>> = {
      'data': [],
      'close': [],
      'error': []
    };
    
    const mockProcess = {
      stdout: {
        on: (event: string, handler: (...args: any[]) => void) => {
          if (event === 'data') {
            eventHandlers.data.push(handler);
          }
          return mockProcess.stdout;
        }
      },
      stderr: {
        on: (event: string, handler: (...args: any[]) => void) => {
          if (event === 'data') {
            eventHandlers.data.push(handler);
          }
          return mockProcess.stderr;
        }
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        if (event === 'close' || event === 'error') {
          eventHandlers[event].push(handler);
        }
        return mockProcess;
      },
      // Helper methods for tests to trigger events
      emitStdout: (data: string) => {
        eventHandlers.data.forEach(handler => handler(Buffer.from(data)));
        return mockProcess;
      },
      emitClose: (code: number) => {
        eventHandlers.close.forEach(handler => handler(code));
        return mockProcess;
      },
      emitError: (error: Error) => {
        eventHandlers.error.forEach(handler => handler(error));
        return mockProcess;
      }
    };
    
    return mockProcess;
  })
}), { virtual: true });

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
  
  describe('calculateImprovement', () => {
    it('should calculate positive improvement percentage', () => {
      const originalOps = 1000;
      const improvedOps = 1500;
      
      const improvement = calculateImprovement(originalOps, improvedOps);
      expect(improvement).toBe(50); // 50% improvement
    });
    
    it('should calculate negative improvement percentage', () => {
      const originalOps = 1000;
      const improvedOps = 800;
      
      const improvement = calculateImprovement(originalOps, improvedOps);
      expect(improvement).toBe(-20); // 20% worse
    });
    
    it('should handle zero original ops', () => {
      const originalOps = 0;
      const improvedOps = 1000;
      
      const improvement = calculateImprovement(originalOps, improvedOps);
      expect(improvement).toBe(0); // Cannot calculate improvement from zero
    });
    
    it('should handle negative original ops', () => {
      const originalOps = -100;
      const improvedOps = 1000;
      
      const improvement = calculateImprovement(originalOps, improvedOps);
      expect(improvement).toBe(0); // Cannot calculate improvement from negative
    });
    
    it('should handle zero improvement', () => {
      const originalOps = 1000;
      const improvedOps = 1000;
      
      const improvement = calculateImprovement(originalOps, improvedOps);
      expect(improvement).toBe(0); // No improvement
    });
  });
}); 