import * as vscode from 'vscode';
import benny from 'benny';

// Create an output channel for logging
let outputChannel: vscode.OutputChannel;

// Define types for Benny benchmark results
interface BenchmarkResult {
    name: string;
    hz: number;
    runs: number[];
    samples: number;
}

interface BenchmarkSuite {
    results: {
        results: BenchmarkResult[];
    };
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize the output channel
    outputChannel = vscode.window.createOutputChannel('PerfCopilot');
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('PerfCopilot extension activated');

    let disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        outputChannel.appendLine('\n--- Starting Performance Analysis ---');
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            const message = 'No active editor found';
            outputChannel.appendLine(`Error: ${message}`);
            vscode.window.showErrorMessage(message);
            return;
        }

        const selection = editor.selection;
        const originalFunction = editor.document.getText(selection);
        
        if (!originalFunction) {
            const message = 'Please select a function to analyze';
            outputChannel.appendLine(`Error: ${message}`);
            vscode.window.showErrorMessage(message);
            return;
        }

        try {
            outputChannel.appendLine(`Selected function: ${originalFunction.substring(0, 100)}${originalFunction.length > 100 ? '...' : ''}`);
            
            // Create a webview panel
            outputChannel.appendLine('Creating webview panel');
            const panel = vscode.window.createWebviewPanel(
                'functionAnalysis',
                'Function Performance Analysis',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true
                }
            );

            // Show loading message
            panel.webview.html = getLoadingContent();
            outputChannel.appendLine('Loading view displayed');
            
            // Get alternative implementations from Copilot
            outputChannel.appendLine('Getting alternative implementations from Copilot');
            
            // Create a temporary file with the original function and prompts for alternatives
            const tempDoc = await vscode.workspace.openTextDocument({
                content: `// Original function:
${originalFunction}

// TODO: Generate a more performant implementation focusing on algorithmic optimization
function alternative1() {
    // Your implementation here
}

// TODO: Generate another implementation using different language features
function alternative2() {
    // Your implementation here
}`,
                language: 'javascript'
            });

            // Get Copilot suggestions for both alternative implementations
            const firstAlternative = await getCopilotSuggestion(tempDoc, 6); // Line after first TODO
            const secondAlternative = await getCopilotSuggestion(tempDoc, 11); // Line after second TODO
            
            outputChannel.appendLine('Alternatives generated');
            
            // Run performance tests
            outputChannel.appendLine('Starting performance tests');
            
            // Create a status bar item to show progress
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            statusBarItem.text = "$(sync~spin) Running performance tests...";
            statusBarItem.show();
            
            try {
                const results = await runPerformanceTestsThree(originalFunction, firstAlternative, secondAlternative);
                outputChannel.appendLine('Performance tests completed successfully');
                
                // Get Copilot's analysis by creating another temporary document
                const analysisDoc = await vscode.workspace.openTextDocument({
                    content: `// Analyze the performance characteristics of these three implementations:
/*
Original Function:
${originalFunction}

Alternative 1:
${firstAlternative}

Alternative 2:
${secondAlternative}

Benchmark Results:
Original: ${(results.results.results[0] as BenchmarkResult).hz} ops/sec
Alternative 1: ${(results.results.results[1] as BenchmarkResult).hz} ops/sec
Alternative 2: ${(results.results.results[2] as BenchmarkResult).hz} ops/sec
*/

// TODO: Explain the performance differences considering:
// 1. Algorithmic complexity
// 2. Memory usage
// 3. JavaScript engine optimizations
`,
                    language: 'javascript'
                });

                const analysis = await getCopilotSuggestion(analysisDoc, analysisDoc.lineCount - 1);
                
                // Update webview content with results and analysis
                panel.webview.html = getWebviewContentWithAnalysis(results, analysis);
                outputChannel.appendLine('Results displayed in webview');
            } catch (error) {
                outputChannel.appendLine(`Error during performance tests: ${error}`);
                panel.webview.html = getErrorContent(String(error), originalFunction, firstAlternative + "\n\n" + secondAlternative);
                vscode.window.showErrorMessage(`Error running performance tests: ${error}`);
            } finally {
                statusBarItem.dispose();
            }
            
            // Show the panel
            panel.reveal(vscode.ViewColumn.Two);
        } catch (error) {
            outputChannel.appendLine(`Unexpected error: ${error}`);
            vscode.window.showErrorMessage(`Error analyzing function: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
    
    // Add a command to show the output channel
    let showLogsCommand = vscode.commands.registerCommand('perfcopilot.showLogs', () => {
        outputChannel.show();
    });
    
    context.subscriptions.push(showLogsCommand);
}

async function getCopilotSuggestion(document: vscode.TextDocument, line: number): Promise<string> {
    // Get the Copilot extension
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilot) {
        throw new Error('GitHub Copilot extension is not installed');
    }

    // Make sure Copilot is activated
    if (!copilot.isActive) {
        await copilot.activate();
    }

    // Get suggestions from Copilot
    const position = new vscode.Position(line, 0);
    const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        position
    );

    if (!suggestions || suggestions.items.length === 0) {
        throw new Error('No suggestions received from Copilot');
    }

    // Return the first suggestion
    return suggestions.items[0].insertText?.toString() || '';
}

async function generateSimpleAlternative(originalFunction: string): Promise<string> {
    try {
        // Extract function name and signature
        const functionNameMatch = originalFunction.match(/function\s+(\w+)\s*\(/);
        const functionName = functionNameMatch ? functionNameMatch[1] : 'anonymousFunction';
        
        // Check if it's a for loop implementation
        if (originalFunction.includes('for (') || originalFunction.includes('for(')) {
            // If it's a for loop, suggest using reduce, map, filter, etc.
            if (originalFunction.includes('array') || originalFunction.includes('arr')) {
                // If it's summing an array
                if (originalFunction.includes('sum') || originalFunction.includes('+=')) {
                    return `// Alternative implementation using reduce
function alternative${functionName}(arr) {
    return arr.reduce((sum, item) => sum + item, 0);
}`;
                }
                // If it's filtering or finding elements
                else if (originalFunction.includes('if (') || originalFunction.includes('if(')) {
                    return `// Alternative implementation using filter
function alternative${functionName}(arr) {
    return arr.filter(item => {
        // Add your condition here - this is a basic version that mimics the original function
        return item !== undefined;
    });
}`;
                }
            }
            
            // For string processing
            if (originalFunction.includes('str') || originalFunction.includes('string')) {
                return `// Alternative implementation for string processing
function alternative${functionName}(str) {
    // Using more direct string methods
    const result = str.split('').reduce((acc, char) => {
        // This is a simplified example - modify based on what the original function does
        acc[char] = (acc[char] || 0) + 1;
        return acc;
    }, {});
    
    return Object.keys(result).find(key => result[key] === 1) || null;
}`;
            }
        }
        
        // If we can't determine a good alternative, provide a simple variant
        // with a note that it's basically the same algorithm
        return `// Alternative implementation of ${functionName}
// Note: This is functionally similar to the original, but with slight syntax changes
function alternative${functionName}(${getParametersFrom(originalFunction)}) {
    ${getFunctionBodyFrom(originalFunction).replace('for (', 'for (')}
}`;
    } catch (error) {
        outputChannel.appendLine(`Error generating alternative: ${error}`);
        throw new Error(`Failed to generate alternative implementation: ${error}`);
    }
}

function getParametersFrom(functionStr: string): string {
    const match = functionStr.match(/function\s+\w+\s*\(([^)]*)\)/);
    return match ? match[1] : 'arr';
}

function getFunctionBodyFrom(functionStr: string): string {
    try {
        // Extract everything between the first { and the last }
        const bodyMatch = functionStr.match(/\{([\s\S]*)\}$/);
        if (bodyMatch && bodyMatch[1]) {
            return bodyMatch[1].trim();
        }
    } catch (error) {
        outputChannel.appendLine(`Error extracting function body: ${error}`);
    }
    
    return '// Could not extract function body\n    return null;';
}

function getLoadingContent(): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                .container { max-width: 800px; margin: 0 auto; text-align: center; margin-top: 100px; }
                .loader { border: 5px solid #f3f3f3; border-radius: 50%; border-top: 5px solid #3498db; width: 50px; height: 50px; animation: spin 2s linear infinite; margin: 0 auto; margin-bottom: 20px; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="loader"></div>
                <h2>Running performance tests...</h2>
                <p>Please wait while we benchmark the functions.</p>
                <p>If this takes too long, check the output logs for details.</p>
                <p><small>You can view logs by running the "PerfCopilot: Show Logs" command</small></p>
            </div>
        </body>
        </html>
    `;
}

function getErrorContent(error: string, originalFunction: string, alternativeFunction: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                .container { max-width: 800px; margin: 0 auto; }
                .error-card { background: #ffeeee; padding: 20px; border-radius: 8px; border: 1px solid #ff6666; margin-bottom: 20px; }
                .code-block { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; margin-top: 10px; }
                .function-card { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Error Running Performance Tests</h1>
                
                <div class="error-card">
                    <h2>Error Details</h2>
                    <p>${escapeHtml(error)}</p>
                    <p>Check the "PerfCopilot" output channel for more details.</p>
                </div>
                
                <div class="function-card">
                    <h2>Original Function</h2>
                    <pre class="code-block">${escapeHtml(originalFunction)}</pre>
                </div>

                <div class="function-card">
                    <h2>Alternative Function</h2>
                    <pre class="code-block">${escapeHtml(alternativeFunction)}</pre>
                </div>
                
                <h2>Possible Issues</h2>
                <ul>
                    <li>The function may require arguments to run</li>
                    <li>The function may have dependencies on external variables</li>
                    <li>There might be syntax errors in one of the implementations</li>
                    <li>The function might be causing an infinite loop</li>
                </ul>
                
                <h2>Suggestions</h2>
                <ul>
                    <li>Make sure your function is self-contained</li>
                    <li>Try a simpler function for testing</li>
                    <li>Check for syntax errors</li>
                    <li>Add sample inputs to your function</li>
                </ul>
            </div>
        </body>
        </html>
    `;
}

// Helper function to safely evaluate function strings
function evalFunctionSafely(funcStr: string): Function {
    try {
        // Check if it's a complete function declaration
        if (funcStr.trim().startsWith('function')) {
            // Extract function name
            const nameMatch = funcStr.match(/function\s+([^(]+)/);
            const funcName = nameMatch ? nameMatch[1].trim() : 'anonymousFunc';
            
            // Replace ES6+ features with ES5 equivalents for better compatibility
            let processedCode = funcStr
                .replace(/const\s+/g, 'var ')
                .replace(/let\s+/g, 'var ');
                
            // Handle arrow functions by converting them to regular functions
            processedCode = processedCode.replace(/\(([^)]*)\)\s*=>\s*{/g, "function($1) {");
            processedCode = processedCode.replace(/\(([^)]*)\)\s*=>\s*([^{].*?)(;|\n|$)/g, "function($1) { return $2; }");
            
            // Create a wrapper function that executes the code in a safer context
            return new Function(`
                try {
                    ${processedCode}
                    return typeof ${funcName} === 'function' ? ${funcName} : function() { return null; };
                } catch (e) {
                    console.error("Error evaluating function:", e);
                    return function() { return null; };
                }
            `)();
        } else {
            outputChannel.appendLine("Function string does not start with 'function' keyword");
            // Try to wrap it in a function if it doesn't start with function
            return new Function(`
                try {
                    function wrappedFunction() {
                        ${funcStr}
                    }
                    return wrappedFunction;
                } catch (e) {
                    console.error("Error evaluating wrapped function:", e);
                    return function() { return null; };
                }
            `)();
        }
    } catch (error) {
        outputChannel.appendLine(`Error in evalFunctionSafely: ${error}`);
        // Return a dummy function that doesn't throw
        return function() { return null; };
    }
}

async function runPerformanceTests(originalFunction: string, alternativeFunction: string) {
    outputChannel.appendLine('Preparing to run performance tests');
    
    try {
        // Wrap function creation in a timeout to catch potential syntax errors
        outputChannel.appendLine('Creating test functions');
        
        // Create a safer evaluation environment that supports modern JS
        const evalFunctionSafely = (funcStr: string): Function => {
            try {
                // Check if it's a complete function declaration
                if (funcStr.trim().startsWith('function')) {
                    // Extract function name
                    const nameMatch = funcStr.match(/function\s+([^(]+)/);
                    const funcName = nameMatch ? nameMatch[1].trim() : 'anonymousFunc';
                    
                    // Replace ES6+ features with ES5 equivalents for better compatibility
                    let processedCode = funcStr
                        .replace(/const\s+/g, 'var ')
                        .replace(/let\s+/g, 'var ');
                        
                    // Handle arrow functions by converting them to regular functions
                    processedCode = processedCode.replace(/\(([^)]*)\)\s*=>\s*{/g, "function($1) {");
                    processedCode = processedCode.replace(/\(([^)]*)\)\s*=>\s*([^{].*?)(;|\n|$)/g, "function($1) { return $2; }");
                    
                    // Create a wrapper function that executes the code in a safer context
                    return new Function(`
                        try {
                            ${processedCode}
                            return typeof ${funcName} === 'function' ? ${funcName} : function() { return null; };
                        } catch (e) {
                            console.error("Error evaluating function:", e);
                            return function() { return null; };
                        }
                    `)();
                } else {
                    outputChannel.appendLine("Function string does not start with 'function' keyword");
                    // Try to wrap it in a function if it doesn't start with function
                    return new Function(`
                        try {
                            function wrappedFunction() {
                                ${funcStr}
                            }
                            return wrappedFunction;
                        } catch (e) {
                            console.error("Error evaluating wrapped function:", e);
                            return function() { return null; };
                        }
                    `)();
                }
            } catch (error) {
                outputChannel.appendLine(`Error in evalFunctionSafely: ${error}`);
                // Return a dummy function that doesn't throw
                return function() { return null; };
            }
        };
        
        let originalFn, alternativeFn;
        
        try {
            outputChannel.appendLine('Creating original function');
            originalFn = evalFunctionSafely(originalFunction);
        } catch (error) {
            outputChannel.appendLine(`Error creating original function: ${error}`);
            throw new Error(`Error in original function: ${error}`);
        }
        
        try {
            outputChannel.appendLine('Creating alternative function');
            alternativeFn = evalFunctionSafely(alternativeFunction);
        } catch (error) {
            outputChannel.appendLine(`Error creating alternative function: ${error}`);
            throw new Error(`Error in alternative function: ${error}`);
        }
        
        // Verify functions are callable
        outputChannel.appendLine('Verifying functions are callable');
        if (typeof originalFn !== 'function') {
            outputChannel.appendLine('Original function is not callable');
            throw new Error('Original code did not return a function');
        }
        
        if (typeof alternativeFn !== 'function') {
            outputChannel.appendLine('Alternative function is not callable');
            throw new Error('Alternative code did not return a function');
        }
        
        // Create a sample input to test the functions
        outputChannel.appendLine('Testing functions with sample input');
        let sampleArg: any = [];
        
        // If this is an array function, create a sample array
        if (originalFunction.includes('arr') || originalFunction.includes('array')) {
            sampleArg = [1, 2, 3, 4, 5];
        } else if (originalFunction.includes('str') || originalFunction.includes('string')) {
            sampleArg = 'test';
        } else if (originalFunction.includes('num') || originalFunction.includes('number')) {
            sampleArg = 42;
        } else if (originalFunction.includes('obj') || originalFunction.includes('object')) {
            sampleArg = { test: 'value' };
        }
        
        // Try to run the functions once to check for runtime errors
        try {
            outputChannel.appendLine('Testing original function execution');
            originalFn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Error running original function with sample input: ${error}`);
            // Continue anyway, as the benchmark will attempt to run the function
        }
        
        try {
            outputChannel.appendLine('Testing alternative function execution');
            alternativeFn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Error running alternative function with sample input: ${error}`);
            // Continue anyway, as the benchmark will attempt to run the function
        }

        // Run benchmarks with a timeout
        outputChannel.appendLine('Running Benny benchmarks');
        
        // Set a timer to report if the benchmark is taking too long
        const timeoutWarning = setTimeout(() => {
            outputChannel.appendLine('WARNING: Benchmark is taking longer than expected. It might be stuck.');
        }, 5000);
        
        const results = await benny.suite(
            'Function Performance Comparison',
            benny.add('Original Function', () => originalFn(sampleArg)),
            benny.add('Alternative Function', () => alternativeFn(sampleArg)),
            benny.cycle((event: any) => {
                outputChannel.appendLine(`Cycle completed: ${event.target}`);
            }),
            benny.complete((complete) => {
                outputChannel.appendLine(`Benchmark completed: ${complete.results.length} results`);
            })
        );
        
        // Clear the timeout warning
        clearTimeout(timeoutWarning);
        
        outputChannel.appendLine('Benchmark completed successfully');
        outputChannel.appendLine(`Results: ${JSON.stringify(results, null, 2)}`);

        return {
            originalFunction,
            alternativeFunction,
            results
        };
    } catch (error) {
        outputChannel.appendLine(`Error in performance tests: ${error}`);
        throw new Error(`Failed to run performance tests: ${error}`);
    }
}

function getWebviewContent(data: any): string {
    outputChannel.appendLine('Creating webview content with results');
    
    try {
        const results = data.results.results;
        
        if (!results || !Array.isArray(results) || results.length < 2) {
            outputChannel.appendLine(`Invalid results structure: ${JSON.stringify(data.results)}`);
            throw new Error('Invalid benchmark results');
        }
        
        const originalResult = results.find((r: any) => r.name === 'Original Function');
        const alternativeResult = results.find((r: any) => r.name === 'Alternative Function');
        
        if (!originalResult || !alternativeResult) {
            outputChannel.appendLine(`Could not find results for both functions: ${JSON.stringify(results)}`);
            throw new Error('Missing benchmark results');
        }
        
        const originalOps = originalResult.hz;
        const alternativeOps = alternativeResult.hz;
        
        const fastestFunction = originalOps > alternativeOps ? 'Original Function' : 'Alternative Function';
        const performanceDiff = ((Math.max(originalOps, alternativeOps) - Math.min(originalOps, alternativeOps)) / 
                                Math.min(originalOps, alternativeOps) * 100).toFixed(2);
        
        outputChannel.appendLine(`Original ops: ${originalOps}, Alternative ops: ${alternativeOps}`);
        outputChannel.appendLine(`Fastest: ${fastestFunction}, Difference: ${performanceDiff}%`);

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .result-card { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .winner { border: 2px solid #4CAF50; }
                    .code-block { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; }
                    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
                    .stat-item { background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Function Performance Analysis</h1>
                    
                    <div class="result-card ${fastestFunction === 'Original Function' ? 'winner' : ''}">
                        <h2>Original Function</h2>
                        <pre class="code-block">${escapeHtml(data.originalFunction)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${originalOps.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>

                    <div class="result-card ${fastestFunction === 'Alternative Function' ? 'winner' : ''}">
                        <h2>Alternative Function</h2>
                        <pre class="code-block">${escapeHtml(data.alternativeFunction)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${alternativeOps.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>

                    <div class="result-card">
                        <h2>Performance Summary</h2>
                        <p>The ${fastestFunction} is ${performanceDiff}% faster.</p>
                        <p>This difference could be due to:</p>
                        <ul>
                            <li>Different algorithmic approaches</li>
                            <li>Optimized data structures</li>
                            <li>Reduced computational complexity</li>
                            <li>Better memory usage patterns</li>
                        </ul>
                    </div>
                </div>
            </body>
            </html>
        `;
    } catch (error) {
        outputChannel.appendLine(`Error creating webview content: ${error}`);
        return getErrorContent(`Error rendering results: ${error}`, data.originalFunction, data.alternativeFunction);
    }
}

function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function deactivate() {
    outputChannel.appendLine('PerfCopilot extension deactivated');
}

async function runPerformanceTestsThree(originalFunction: string, firstAlternative: string, secondAlternative: string) {
    outputChannel.appendLine('Preparing to run performance tests for three implementations');
    
    try {
        // Prepare safe test functions
        outputChannel.appendLine('Creating test functions');
        
        let originalFn, alternative1Fn, alternative2Fn;
        
        try {
            outputChannel.appendLine('Creating original function');
            originalFn = evalFunctionSafely(originalFunction);
        } catch (error) {
            outputChannel.appendLine(`Error creating original function: ${error}`);
            throw new Error(`Error in original function: ${error}`);
        }
        
        try {
            outputChannel.appendLine('Creating first alternative function');
            alternative1Fn = evalFunctionSafely(firstAlternative);
        } catch (error) {
            outputChannel.appendLine(`Error creating first alternative function: ${error}`);
            throw new Error(`Error in first alternative function: ${error}`);
        }
        
        try {
            outputChannel.appendLine('Creating second alternative function');
            alternative2Fn = evalFunctionSafely(secondAlternative);
        } catch (error) {
            outputChannel.appendLine(`Error creating second alternative function: ${error}`);
            throw new Error(`Error in second alternative function: ${error}`);
        }
        
        // Verify functions are callable
        outputChannel.appendLine('Verifying functions are callable');
        if (typeof originalFn !== 'function') {
            outputChannel.appendLine('Original function is not callable');
            throw new Error('Original code did not return a function');
        }
        
        if (typeof alternative1Fn !== 'function') {
            outputChannel.appendLine('First alternative function is not callable');
            throw new Error('First alternative code did not return a function');
        }
        
        if (typeof alternative2Fn !== 'function') {
            outputChannel.appendLine('Second alternative function is not callable');
            throw new Error('Second alternative code did not return a function');
        }
        
        // Create sample input based on function characteristics
        outputChannel.appendLine('Creating sample input');
        let sampleArg: any = [];
        
        // If this is an array function, create a sample array
        if (originalFunction.includes('arr') || originalFunction.includes('array')) {
            sampleArg = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        } else if (originalFunction.includes('str') || originalFunction.includes('string')) {
            sampleArg = 'abcdefghijklmnopqrstuvwxyz';
        } else if (originalFunction.includes('num') || originalFunction.includes('number')) {
            sampleArg = 10;
        } else if (originalFunction.includes('obj') || originalFunction.includes('object')) {
            sampleArg = { test: 'value', another: 123, nested: { key: 'value' } };
        } else {
            // For other types, try to guess from function body
            if (originalFunction.includes('"') || originalFunction.includes("'")) {
                sampleArg = 'test string';
            } else if (originalFunction.includes('+') || originalFunction.includes('-')) {
                sampleArg = 5;
            } else {
                sampleArg = [1, 2, 3, 4, 5];
            }
        }
        
        // Try to run the functions once to check for runtime errors
        try {
            outputChannel.appendLine('Testing original function execution');
            originalFn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Error running original function with sample input: ${error}`);
            // Continue anyway, as the benchmark will attempt to run the function
        }
        
        try {
            outputChannel.appendLine('Testing first alternative function execution');
            alternative1Fn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Error running first alternative function with sample input: ${error}`);
            // Continue anyway, as the benchmark will attempt to run the function
        }
        
        try {
            outputChannel.appendLine('Testing second alternative function execution');
            alternative2Fn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Error running second alternative function with sample input: ${error}`);
            // Continue anyway, as the benchmark will attempt to run the function
        }

        // Run benchmarks with a timeout
        outputChannel.appendLine('Running Benny benchmarks');
        
        // Set a timer to report if the benchmark is taking too long
        const timeoutWarning = setTimeout(() => {
            outputChannel.appendLine('WARNING: Benchmark is taking longer than expected. It might be stuck.');
        }, 5000);
        
        const results = await benny.suite(
            'Function Performance Comparison',
            benny.add('Original Function', () => originalFn(sampleArg)),
            benny.add('Alternative 1', () => alternative1Fn(sampleArg)),
            benny.add('Alternative 2', () => alternative2Fn(sampleArg)),
            benny.cycle((event: any) => {
                outputChannel.appendLine(`Cycle completed: ${event.target}`);
            }),
            benny.complete((complete: any) => {
                outputChannel.appendLine(`Benchmark completed: ${complete.results.length} results`);
            })
        );
        
        // Clear the timeout warning
        clearTimeout(timeoutWarning);
        
        outputChannel.appendLine('Benchmark completed successfully');
        outputChannel.appendLine(`Results: ${JSON.stringify(results, null, 2)}`);

        return {
            originalFunction,
            firstAlternative,
            secondAlternative,
            results
        };
    } catch (error) {
        outputChannel.appendLine(`Error in performance tests: ${error}`);
        throw new Error(`Failed to run performance tests: ${error}`);
    }
}

function getWebviewContentThree(data: any): string {
    outputChannel.appendLine('Creating webview content with three functions');
    
    try {
        const results = data.results.results;
        
        if (!results || !Array.isArray(results) || results.length < 3) {
            outputChannel.appendLine(`Invalid results structure: ${JSON.stringify(data.results)}`);
            throw new Error('Invalid benchmark results');
        }
        
        const originalResult = results.find((r: any) => r.name === 'Original Function');
        const alternative1Result = results.find((r: any) => r.name === 'Alternative 1');
        const alternative2Result = results.find((r: any) => r.name === 'Alternative 2');
        
        if (!originalResult || !alternative1Result || !alternative2Result) {
            outputChannel.appendLine(`Could not find results for all functions: ${JSON.stringify(results)}`);
            throw new Error('Missing benchmark results');
        }
        
        const originalOps = originalResult.hz;
        const alternative1Ops = alternative1Result.hz;
        const alternative2Ops = alternative2Result.hz;
        
        // Find the fastest function
        let fastestFunction = 'Original Function';
        let fastestOps = originalOps;
        
        if (alternative1Ops > fastestOps) {
            fastestFunction = 'Alternative 1';
            fastestOps = alternative1Ops;
        }
        
        if (alternative2Ops > fastestOps) {
            fastestFunction = 'Alternative 2';
            fastestOps = alternative2Ops;
        }
        
        // Calculate percentage differences
        const originalPercentage = ((originalOps / fastestOps) * 100).toFixed(2);
        const alternative1Percentage = ((alternative1Ops / fastestOps) * 100).toFixed(2);
        const alternative2Percentage = ((alternative2Ops / fastestOps) * 100).toFixed(2);
        
        outputChannel.appendLine(`Original ops: ${originalOps}, Alt1 ops: ${alternative1Ops}, Alt2 ops: ${alternative2Ops}`);
        outputChannel.appendLine(`Fastest: ${fastestFunction}`);

        // Generate specific explanation based on function characteristics and results
        const explanation = generatePerformanceExplanation(
            fastestFunction, 
            data.originalFunction, 
            data.firstAlternative, 
            data.secondAlternative,
            originalOps,
            alternative1Ops,
            alternative2Ops
        );

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                    .container { max-width: 900px; margin: 0 auto; }
                    .result-card { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .winner { border: 2px solid #4CAF50; }
                    .code-block { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; }
                    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
                    .stat-item { background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .chart { height: 20px; background: #ddd; border-radius: 4px; margin-top: 10px; position: relative; }
                    .chart-bar { height: 100%; background: #4CAF50; border-radius: 4px; }
                    .summary-card { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .explanation-list li { margin-bottom: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Function Performance Analysis</h1>
                    
                    <div class="result-card ${fastestFunction === 'Original Function' ? 'winner' : ''}">
                        <h2>Original Function</h2>
                        <pre class="code-block">${escapeHtml(data.originalFunction)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${originalOps.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${originalPercentage}%"></div>
                                </div>
                                <p>${originalPercentage}% of fastest</p>
                            </div>
                        </div>
                    </div>

                    <div class="result-card ${fastestFunction === 'Alternative 1' ? 'winner' : ''}">
                        <h2>Alternative 1</h2>
                        <pre class="code-block">${escapeHtml(data.firstAlternative)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${alternative1Ops.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${alternative1Percentage}%"></div>
                                </div>
                                <p>${alternative1Percentage}% of fastest</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="result-card ${fastestFunction === 'Alternative 2' ? 'winner' : ''}">
                        <h2>Alternative 2</h2>
                        <pre class="code-block">${escapeHtml(data.secondAlternative)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${alternative2Ops.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${alternative2Percentage}%"></div>
                                </div>
                                <p>${alternative2Percentage}% of fastest</p>
                            </div>
                        </div>
                    </div>

                    <div class="summary-card">
                        <h2>Performance Summary</h2>
                        <p><strong>${fastestFunction}</strong> is the fastest implementation, with ${fastestOps.toLocaleString()} operations per second.</p>
                        
                        <h3>Why is it faster?</h3>
                        <ul class="explanation-list">
                            ${explanation.map((item: string) => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            </body>
            </html>
        `;
    } catch (error) {
        outputChannel.appendLine(`Error creating webview content: ${error}`);
        return getErrorContent(`Error rendering results: ${error}`, data.originalFunction, data.firstAlternative + "\n\n" + data.secondAlternative);
    }
}

function generatePerformanceExplanation(
    fastestFunction: string, 
    originalFunction: string,
    firstAlternative: string,
    secondAlternative: string,
    originalOps: number,
    alternative1Ops: number,
    alternative2Ops: number
): string[] {
    const explanations: string[] = [];
    
    // Common reasons why a function might be faster
    if (fastestFunction === 'Original Function') {
        explanations.push("The original function is often optimized for the specific task at hand, with no additional abstractions.");
        explanations.push("Simple loops (like 'for') can be more efficient than higher-order functions in certain cases.");
        explanations.push("The original implementation might avoid unnecessary object creation or function calls.");
    }
    
    if (fastestFunction === 'Alternative 1') {
        if (firstAlternative.includes('reduce')) {
            explanations.push("Using <code>reduce()</code> eliminates the need for manual loop management and variable initialization.");
            explanations.push("Built-in array methods like <code>reduce()</code> are highly optimized in modern JavaScript engines.");
        }
        
        if (firstAlternative.includes('map') || firstAlternative.includes('filter')) {
            explanations.push("Higher-order functions like <code>map()</code> and <code>filter()</code> delegate the heavy lifting to native implementations.");
            explanations.push("These methods can benefit from internal optimizations in the JavaScript engine.");
        }
        
        explanations.push("The alternative avoids unnecessary variable reassignments or computations.");
    }
    
    if (fastestFunction === 'Alternative 2') {
        if (secondAlternative.includes('length')) {
            explanations.push("Caching the array length outside the loop avoids repeatedly accessing the length property.");
        }
        
        if (secondAlternative.includes('cache')) {
            explanations.push("Using memoization or caching prevents redundant calculations for the same inputs.");
        }
        
        if (secondAlternative.includes('for (var i')) {
            explanations.push("Traditional for-loops with cached array length can sometimes outperform higher-order functions.");
        }
        
        explanations.push("This implementation likely has better algorithmic complexity or memory usage patterns.");
    }
    
    // Specific analysis based on function characteristics
    if (originalFunction.includes('for (') || originalFunction.includes('while')) {
        explanations.push("Loop optimization is crucial for performance - the fastest implementation likely has the most efficient looping strategy.");
    }
    
    if (originalFunction.includes('arr') || originalFunction.includes('array')) {
        explanations.push("Array processing performance depends on access patterns and avoiding unnecessary array creations or copies.");
    }
    
    if (originalFunction.includes('string') || originalFunction.includes('str')) {
        explanations.push("String operations can be expensive - implementations that minimize string creations and modifications tend to be faster.");
    }
    
    // Add general performance insights
    explanations.push("JavaScript engines are complex and performance can vary across browsers and environments.");
    explanations.push("Micro-optimizations might show different results in production environments.");
    
    return explanations;
}

function getWebviewContentWithAnalysis(data: any, analysis: string): string {
    outputChannel.appendLine('Creating webview content with Copilot analysis');
    
    try {
        const results = data.results.results;
        
        if (!results || !Array.isArray(results) || results.length < 3) {
            outputChannel.appendLine(`Invalid results structure: ${JSON.stringify(data.results)}`);
            throw new Error('Invalid benchmark results');
        }
        
        const originalResult = results.find((r: any) => r.name === 'Original Function');
        const alternative1Result = results.find((r: any) => r.name === 'Alternative 1');
        const alternative2Result = results.find((r: any) => r.name === 'Alternative 2');
        
        if (!originalResult || !alternative1Result || !alternative2Result) {
            outputChannel.appendLine(`Could not find results for all functions: ${JSON.stringify(results)}`);
            throw new Error('Missing benchmark results');
        }
        
        const originalOps = originalResult.hz;
        const alternative1Ops = alternative1Result.hz;
        const alternative2Ops = alternative2Result.hz;
        
        // Find the fastest function
        let fastestFunction = 'Original Function';
        let fastestOps = originalOps;
        
        if (alternative1Ops > fastestOps) {
            fastestFunction = 'Alternative 1';
            fastestOps = alternative1Ops;
        }
        
        if (alternative2Ops > fastestOps) {
            fastestFunction = 'Alternative 2';
            fastestOps = alternative2Ops;
        }
        
        // Calculate percentage differences
        const originalPercentage = ((originalOps / fastestOps) * 100).toFixed(2);
        const alternative1Percentage = ((alternative1Ops / fastestOps) * 100).toFixed(2);
        const alternative2Percentage = ((alternative2Ops / fastestOps) * 100).toFixed(2);

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                    .container { max-width: 900px; margin: 0 auto; }
                    .result-card { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .winner { border: 2px solid #4CAF50; }
                    .code-block { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; }
                    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
                    .stat-item { background: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .chart { height: 20px; background: #ddd; border-radius: 4px; margin-top: 10px; position: relative; }
                    .chart-bar { height: 100%; background: #4CAF50; border-radius: 4px; }
                    .analysis-card { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Function Performance Analysis</h1>
                    
                    <div class="result-card ${fastestFunction === 'Original Function' ? 'winner' : ''}">
                        <h2>Original Function</h2>
                        <pre class="code-block">${escapeHtml(data.originalFunction)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${originalOps.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${originalPercentage}%"></div>
                                </div>
                                <p>${originalPercentage}% of fastest</p>
                            </div>
                        </div>
                    </div>

                    <div class="result-card ${fastestFunction === 'Alternative 1' ? 'winner' : ''}">
                        <h2>Alternative 1</h2>
                        <pre class="code-block">${escapeHtml(data.firstAlternative)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${alternative1Ops.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${alternative1Percentage}%"></div>
                                </div>
                                <p>${alternative1Percentage}% of fastest</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="result-card ${fastestFunction === 'Alternative 2' ? 'winner' : ''}">
                        <h2>Alternative 2</h2>
                        <pre class="code-block">${escapeHtml(data.secondAlternative)}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${alternative2Ops.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${alternative2Percentage}%"></div>
                                </div>
                                <p>${alternative2Percentage}% of fastest</p>
                            </div>
                        </div>
                    </div>

                    <div class="analysis-card">
                        <h2>Performance Analysis</h2>
                        <p><strong>${fastestFunction}</strong> is the fastest implementation, with ${fastestOps.toLocaleString()} operations per second.</p>
                        
                        <h3>Analysis by GitHub Copilot</h3>
                        <div class="analysis-content">
                            ${analysis.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('')}
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
    } catch (error) {
        outputChannel.appendLine(`Error creating webview content: ${error}`);
        return getErrorContent(`Error rendering results: ${error}`, data.originalFunction, data.firstAlternative + "\n\n" + data.secondAlternative);
    }
} 