/**
 * Test-Driven Development for valid Benny.js benchmark code generation
 * 
 * This test defines the expected structure and functionality of benchmark code
 * before implementing the actual generator.
 */

import { FunctionImplementation } from '../models/types';
import { generateBenchmarkCode } from '../utils/benchmarkGenerator';

describe('Benny.js Benchmark Code Generator', () => {
  // Sample functions for testing
  const originalFunction: FunctionImplementation = {
    name: 'original',
    code: `function findDuplicates(array) {
  const duplicates = [];
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] === array[j] && !duplicates.includes(array[i])) {
        duplicates.push(array[i]);
      }
    }
  }
  return duplicates;
}`,
    description: 'Original implementation with nested loops'
  };

  const alternativeImplementations: FunctionImplementation[] = [
    {
      name: 'Alternative 1',
      code: `function findDuplicates(array) {
  return [...new Set(array.filter(item => 
    array.indexOf(item) !== array.lastIndexOf(item)
  ))];
}`,
      description: 'Using filter and Set for better performance'
    },
    {
      name: 'Alternative 2',
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
  return [...duplicates];
}`,
      description: 'Using Set data structure for O(n) time complexity'
    }
  ];

  // Additional functions for test data generation testing
  const stringFunction: FunctionImplementation = {
    name: 'string-function',
    code: `function reverseString(str) {
  return str.split('').reverse().join('');
}`,
    description: 'A string manipulation function'
  };

  const objectFunction: FunctionImplementation = {
    name: 'object-function',
    code: `function processObject(obj) {
  return Object.keys(obj).map(key => obj[key]);
}`,
    description: 'An object processing function'
  };

  const numberFunction: FunctionImplementation = {
    name: 'number-function',
    code: `function square(num) {
  return num * num;
}`,
    description: 'A simple numeric function'
  };

  const noParamFunction: FunctionImplementation = {
    name: 'no-params',
    code: `function generateId() {
  return Math.random().toString(36).substr(2, 9);
}`,
    description: 'A function with no parameters'
  };

  it('should include the benny.js library import', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    expect(code).toContain("const benny = require('benny')");
  });

  it('should include original function unmodified', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should contain a comment about the original function
    expect(code).toContain('// Original function');
    
    // Should include the original function implementation
    expect(code).toContain(originalFunction.code.trim());
  });

  it('should include all alternative implementations with unique names', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Original function name
    const originalFnName = "findDuplicates";
    
    // Should include alternative 1 with a unique name
    expect(code).toContain(`// ${alternativeImplementations[0].name}`);
    expect(code).toMatch(/function\s+findDuplicates_alt1\s*\(/);
    
    // Should include alternative 2 with a unique name
    expect(code).toContain(`// ${alternativeImplementations[1].name}`);
    expect(code).toMatch(/function\s+findDuplicates_alt2\s*\(/);
    
    // Function bodies should still be present
    expect(code).toContain("return [...new Set(array.filter");
    expect(code).toContain("const seen = new Set()");
  });

  it('should generate array test data for array functions', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should generate test data for the function
    expect(code).toContain("// Generate test data");
    expect(code).toContain("const testData =");
    
    // Should generate array data for our findDuplicates function
    expect(code).toContain("// Generate array test data");
    expect(code).toContain("Array.from");
  });

  it('should generate string test data for string functions', () => {
    const code = generateBenchmarkCode(stringFunction, []);
    
    // Should generate string test data
    expect(code).toContain("// Generate string test data");
    expect(code).toContain("Lorem ipsum");
  });

  it('should generate object test data for object functions', () => {
    const code = generateBenchmarkCode(objectFunction, []);
    
    // Should generate object test data
    expect(code).toContain("// Generate object test data");
    expect(code).toContain("const testData = {");
    expect(code).toContain("name: 'Test Item'");
  });

  it('should generate numeric test data for numeric functions', () => {
    const code = generateBenchmarkCode(numberFunction, []);
    
    // Should generate numeric test data
    expect(code).toContain("// Generate numeric test data");
    expect(code).toContain("const testData = 42");
  });

  it('should handle functions with no parameters', () => {
    const code = generateBenchmarkCode(noParamFunction, []);
    
    // Should use null for no parameters
    expect(code).toContain("const testData = null");
  });

  it('should create a proper benny.js benchmark suite', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should set up the benchmark suite
    expect(code).toContain("benny.suite(");
    
    // Should include descriptive suite name
    expect(code).toMatch(/benny\.suite\s*\(\s*['"].*['"]/);
  });

  it('should add benchmarks for all implementations', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should add the original function
    expect(code).toContain("benny.add('original'");
    expect(code).toMatch(/benny\.add\s*\(\s*['"]original['"]\s*,\s*\(\s*\)\s*=>\s*\{/);
    
    // Should include call to original function with test data
    expect(code).toMatch(/findDuplicates\s*\(\s*testData\s*\)/);
    
    // Should add alternative implementations
    expect(code).toContain("benny.add('Alternative 1'");
    expect(code).toMatch(/findDuplicates_alt1\s*\(\s*testData\s*\)/);
    
    expect(code).toContain("benny.add('Alternative 2'");
    expect(code).toMatch(/findDuplicates_alt2\s*\(\s*testData\s*\)/);
  });

  it('should include cycle and complete handlers', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should include cycle handler
    expect(code).toContain("benny.cycle()");
    
    // Should include complete handler
    expect(code).toContain("benny.complete(");
  });

  it('should output results in JSON format with a marker', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should define a results JSON object
    expect(code).toContain("const resultsJSON = {");
    
    // Should include fastest property
    expect(code).toContain("fastest: results.fastest.name");
    
    // Should map results
    expect(code).toContain("results: results.results.map");
    
    // Should output with a marker for easy extraction
    expect(code).toContain("console.log('RESULTS_JSON: ' + JSON.stringify(resultsJSON))");
  });

  it('should ensure results JSON contains necessary fields', () => {
    const code = generateBenchmarkCode(originalFunction, alternativeImplementations);
    
    // Should include name in results
    expect(code).toContain("name: r.name");
    
    // Should include operations per second
    expect(code).toContain("ops: r.hz");
    
    // Should include margin of error
    expect(code).toMatch(/margin:\s*r\.stats\.rme\s*\/\s*100/);
  });
}); 