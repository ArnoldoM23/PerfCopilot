/**
 * Tests for benchmark code generation
 */

import { generateBenchmarkCode } from '../utils/benchmarkGenerator';
import { FunctionImplementation } from '../models/types';

describe('Benchmark Code Generation - generateBenchmarkCode Utility', () => {
  // Define sample function implementations for testing
  const originalFunction: FunctionImplementation = {
    name: 'Original',
    code: 'function original(a, b) { return a + b; }',
    description: 'Original addition function'
  };

  const alternativeImplementations: FunctionImplementation[] = [
    {
      name: 'Alternative 1',
      code: 'const alternative1 = (a, b) => a + b;',
      description: 'Arrow function addition'
    },
    {
      name: 'Alternative 2',
      code: 'function alternative2(a, b) { let sum = a; sum += b; return sum; }',
      description: 'Step-by-step addition'
    }
  ];

  it('should generate valid benchmark code with Benny.js for all implementations', () => {
    // Call the utility function directly
    const benchmarkCode = generateBenchmarkCode(
      originalFunction,
      alternativeImplementations
    );

    // Basic checks for Benny.js structure
    expect(benchmarkCode).toContain("const benny = require('benny');");
    expect(benchmarkCode).toContain('benny.suite(');
    expect(benchmarkCode).toContain(`benny.add('${originalFunction.name.toLowerCase()}'`);
    expect(benchmarkCode).toContain(`benny.add('${alternativeImplementations[0].name}'`);
    expect(benchmarkCode).toContain(`benny.add('${alternativeImplementations[1].name}'`);
    expect(benchmarkCode).toContain('benny.cycle()');
    expect(benchmarkCode).toContain('benny.complete((results) => {');
    expect(benchmarkCode).toContain("console.log('RESULTS_JSON: ' + JSON.stringify(resultsJSON));");
  });

  it('should include all function implementations in the benchmark code', () => {
    const benchmarkCode = generateBenchmarkCode(
      originalFunction,
      alternativeImplementations
    );

    // Check if the code for each implementation is present
    expect(benchmarkCode).toContain(originalFunction.code);
    expect(benchmarkCode).toContain(alternativeImplementations[0].code);
    expect(benchmarkCode).toContain(alternativeImplementations[1].code);
  });

  it('should include direct function calls within the benchmark suite', () => {
    const benchmarkCode = generateBenchmarkCode(
      originalFunction,
      alternativeImplementations
    );

    // Check for the presence of direct function calls using generated testData
    // Make regex more flexible regarding arguments
    expect(benchmarkCode).toMatch(/benny\.add\('original',\s*\(\) =>\s*\{\s*original\(.*\);\s*\}\)/);
    expect(benchmarkCode).toMatch(/benny\.add\('Alternative 1',\s*\(\) =>\s*\{\s*original_alt1\(.*\);\s*\}\)/);
    expect(benchmarkCode).toMatch(/benny\.add\('Alternative 2',\s*\(\) =>\s*\{\s*original_alt2\(.*\);\s*\}\)/);
  });

  it('should generate code that includes logging results to console', () => {
    const benchmarkCode = generateBenchmarkCode(
      originalFunction,
      alternativeImplementations
    );

    // Check for the console logging within benny.complete
    expect(benchmarkCode).toContain("benny.complete((results) => {");
    expect(benchmarkCode).toContain("console.log('RESULTS_JSON: ' + JSON.stringify(resultsJSON));");
  });
}); 