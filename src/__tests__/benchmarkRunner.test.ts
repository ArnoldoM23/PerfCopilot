import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
// import { spawn } from 'child_process'; // Keep commented out for now
import * as vm from 'vm'; // Keep vm import for now
import * as benny from 'benny'; // Keep benny import for now
import { spawn } from 'child_process'; // Restore spawn

// Resolve the path to the benchmark runner script relative to the project root
// CRITICAL: Determine project root for correct module resolution in spawned process
const projectRoot = path.resolve(__dirname, '../../'); // Assumes tests are in out/__tests__
const runnerScriptPath = path.resolve(projectRoot, 'out/utils/benchmarkRunner.js'); // Explicit path to compiled JS

/**
 * Helper function to run the benchmarkRunner.js script as a child process.
 * Creates a temporary module file with the provided test data and implementations
 * within the project's .test-temp directory.
 * 
 * @param testData - The testData to include in the module.
 * @param implementations - An object mapping implementation names to code strings.
 * @returns A promise resolving to an object with { stdout, stderr, exitCode }.
 */
async function runRunnerScript(testData: any, implementations: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number | null }> { // Restore exitCode type
    const benchmarkModuleCode = `
const testData = ${JSON.stringify(testData, null, 2)};
const implementations = {
${Object.entries(implementations).map(([key, code]) => 
    `  ${JSON.stringify(key)}: ${JSON.stringify(code)}`).join(',\n')}
};

module.exports = {
    testData,
    implementations
};
    `;

    let tempFilePath: string | undefined;
    let tmpDir: string | undefined;
    // Remove VM-specific variables
    // let stdout = '';
    // let stderr = '';
    // let exitCode = 0; 
    // let vmExitCode: number | null = null; 

    try {
        // Create temp dir within project root for better cross-process access
        tmpDir = path.join(projectRoot, '.test-temp'); 
        await fs.mkdir(tmpDir, { recursive: true }); // Ensure directory exists
        // Generate a unique filename within the temp dir
        const tempFileName = `test-funcs-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.js`;
        tempFilePath = path.join(tmpDir, tempFileName);
        await fs.writeFile(tempFilePath, benchmarkModuleCode);

        if (!tempFilePath) { 
            throw new Error("Temporary file path could not be determined.");
        }
        // Use the RELATIVE path from projectRoot for the child process argument - REVERT
        // const relativeTempPath = path.relative(projectRoot, tempFilePath);
        // USE ABSOLUTE PATH INSTEAD
        const absoluteTempPath = tempFilePath; 

        console.log(`[runRunnerScript spawn] Using absolute temp path: ${absoluteTempPath}`);

        // Restore spawn logic
        return new Promise((resolve, reject) => {
            const child = spawn('node', 
                [runnerScriptPath, absoluteTempPath], // Pass runner script and ABSOLUTE temp path
                { cwd: projectRoot } // Set working directory to project root
            );
            
            if (!child) {
                return reject(new Error("Failed to spawn child process."));
            }

            let stdout = '';
            let stderr = '';

            if (child.stdout) {
                child.stdout.on('data', (data: Buffer | string) => stdout += data.toString());
            }
            if (child.stderr) {
                child.stderr.on('data', (data: Buffer | string) => stderr += data.toString());
            }

            child.on('close', (code: number | null) => {
                if (code !== 0) {
                    console.error(`[runRunnerScript spawn] Script exited with code ${code}.`);
                    console.error(`[runRunnerScript spawn] STDERR:\n${stderr}`);
                    console.error(`[runRunnerScript spawn] STDOUT:\n${stdout}`);
                }
                resolve({ stdout, stderr, exitCode: code });
            });

            child.on('error', (err: Error) => {
                console.error("[runRunnerScript spawn] Child process error:", err); 
                reject(err); 
            });
        });

        // --- Remove VM Execution Logic --- 
        /*
        const context = {
           // ... removed vm context ...
        };

        const script = new vm.Script(runnerScriptContent, { filename: runnerScriptPath });
        console.log(`[runRunnerScript vm] Executing script: ${runnerScriptPath} with temp file: ${finalTempFilePath}`);

        try {
             script.runInNewContext(context, { timeout: 30000 }); // Increased timeout
            // ... removed vm execution and exit code handling ...
        } catch (err: any) {
            // ... removed vm error handling ...
        }
        
         exitCode = vmExitCode ?? 1; 
         console.log(`[runRunnerScript vm] Execution finished. Final exit code: ${exitCode}`);
         console.log(`[runRunnerScript vm] STDOUT:\n${stdout}`);
         console.log(`[runRunnerScript vm] STDERR:\n${stderr}`);
         return { stdout, stderr, exitCode };
        */
        // --- End Remove VM Execution Logic ---

    } finally {
        // Add a small delay before cleanup to give the child process time to read the file
        await new Promise(resolve => setTimeout(resolve, 250)); // Increased from 100ms to 250ms

        // Cleanup the temporary file (leave directory for simplicity or clean later)
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error(`Error unlinking temporary file ${tempFilePath}:`, unlinkError);
            }
        }
        // Optional: Cleanup tmpDir itself, perhaps in a global Jest teardown
    }
}


describe('Benchmark Runner Script Integration Tests', () => {

    // Timeout needed for child process
    jest.setTimeout(20000); // 20 seconds

    // Optional: Add a beforeAll/afterAll to manage the .test-temp directory
    beforeAll(async () => {
        // Ensure the temp dir exists before tests start
        await fs.mkdir(path.join(projectRoot, '.test-temp'), { recursive: true });
    });

    afterAll(async () => {
        // Clean up the temp directory after all tests in this suite run
        try {
             await fs.rm(path.join(projectRoot, '.test-temp'), { recursive: true, force: true });
             console.log('[afterAll] Cleaned up .test-temp directory.');
        } catch (rmError) {
            console.error('[afterAll] Error cleaning up .test-temp:', rmError);
        }
    });

    it('should execute successfully with array testData (processNumbers style)', async () => {
        const testData = [1, 2, 3];
        const implementations = {
            'Original': 'function Original(arr) { return arr.reduce((a, b) => a + b, 0); }'
        };
        
        const result = await runRunnerScript(testData, implementations);

        // Verify successful exit code
        expect(result.exitCode).toBe(0);
        
        // Verify argument determination log
        expect(result.stdout).toContain('[BenchmarkRunner] Determined argsForRun: [[1,2,3]]');

        // Verify compilation log
        expect(result.stdout).toContain('[BenchmarkRunner] Successfully compiled: Original');

        // Verify Benny output format (cycle/complete)
        expect(result.stdout).toMatch(/^cycle:\s*Name:\s*Original,\s*Ops:\s*[\d.]+/m);
        expect(result.stdout).toMatch(/^complete:\s*Fastest is\s*Original/m);
        
        // Verify no benchmark errors logged to stderr
        expect(result.stderr).not.toContain('BENCHMARK_ERROR');
        expect(result.stderr).not.toContain('BENCHMARK_EXECUTION_ERROR');
        expect(result.stderr).not.toContain('BENCHMARK_ITERATION_ERROR');
    });

    it('should execute successfully with object testData (findAllMatching... style)', async () => {
        const testData = { 
            indexMapping: { tree: 'a' }, 
            resolutionInfo: { path: ['x'], experiments: ['y'] } 
        };
        const implementations = {
            'Original': 'function Original(im, ri) { return im.tree + ri.path[0]; }'
        };

        const result = await runRunnerScript(testData, implementations);

        expect(result.exitCode).toBe(0);
        
        // Verify argument determination log for the specific structure
        expect(result.stdout).toContain('[BenchmarkRunner] Determined argsForRun: [{\"tree\":\"a\"},{\"path\":[\"x\"],\"experiments\":[\"y\"]}]');

        expect(result.stdout).toContain('[BenchmarkRunner] Successfully compiled: Original');

        // Verify Benny output format (cycle/complete)
        expect(result.stdout).toMatch(/^cycle:\s*Name:\s*Original,\s*Ops:\s*[\d.]+/m);
        expect(result.stdout).toMatch(/^complete:\s*Fastest is\s*Original/m);

        // REMOVE: expect(result.stderr).toEqual(''); // Stderr now contains summary logs
    });

    it('should execute successfully with primitive testData', async () => {
        const testData = 10;
        const implementations = {
            'Original': 'function Original(n) { return n * n; }'
        };

        const result = await runRunnerScript(testData, implementations);

        expect(result.exitCode).toBe(0);
        
        // Verify argument determination log
        expect(result.stdout).toContain('[BenchmarkRunner] Determined argsForRun: [10]');

        expect(result.stdout).toContain('[BenchmarkRunner] Successfully compiled: Original');

        // Verify Benny output format (cycle/complete)
        expect(result.stdout).toMatch(/^cycle:\s*Name:\s*Original,\s*Ops:\s*[\d.]+/m);
        expect(result.stdout).toMatch(/^complete:\s*Fastest is\s*Original/m);
        
        // REMOVE: expect(result.stderr).toEqual(''); // Stderr now contains summary logs
    });

    // TODO: Add tests for failure cases (missing file, invalid module, compile error, etc.)

}); 