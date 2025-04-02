# PerfCopilot Testing Guide

This document describes the testing approach for the PerfCopilot extension.

## Test Structure

The PerfCopilot test suite is organized into several components:

1. **Utility Function Tests** - Tests for the core utility functions
2. **Service Component Tests** - Tests for the service layer 
3. **Extension Integration Tests** - Tests for the VS Code extension integration

## Running Tests

We provide several npm scripts to run tests:

- `npm test` - Run all tests
- `npm run test:functions` - Run only the utility function tests
- `npm run test:services` - Run only the service component tests 
- `npm run test:all` - Run all tests with verbose output
- `npm run test:run` - Run the custom test runner script for detailed reporting

## Benchmark Code Generation

PerfCopilot relies on correctly generated benchmark code to compare function implementations. The Benny.js benchmark code follows a specific structure to ensure accurate measurements:

### Benchmark Code Template

```javascript
const benny = require('benny');

// Original function
function originalFunction(param) {
  // Original implementation
}

// Alternative implementations
function alternativeImplementation1(param) {
  // First alternative implementation
}

function alternativeImplementation2(param) {
  // Second alternative implementation
}

// Generate test data appropriate for the function
const testData = generateTestData();

// Create benchmark suite
benny.suite(
  'Function Performance Comparison',
  
  // Add benchmarks for each implementation
  benny.add('original', () => {
    originalFunction(testData);
  }),
  
  benny.add('Alternative 1', () => {
    alternativeImplementation1(testData);
  }),
  
  benny.add('Alternative 2', () => {
    alternativeImplementation2(testData);
  }),
  
  // Output cycle information
  benny.cycle(),
  
  // Complete and output results
  benny.complete((results) => {
    // Format results as JSON and output with marker for easy extraction
    const resultsJSON = {
      fastest: results.fastest.name,
      results: results.results.map(r => ({
        name: r.name,
        ops: r.hz,
        margin: r.stats.rme / 100
      }))
    };
    console.log('RESULTS_JSON: ' + JSON.stringify(resultsJSON));
  })
);
```

### Key Considerations for Valid Benchmarks

1. **Appropriate Test Data Generation**
   - Test data should be representative of real-world use cases
   - Consider edge cases that might affect performance
   - Use consistently sized data for fair comparisons

2. **Function Signature Compatibility**
   - All implementations must have identical function signatures
   - Input/output behavior must be identical

3. **Warm-up and Sample Size**
   - Benny.js handles warm-up cycles automatically
   - Multiple samples are collected for statistical significance

4. **Result Collection**
   - Results are collected in standardized JSON format
   - The `RESULTS_JSON:` marker is used to extract the results

## Mock Structure

The test suite uses mocks to simulate:

1. The VS Code API
2. GitHub Copilot Chat API
3. File system operations
4. Child process execution

## Coverage Reporting

Code coverage is automatically generated when running tests. Coverage reports include:

- Statement coverage
- Branch coverage
- Function coverage
- Line coverage

## Continuous Integration

Tests are run automatically on pull requests and commits to main branches.

## Test Utilities

Several utility functions are available for testing:

- `MockOutputChannel` - Simulates a VS Code output channel
- `simulateCompleteAnalysis` - Simulates a complete analysis cycle 
- `nextTick` - Wait for the next event loop tick
- `wait` - Wait for a specified number of milliseconds 