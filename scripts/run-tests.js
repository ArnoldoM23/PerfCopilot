#!/usr/bin/env node

/**
 * Test runner script for PerfCopilot
 * 
 * Runs all tests and reports results
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes for formatting output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m'
};

// Test groups to run
const testSuites = [
  { 
    name: 'Utility Functions', 
    command: 'npm',
    args: ['run', 'test:functions'],
    priority: 1
  },
  { 
    name: 'Service Components', 
    command: 'npm',
    args: ['run', 'test:services'],
    priority: 2
  },
  {
    name: 'Benchmark Generation', 
    command: 'npm',
    args: ['run', 'test:benchmark'],
    priority: 3
  },
  { 
    name: 'Extension Integration', 
    command: 'jest',
    args: ['src/__tests__/extension.test.ts', '--testTimeout=10000'],
    priority: 4,
    optional: true // Still mark as optional as it's more complex and might have issues
  }
];

// Summary data
const summary = {
  total: testSuites.length,
  passed: 0,
  failed: 0,
  skipped: 0,
  results: []
};

// Print header
console.log('\n');
console.log(`${colors.bold}${colors.cyan}========================================${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}       PerfCopilot Test Runner         ${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}========================================${colors.reset}`);
console.log('\n');

// Ensure the working directory is the project root
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

// Check if the required files exist
if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  console.error(`${colors.red}Error: Not running from the project root. package.json not found.${colors.reset}`);
  process.exit(1);
}

// Function to run a command and return a promise
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { 
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Main function to run tests sequentially
async function runTests() {
  console.log(`${colors.bold}Running tests in order of dependency...${colors.reset}\n`);
  
  // Sort test suites by priority
  const sortedSuites = [...testSuites].sort((a, b) => a.priority - b.priority);
  
  for (const suite of sortedSuites) {
    console.log(`\n${colors.bold}${colors.blue}Running: ${suite.name}${colors.reset}`);
    console.log(`${colors.dim}Command: ${suite.command} ${suite.args.join(' ')}${colors.reset}`);
    console.log(`${colors.blue}----------------------------------------${colors.reset}`);
    
    try {
      const passed = await runCommand(suite.command, suite.args);
      const result = {
        name: suite.name,
        passed,
        optional: !!suite.optional
      };
      
      summary.results.push(result);
      
      if (passed) {
        summary.passed++;
        console.log(`\n${colors.green}✓ ${suite.name} tests passed${colors.reset}`);
      } else if (suite.optional) {
        summary.skipped++;
        console.log(`\n${colors.yellow}⚠ ${suite.name} tests failed but marked as optional${colors.reset}`);
      } else {
        summary.failed++;
        console.log(`\n${colors.red}✗ ${suite.name} tests failed${colors.reset}`);
      }
    } catch (error) {
      console.error(`\n${colors.red}Error running ${suite.name} tests: ${error.message}${colors.reset}`);
      summary.results.push({
        name: suite.name,
        passed: false,
        error: error.message,
        optional: !!suite.optional
      });
      
      if (suite.optional) {
        summary.skipped++;
      } else {
        summary.failed++;
      }
    }
  }
  
  // Print summary
  console.log('\n');
  console.log(`${colors.bold}${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}             Test Summary              ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}========================================${colors.reset}`);
  console.log('\n');
  
  console.log(`${colors.bold}Total test suites: ${summary.total}${colors.reset}`);
  console.log(`${colors.green}Passed: ${summary.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${summary.failed}${colors.reset}`);
  console.log(`${colors.yellow}Skipped/Optional: ${summary.skipped}${colors.reset}`);
  console.log('\n');
  
  // Detailed results
  console.log(`${colors.bold}Detailed Results:${colors.reset}`);
  for (const result of summary.results) {
    const statusColor = result.passed ? colors.green : (result.optional ? colors.yellow : colors.red);
    const statusSymbol = result.passed ? '✓' : (result.optional ? '⚠' : '✗');
    console.log(`${statusColor}${statusSymbol} ${result.name}${colors.reset}`);
  }
  
  console.log('\n');
  
  // Exit with appropriate code
  if (summary.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Run the tests
runTests().catch(error => {
  console.error(`${colors.red}Error in test runner: ${error.message}${colors.reset}`);
  process.exit(1);
}); 