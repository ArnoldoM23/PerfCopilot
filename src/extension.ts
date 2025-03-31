import * as vscode from 'vscode';
import benny from 'benny';

// Create an output channel for logging
let outputChannel: vscode.OutputChannel;

/**
 * Interface for benchmark results from Benny
 */
interface CaseResultWithDiff {
    name: string;
    ops: number;  // Operations per second
    margin: number;
    percentSlower: number;
    samples: number;
    promise?: boolean;
    details?: any;
}

interface BenchmarkSuite {
    results: {
        results: CaseResultWithDiff[];
    };
}

/**
 * Activates the extension
 * @param context The extension context
 */
export function activate(context: vscode.ExtensionContext) {
    // Initialize the output channel
    outputChannel = vscode.window.createOutputChannel('PerfCopilot');
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('PerfCopilot extension activated');

    // Register the main command
    let disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        outputChannel.appendLine('\n--- Starting Performance Analysis ---');
        
        // Get the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            const message = 'No active editor found';
            outputChannel.appendLine(`Error: ${message}`);
            vscode.window.showErrorMessage(message);
            return;
        }

        // Get the selected function
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
            
            // Create a webview panel to display results
            outputChannel.appendLine('Creating webview panel');
            const panel = vscode.window.createWebviewPanel(
                'functionAnalysis',
                'Function Performance Analysis',
                vscode.ViewColumn.Two,
                { enableScripts: true }
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

// Generate a more performant implementation focusing on algorithmic optimization
// Keep the same function name and parameters, but optimize the implementation
// Example improvements: better algorithm, reduced complexity, optimized data structures
${originalFunction.replace(/\{[\s\S]*\}/, '{}')}

// Generate another implementation using different language features
// Keep the same function name and parameters, but use different JavaScript features
// Example improvements: array methods, modern syntax, functional programming patterns
${originalFunction.replace(/\{[\s\S]*\}/, '{}')}`,
                language: 'javascript'
            });

            // Get Copilot suggestions for both alternative implementations
            const firstAlternative = await getCopilotSuggestion(tempDoc, 5); // Line after first prompt
            const secondAlternative = await getCopilotSuggestion(tempDoc, 9); // Line after second prompt
            
            outputChannel.appendLine('Alternatives generated');
            
            // Create a status bar item to show progress
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            statusBarItem.text = "$(sync~spin) Running performance tests...";
            statusBarItem.show();
            
            try {
                // Run performance tests for all three implementations
                const results = await runPerformanceTestsThree(originalFunction, firstAlternative, secondAlternative);
                outputChannel.appendLine('Performance tests completed successfully');
                
                // Get Copilot's analysis
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
Original: ${results.results.results[0].ops} ops/sec
Alternative 1: ${results.results.results[1].ops} ops/sec
Alternative 2: ${results.results.results[2].ops} ops/sec
*/

// TODO: Explain the performance differences considering:
// 1. Algorithmic complexity
// 2. Memory usage
// 3. JavaScript engine optimizations
`,
                    language: 'javascript'
                });

                const analysis = await getCopilotSuggestion(analysisDoc, analysisDoc.lineCount - 1);
                
                // Update webview with results and analysis
                panel.webview.html = getWebviewContentWithAnalysis(results, analysis);
                outputChannel.appendLine('Results displayed in webview');
            } catch (error) {
                outputChannel.appendLine(`Error during performance tests: ${error}`);
                panel.webview.html = getErrorContent(String(error), originalFunction, firstAlternative + "\n\n" + secondAlternative);
                vscode.window.showErrorMessage(`Error running performance tests: ${error}`);
            } finally {
                statusBarItem.dispose();
            }
            
            panel.reveal(vscode.ViewColumn.Two);
        } catch (error) {
            outputChannel.appendLine(`Unexpected error: ${error}`);
            vscode.window.showErrorMessage(`Error analyzing function: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
    
    // Register command to show logs
    let showLogsCommand = vscode.commands.registerCommand('perfcopilot.showLogs', () => {
        outputChannel.show();
    });
    
    context.subscriptions.push(showLogsCommand);
}

/**
 * Gets a code suggestion from GitHub Copilot
 * @param document The document containing the code
 * @param line The line number to get suggestion for
 * @returns A string containing the suggested function
 */
async function getCopilotSuggestion(document: vscode.TextDocument, line: number): Promise<string> {
    // Get the Copilot extension
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilot) {
        throw new Error('GitHub Copilot extension is not installed');
    }

    // Activate Copilot if needed
    if (!copilot.isActive) {
        await copilot.activate();
    }

    outputChannel.appendLine('Getting suggestions from Copilot...');

    // Get suggestions from Copilot
    const position = new vscode.Position(line, 0);
    
    // Trigger completion and wait for suggestions
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        position,
        undefined,
        50
    );

    if (!suggestions || suggestions.items.length === 0) {
        throw new Error('No suggestions received from Copilot');
    }

    // Get the best suggestion
    const bestSuggestion = suggestions.items[0];
    if (!bestSuggestion.insertText) {
        throw new Error('Invalid suggestion received from Copilot');
    }

    const suggestionText = bestSuggestion.insertText.toString();
    outputChannel.appendLine(`Received suggestion: ${suggestionText}`);

    // Extract function body using various patterns
    const patterns = [
        /function\s+\w+\s*\([^)]*\)\s*{([\s\S]*)}/,  // Regular function
        /\([^)]*\)\s*=>\s*{([\s\S]*)}/,              // Arrow function with block
        /\([^)]*\)\s*=>\s*([^{].*)/,                 // Arrow function single line
        /{([\s\S]*)}/                                // Just the function body
    ];

    let functionBody = null;
    for (const pattern of patterns) {
        const match = suggestionText.match(pattern);
        if (match) {
            functionBody = match[1];
            break;
        }
    }

    if (!functionBody) {
        outputChannel.appendLine('Failed to extract function body. Using entire suggestion.');
        functionBody = suggestionText;
    }

    // Get original function name and parameters
    const originalFuncMatch = document.getText().match(/function\s+(\w+)\s*\(([^)]*)\)/);
    const funcName = originalFuncMatch ? originalFuncMatch[1] : 'alternative';
    const params = originalFuncMatch ? originalFuncMatch[2] : 'arr';

    const finalFunction = `function ${funcName}(${params}) {${functionBody}}`;
    outputChannel.appendLine(`Generated function: ${finalFunction}`);
    
    return finalFunction;
}

/**
 * Safely evaluates a function string and returns a callable function
 * @param funcStr The function string to evaluate
 * @returns A callable function
 */
function evalFunctionSafely(funcStr: string): Function {
    try {
        if (funcStr.trim().startsWith('function')) {
            const nameMatch = funcStr.match(/function\s+([^(]+)/);
            const funcName = nameMatch ? nameMatch[1].trim() : 'anonymousFunc';
            
            // Replace ES6+ features with ES5 equivalents
            let processedCode = funcStr
                .replace(/const\s+/g, 'var ')
                .replace(/let\s+/g, 'var ');
                
            // Convert arrow functions to regular functions
            processedCode = processedCode
                .replace(/\(([^)]*)\)\s*=>\s*{/g, "function($1) {")
                .replace(/\(([^)]*)\)\s*=>\s*([^{].*?)(;|\n|$)/g, "function($1) { return $2; }");
            
            return new Function(`
                try {
                    ${processedCode}
                    return typeof ${funcName} === 'function' ? ${funcName} : function() { return null; };
                } catch (e) {
                    console.error("Error evaluating function:", e);
                    return function() { return null; };
                }
            `)();
        }
        
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
    } catch (error) {
        outputChannel.appendLine(`Error in evalFunctionSafely: ${error}`);
        return function() { return null; };
    }
}

/**
 * Runs performance tests on three function implementations
 * @param originalFunction The original function string
 * @param firstAlternative The first alternative implementation
 * @param secondAlternative The second alternative implementation
 * @returns Benchmark results
 */
async function runPerformanceTestsThree(originalFunction: string, firstAlternative: string, secondAlternative: string) {
    outputChannel.appendLine('Preparing to run performance tests for three implementations');
    
    try {
        // Create test functions
        const originalFn = evalFunctionSafely(originalFunction);
        const alternative1Fn = evalFunctionSafely(firstAlternative);
        const alternative2Fn = evalFunctionSafely(secondAlternative);
        
        // Verify functions are callable
        if (typeof originalFn !== 'function') throw new Error('Original code did not return a function');
        if (typeof alternative1Fn !== 'function') throw new Error('First alternative code did not return a function');
        if (typeof alternative2Fn !== 'function') throw new Error('Second alternative code did not return a function');
        
        // Create appropriate sample input based on function characteristics
        let sampleArg: any = createSampleInput(originalFunction);
        
        // Test functions with sample input
        try {
            originalFn(sampleArg);
            alternative1Fn(sampleArg);
            alternative2Fn(sampleArg);
        } catch (error) {
            outputChannel.appendLine(`Warning: Error in test execution: ${error}`);
        }

        // Run benchmarks
        outputChannel.appendLine('Running Benny benchmarks');
        
        const timeoutWarning = setTimeout(() => {
            outputChannel.appendLine('WARNING: Benchmark is taking longer than expected');
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
        
        clearTimeout(timeoutWarning);
        
        outputChannel.appendLine(`Results: ${JSON.stringify(results, null, 2)}`);
        return { originalFunction, firstAlternative, secondAlternative, results };
    } catch (error) {
        outputChannel.appendLine(`Error in performance tests: ${error}`);
        throw new Error(`Failed to run performance tests: ${error}`);
    }
}

/**
 * Creates appropriate sample input based on function characteristics
 * @param functionStr The function string to analyze
 * @returns Sample input for the function
 */
function createSampleInput(functionStr: string): any {
    if (functionStr.includes('arr') || functionStr.includes('array')) {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    } else if (functionStr.includes('str') || functionStr.includes('string')) {
        return 'abcdefghijklmnopqrstuvwxyz';
    } else if (functionStr.includes('num') || functionStr.includes('number')) {
        return 10;
    } else if (functionStr.includes('obj') || functionStr.includes('object')) {
        return { test: 'value', another: 123, nested: { key: 'value' } };
    } else if (functionStr.includes('"') || functionStr.includes("'")) {
        return 'test string';
    } else if (functionStr.includes('+') || functionStr.includes('-')) {
        return 5;
    }
    return [1, 2, 3, 4, 5];
}

// HTML template functions
function getLoadingContent(): string {
    return `<!DOCTYPE html>
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
    </html>`;
}

function getErrorContent(error: string, originalFunction: string, alternativeFunction: string): string {
    return `<!DOCTYPE html>
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
    </html>`;
}

function getWebviewContentWithAnalysis(data: any, analysis: string): string {
    try {
        const results = data.results.results;
        if (!results || !Array.isArray(results) || results.length < 3) {
            throw new Error('Invalid benchmark results');
        }
        
        const [originalResult, alternative1Result, alternative2Result] = results;
        const originalOps = originalResult.ops;
        const alternative1Ops = alternative1Result.ops;
        const alternative2Ops = alternative2Result.ops;
        
        // Find fastest implementation
        const implementations = [
            { name: 'Original Function', ops: originalOps },
            { name: 'Alternative 1', ops: alternative1Ops },
            { name: 'Alternative 2', ops: alternative2Ops }
        ];
        
        const fastest = implementations.reduce((a, b) => a.ops > b.ops ? a : b);
        
        // Calculate percentages
        const percentages = implementations.map(impl => ({
            ...impl,
            percentage: ((impl.ops / fastest.ops) * 100).toFixed(2)
        }));

        return `<!DOCTYPE html>
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
                .chart { height: 20px; background: #ddd; border-radius: 4px; margin-top: 10px; }
                .chart-bar { height: 100%; background: #4CAF50; border-radius: 4px; }
                .analysis-card { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Function Performance Analysis</h1>
                
                ${percentages.map(impl => `
                    <div class="result-card ${impl.name === fastest.name ? 'winner' : ''}">
                        <h2>${impl.name}</h2>
                        <pre class="code-block">${escapeHtml(
                            impl.name === 'Original Function' ? data.originalFunction :
                            impl.name === 'Alternative 1' ? data.firstAlternative :
                            data.secondAlternative
                        )}</pre>
                        <div class="stats">
                            <div class="stat-item">
                                <h3>Operations per Second</h3>
                                <p>${impl.ops.toLocaleString()}</p>
                                <div class="chart">
                                    <div class="chart-bar" style="width: ${impl.percentage}%"></div>
                                </div>
                                <p>${impl.percentage}% of fastest</p>
                            </div>
                        </div>
                    </div>
                `).join('')}

                <div class="analysis-card">
                    <h2>Performance Analysis</h2>
                    <p><strong>${fastest.name}</strong> is the fastest implementation, with ${fastest.ops.toLocaleString()} operations per second.</p>
                    
                    <h3>Analysis by GitHub Copilot</h3>
                    <div class="analysis-content">
                        ${analysis.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('')}
                    </div>
                </div>
            </div>
        </body>
        </html>`;
    } catch (error) {
        outputChannel.appendLine(`Error creating webview content: ${error}`);
        return getErrorContent(`Error rendering results: ${error}`, data.originalFunction, data.firstAlternative + "\n\n" + data.secondAlternative);
    }
}

/**
 * Helper function to escape HTML special characters
 */
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