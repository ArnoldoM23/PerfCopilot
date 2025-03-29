import * as vscode from 'vscode';
import benny from 'benny';

// Create an output channel for logging
let outputChannel: vscode.OutputChannel;

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
            
            // Ask user to provide or confirm alternative implementation
            outputChannel.appendLine('Requesting alternative implementation from user');
            const alternativeFunction = await vscode.window.showInputBox({
                prompt: "Enter an alternative implementation of the function or press Enter to use a default alternative",
                value: "",
                placeHolder: "Alternative function implementation"
            });

            if (alternativeFunction === undefined) {
                // User cancelled the operation
                outputChannel.appendLine('User cancelled the operation');
                return;
            }

            // If user didn't provide an alternative, generate a simple alternative
            let finalAlternativeFunction: string;
            if (!alternativeFunction) {
                outputChannel.appendLine('Generating simple alternative implementation');
                finalAlternativeFunction = await generateSimpleAlternative(originalFunction);
                outputChannel.appendLine(`Generated alternative: ${finalAlternativeFunction.substring(0, 100)}${finalAlternativeFunction.length > 100 ? '...' : ''}`);
            } else {
                finalAlternativeFunction = alternativeFunction;
                outputChannel.appendLine('User provided alternative implementation');
            }
            
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
            
            // Run performance tests
            outputChannel.appendLine('Starting performance tests');
            
            // Create a status bar item to show progress
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            statusBarItem.text = "$(sync~spin) Running performance tests...";
            statusBarItem.show();
            
            try {
                const results = await runPerformanceTests(originalFunction, finalAlternativeFunction);
                outputChannel.appendLine('Performance tests completed successfully');
                
                // Update webview content
                panel.webview.html = getWebviewContent(results);
                outputChannel.appendLine('Results displayed in webview');
            } catch (error) {
                outputChannel.appendLine(`Error during performance tests: ${error}`);
                panel.webview.html = getErrorContent(String(error), originalFunction, finalAlternativeFunction);
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

async function runPerformanceTests(originalFunction: string, alternativeFunction: string) {
    outputChannel.appendLine('Preparing to run performance tests');
    
    try {
        // Wrap function creation in a timeout to catch potential syntax errors
        outputChannel.appendLine('Creating test functions');
        
        // Create a safer evaluation environment
        const evalFunctionSafely = (funcStr: string): Function => {
            try {
                // Check if it's a complete function declaration
                if (funcStr.trim().startsWith('function')) {
                    // Extract function name
                    const nameMatch = funcStr.match(/function\s+([^(]+)/);
                    const funcName = nameMatch ? nameMatch[1].trim() : 'anonymousFunc';
                    
                    // Create a function in the global scope (safer than eval)
                    // Using Function constructor to create a function from string
                    const createFunc = new Function(`
                        try {
                            ${funcStr}
                            return ${funcName};
                        } catch (e) {
                            throw new Error("Error creating function: " + e.message);
                        }
                    `);
                    
                    return createFunc();
                } else {
                    throw new Error("Function string must start with 'function' keyword");
                }
            } catch (error) {
                outputChannel.appendLine(`Error in evalFunctionSafely: ${error}`);
                throw error;
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