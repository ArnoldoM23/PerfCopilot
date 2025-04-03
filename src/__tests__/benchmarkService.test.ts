/**
 * Tests for BenchmarkService
 */

import { BenchmarkService } from '../services/benchmarkService';
import { MockOutputChannel } from './mocks';
import * as utils from '../utils/functions';

// Mock the vscode namespace
jest.mock('vscode', () => ({
  window: {
    createOutputChannel: jest.fn()
  }
}), { virtual: true });

// Mock the filesystem module
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  writeFileSync: jest.fn(),
  symlinkSync: jest.fn()
}));

// Mock the child_process module
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => ({
    on: jest.fn().mockImplementation((event, callback) => {
      if (event === 'close') {
        callback(0); // Success exit code
      }
      return { on: jest.fn() };
    })
  }))
}));

// Mock the functions
jest.mock('../utils/functions', () => ({
  createTempFile: jest.fn().mockResolvedValue('/tmp/perfcopilot/benchmark.js'),
  runNodeScript: jest.fn().mockResolvedValue('')
}));

describe('BenchmarkService', () => {
  let benchmarkService: BenchmarkService;
  let mockOutputChannel: MockOutputChannel;
  
  // Simple benchmark code for testing
  const benchmarkCode = `
    const benny = require('benny');
    
    function original(arr) {
      return arr.filter((v, i) => arr.indexOf(v) !== i);
    }
    
    function alternative(arr) {
      return [...new Set(arr.filter(item => 
        arr.indexOf(item) !== arr.lastIndexOf(item)
      ))];
    }
    
    const testArray = [1, 2, 3, 1, 4, 2];
    
    benny.suite(
      'Find Duplicates',
      benny.add('original', () => {
        original(testArray);
      }),
      benny.add('alternative', () => {
        alternative(testArray);
      }),
      benny.cycle(),
      benny.complete()
    );
  `;
  
  beforeEach(() => {
    // Create a mock output channel
    mockOutputChannel = new MockOutputChannel('Test');
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Create the service instance
    benchmarkService = new BenchmarkService(mockOutputChannel as any);
    
    // No longer mocking parseBenchmarkResults or parseTextBenchmarkOutput here.
    // Let the actual methods run in the runBenchmark tests below.
    // Individual parsing logic is tested in their own describe blocks.
  });
  
  describe('runBenchmark', () => {
    it('should create a temporary file and run the benchmark', async () => {
      // Setup the runNodeScript mock to return a valid result
      const benchmarkOutput = `
        Find Duplicates
        original x 1,234,567 ops/sec ±0.12% (95 runs sampled)
        alternative x 2,345,678 ops/sec ±0.23% (95 runs sampled)
        Fastest is alternative
      `;
      (utils.runNodeScript as jest.Mock).mockResolvedValue(benchmarkOutput);
      
      // Run the benchmark
      const result = await benchmarkService.runBenchmark(benchmarkCode);
      
      // Verify createTempFile was called with the benchmark code
      expect(utils.createTempFile).toHaveBeenCalledWith(
        benchmarkCode, 
        'perfcopilot-benchmark.js'
      );
      
      // Verify runNodeScript was called with the correct file path
      expect(utils.runNodeScript).toHaveBeenCalledWith('/tmp/perfcopilot/benchmark.js');
      
      // Verify the result has the correct structure
      expect(result).toHaveProperty('fastest');
      expect(result).toHaveProperty('results');
      
      // Verify the fastest implementation was identified
      expect(result.fastest).toBe('alternative');
      
      // Verify the results array contains parsed data for both implementations
      expect(result.results).toHaveLength(2);
      expect(result.results).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'original', ops: 1234567 }),
          expect.objectContaining({ name: 'alternative', ops: 2345678 }),
      ]));
    });
    
    it('should handle JSON formatted results', async () => {
      // Setup the runNodeScript mock to return JSON result
      const jsonOutput = `RESULTS_JSON: { "fastest": "alternative", "results": [{"name": "alternative", "ops": 2345678 }, {"name": "original", "ops": 1234567 }] }`;
      (utils.runNodeScript as jest.Mock).mockResolvedValue(jsonOutput);
      
      // Run the benchmark
      const result = await benchmarkService.runBenchmark(benchmarkCode);
      
      // Verify the result structure directly
      expect(result.fastest).toBe('alternative');
      expect(result.results).toHaveLength(2);
      expect(result.results).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'original', ops: 1234567 }),
          expect.objectContaining({ name: 'alternative', ops: 2345678 }),
      ]));
    });
    
    it('should handle errors during benchmark execution', async () => {
      // Setup the runNodeScript mock to throw an error
      (utils.runNodeScript as jest.Mock).mockRejectedValue(new Error('Execution failed'));
      
      // Test that the benchmark run fails
      await expect(benchmarkService.runBenchmark(benchmarkCode)).rejects.toThrow('Execution failed');
    });
    
    it('should return empty results when no benchmark data is found', async () => {
      // Setup the runNodeScript mock to return invalid output
      (utils.runNodeScript as jest.Mock).mockResolvedValue('No benchmark data');
      
      // Run the benchmark
      const result = await benchmarkService.runBenchmark(benchmarkCode);
      
      // Verify default results are returned
      expect(result.fastest).toBe('Unknown');
      expect(result.results).toHaveLength(0);
    });
  });
  
  describe('parseTextBenchmarkOutput', () => {
    // Use the actual implementation for these tests
    let realParseTextBenchmarkOutput: (output: string) => any;

    beforeEach(() => {
      realParseTextBenchmarkOutput = (benchmarkService as any).parseTextBenchmarkOutput.bind(benchmarkService);
      // Restore the original implementation for this suite
      jest.spyOn(benchmarkService as any, 'parseTextBenchmarkOutput').mockImplementation(((output: string) => realParseTextBenchmarkOutput(output)) as any);
    });

    it('should parse standard benny output correctly', () => {
        const output = `
          Suite Name
            case 1 x 1,234,567 ops/sec ±1.23% (90 runs sampled)
            case 2 x 2,345,678 ops/sec ±0.98% (95 runs sampled)
            case_3 x 999,999 ops/sec ±2.00% (88 runs sampled)
          Fastest is case 2 // This line is ignored by the parser
        `;
        const result = realParseTextBenchmarkOutput(output);
        expect(result.fastest).toBe('case 2'); // Based on highest ops
        expect(result.results).toHaveLength(3);
        expect(result.results).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'case 1', ops: 1234567, margin: 0 }),
          expect.objectContaining({ name: 'case 2', ops: 2345678, margin: 0 }),
          expect.objectContaining({ name: 'case_3', ops: 999999, margin: 0 }),
        ]));
    });

     it('should handle output with only one result', () => {
        const output = `
          Single Case Suite
            only_case x 500,000 ops/sec ±1.50% (92 runs sampled)
          Fastest is only_case // This line is ignored
        `;
        const result = realParseTextBenchmarkOutput(output);
        expect(result.fastest).toBe('only_case'); // Only one result
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toEqual(expect.objectContaining({ name: 'only_case', ops: 500000, margin: 0 }));
    });

    it('should handle output missing the "Fastest is" line', () => {
       const output = `
         Suite Name
           case 1 x 1,000,000 ops/sec ±1.00% (90 runs sampled)
           case 2 x 500,000 ops/sec ±2.00% (90 runs sampled)
         No fastest line here
       `;
       const result = realParseTextBenchmarkOutput(output);
       // It should still parse results, and fastest is determined by ops
       expect(result.results).toHaveLength(2);
       expect(result.fastest).toBe('case 1'); // case 1 has higher ops
       expect(result.results).toEqual(expect.arrayContaining([
         expect.objectContaining({ name: 'case 1', ops: 1000000, margin: 0 }),
         expect.objectContaining({ name: 'case 2', ops: 500000, margin: 0 }),
       ]));
    });

     it('should return empty results for non-matching output', () => {
        const output = `
          Some random text log
          No benchmark results here
        `;
        const result = realParseTextBenchmarkOutput(output);
        expect(result.results).toHaveLength(0);
        expect(result.fastest).toBe('Unknown');
    });

    it('should handle lines that do not match the expected format', () => {
        const output = `
          Mixed Suite
            valid_case x 1,500,000 ops/sec ±1.11% (91 runs sampled)
            malformed line - ignore this
            another_valid x 2,500,000 ops/sec ±0.88% (96 runs sampled)
            Fastest is another_valid // This line is ignored
        `;
        const result = realParseTextBenchmarkOutput(output);
        expect(result.fastest).toBe('another_valid'); // Based on highest ops
        expect(result.results).toHaveLength(2);
        expect(result.results).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'valid_case', ops: 1500000, margin: 0 }),
          expect.objectContaining({ name: 'another_valid', ops: 2500000, margin: 0 }),
        ]));
    });
  });

  describe('parseBenchmarkResults', () => {
     let realParseBenchmarkResults: (output: string) => any;
     let mockParseTextBenchmarkOutput: jest.SpyInstance;
     let mockLog: string[]; // To capture logs

     beforeEach(() => {
        mockLog = []; // Reset log capture
        // Override the outputChannel specifically for these tests
        (benchmarkService as any).outputChannel = {
            appendLine: jest.fn((line: string) => mockLog.push(line)),
            show: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
        };

        realParseBenchmarkResults = (benchmarkService as any).parseBenchmarkResults.bind(benchmarkService);
        mockParseTextBenchmarkOutput = jest.spyOn(benchmarkService as any, 'parseTextBenchmarkOutput').mockReturnValue({
             fastest: 'text_fallback',
             results: [{ name: 'text_fallback', ops: 1000 }]
         });
         // Restore the real implementation for parseBenchmarkResults itself
         jest.spyOn(benchmarkService as any, 'parseBenchmarkResults').mockImplementation(((output: string) => realParseBenchmarkResults(output)) as any);
     });

    it('should prefer valid JSON results when available', () => {
      const output = `
        Some initial output...
        RESULTS_JSON: { "fastest": "jsonFastest", "results": [{"name": "jsonFastest", "ops": 5000}] }
        Some trailing output...
      `;
      const result = realParseBenchmarkResults(output);
      expect(result.fastest).toBe('jsonFastest');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ name: 'jsonFastest', ops: 5000 });
      expect(mockParseTextBenchmarkOutput).not.toHaveBeenCalled();
      // Verify log message for successful JSON parse
      expect(mockLog).toEqual(expect.arrayContaining([
        'Found RESULTS_JSON line. Preparing to parse...',
        expect.stringContaining('--- String to Parse as JSON ---'),
        'Successfully parsed benchmark JSON.'
      ]));
    });

    it('should fall back to text parsing when JSON marker exists but JSON is invalid', () => {
      const output = `
        Some text...
        RESULTS_JSON: { invalid json ]
        More text...
         benchmark_case x 1,000 ops/sec ±1.00% (90 runs sampled)
         Fastest is benchmark_case
      `;
       const result = realParseBenchmarkResults(output);
       // Should have logged an error about invalid JSON
       // Use mockLog to check for the specific log message
       expect(mockLog).toEqual(expect.arrayContaining([
         'Found RESULTS_JSON line. Preparing to parse...',
         expect.stringContaining('--- String to Parse as JSON ---'),
         expect.stringContaining('Error parsing benchmark results JSON:'),
         expect.stringContaining('--- Failed JSON String ---'),
         'Attempting to parse benchmark results using text format...',
         'Successfully parsed benchmark results from text output.' // Since the mock returns results
       ]));
       // Should have fallen back to the text parser mock
       expect(mockParseTextBenchmarkOutput).toHaveBeenCalledWith(output);
       expect(result.fastest).toBe('text_fallback');
       expect(result.results).toEqual([{ name: 'text_fallback', ops: 1000 }]);
    });

    it('should use text parsing when JSON marker is not present', () => {
        const output = `
         Regular benny output
           case_a x 1,000 ops/sec ±1.00% (90 runs sampled)
           case_b x 2,000 ops/sec ±0.50% (95 runs sampled)
         Fastest is case_b
        `;
        const result = realParseBenchmarkResults(output);
        // Should have logged fallback and text parsing attempt
        expect(mockLog).toEqual(expect.arrayContaining([
            'RESULTS_JSON line not found. Falling back to text parsing.',
            'Attempting to parse benchmark results using text format...',
            'Successfully parsed benchmark results from text output.'
        ]));
        // Should have used the text parser mock
        expect(mockParseTextBenchmarkOutput).toHaveBeenCalledWith(output);
        expect(result.fastest).toBe('text_fallback'); // As per the mock
        expect(result.results).toEqual([{ name: 'text_fallback', ops: 1000 }]);
    });
  });
}); 