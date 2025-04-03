/**
 * Benchmark Code Generator Module
 * 
 * Provides utilities for generating valid Benny.js benchmark code
 * for comparing function implementations.
 */

import { FunctionImplementation } from '../models/types';
import { extractFunctionName } from './functions';

/**
 * Determines the parameter types from a function signature and generates appropriate test data.
 * 
 * @param functionCode - The function code to analyze
 * @returns Code for generating test data
 */
function generateTestData(functionCode: string): string {
  // Extract function parameters
  const paramMatch = functionCode.match(/function\s+\w+\s*\(\s*([^)]*)\s*\)/);
  const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim()) : [];
  
  if (params.length === 0 || !params[0]) {
    // Function takes no parameters, generate simple test call
    return 'const testData = null;';
  }
  
  // Check if the first parameter has a type annotation
  const firstParam = params[0];
  const hasTypeAnnotation = firstParam.includes(':');
  const paramName = hasTypeAnnotation ? firstParam.split(':')[0].trim() : firstParam;
  const paramType = hasTypeAnnotation ? firstParam.split(':')[1].trim() : '';
  
  // Check function name for clues
  const fnNameMatch = functionCode.match(/function\s+(\w+)/);
  const fnName = fnNameMatch ? fnNameMatch[1].toLowerCase() : '';
  
  if (fnName.includes('string') || fnName.includes('str') || fnName.includes('text')) {
    return `
// Generate string test data
const testData = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';`;
  }
  
  if (fnName.includes('object') || fnName.includes('obj') || fnName.includes('data') || 
      paramName.includes('obj') || paramName.includes('data') || paramName.includes('options')) {
    return `
// Generate object test data
const testData = {
  id: 1,
  name: 'Test Item',
  value: 42,
  items: [1, 2, 3, 4, 5],
  metadata: {
    created: new Date(),
    modified: new Date(),
    status: 'active'
  }
};`;
  }
  
  if (fnName.includes('num') || fnName.includes('calc') || fnName.includes('math') || 
      fnName.includes('sum') || fnName.includes('compute') || fnName.includes('square')) {
    return `
// Generate numeric test data
const testData = 42;`;
  }
  
  // Check the function body for clues about parameter types
  const isArrayFunction = functionCode.includes('.forEach') || 
                          functionCode.includes('.map') || 
                          functionCode.includes('.filter') || 
                          functionCode.includes('.reduce') ||
                          functionCode.includes('[') ||
                          functionCode.includes('length') ||
                          functionCode.includes('push(') || 
                          functionCode.includes('indexOf');
  
  const isStringFunction = functionCode.includes('.charAt') ||
                          functionCode.includes('.substring') ||
                          functionCode.includes('.substr') ||
                          functionCode.includes('.replace') ||
                          functionCode.includes('.toUpperCase') ||
                          functionCode.includes('.toLowerCase') ||
                          functionCode.includes('.split(');
  
  // Check for object operations
  const isObjectFunction = functionCode.includes('.keys') ||
                          functionCode.includes('.values') ||
                          functionCode.includes('.entries') ||
                          paramType === 'object' ||
                          (functionCode.includes('{') && functionCode.includes('}'));
  
  // Generate appropriate test data based on the function's usage patterns
  if (isStringFunction) {
    // For string functions, generate a string
    return `
// Generate string test data
const testData = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';`;
  } else if (isObjectFunction && !isArrayFunction) {
    // For object functions, generate a sample object
    return `
// Generate object test data
const testData = {
  id: 1,
  name: 'Test Item',
  value: 42,
  items: [1, 2, 3, 4, 5],
  metadata: {
    created: new Date(),
    modified: new Date(),
    status: 'active'
  }
};`;
  } else if (isArrayFunction) {
    // For array functions, generate an array of varying values
    return `
// Generate array test data
const testData = Array.from({length: 1000}, (_, i) => 
  Math.floor(Math.random() * 100)
);`;
  } else {
    // Default to a number for other functions
    return `
// Generate numeric test data
const testData = 42;`;
  }
}

/**
 * Generates benchmark code for comparing function implementations using Benny.js.
 * 
 * @param originalFunction - The original function implementation
 * @param alternatives - Array of alternative implementations to compare
 * @returns Executable benchmark code as a string
 */
export function generateBenchmarkCode(
  originalFunction: FunctionImplementation,
  alternatives: FunctionImplementation[]
): string {
  // Extract the function name from the original function
  const functionName = extractFunctionName(originalFunction.code) || 'testFunction';
  
  // Start building the benchmark code
  let code = `
const benny = require('benny');

// Original function
${originalFunction.code}

`;

  // Add alternative implementations with unique names
  alternatives.forEach((alt, index) => {
    const altFunctionCode = alt.code.replace(
      new RegExp(`function\\s+${functionName}\\s*\\(`), 
      `function ${functionName}_alt${index + 1}(`
    );
    
    code += `// ${alt.name}\n${altFunctionCode}\n\n`;
  });

  // Generate appropriate test data based on function signature
  code += `
// Generate test data
${generateTestData(originalFunction.code)}

`;

  // Create the benchmark suite
  code += `
// Create benchmark suite
benny.suite(
  'Function Performance Comparison',
  
  // Original implementation
  benny.add('original', () => {
    ${functionName}(testData);
  }),
  
`;

  // Add benchmark cases for alternatives
  alternatives.forEach((alt, index) => {
    const altFunctionName = `${functionName}_alt${index + 1}`;
    
    code += `  // ${alt.name}
  benny.add('${alt.name}', () => {
    ${altFunctionName}(testData);
  }),
  
`;
  });

  // Complete the benchmark with cycle and complete handlers
  code += `  // Output cycle results
  benny.cycle(),
  
  // Complete and format results
  benny.complete((results) => {
    // Format results as JSON for easy parsing
    const resultsJSON = {
      fastest: results.fastest.name,
      results: results.results.map(r => ({
        name: r.name,
        ops: r.hz,
        margin: r.stats.rme / 100
      }))
    };
    
    // Output with marker for easy extraction
    console.log('RESULTS_JSON: ' + JSON.stringify(resultsJSON));
  })
);
`;

  return code;
} 
