import * as vscode from 'vscode';
import benny from 'benny';

/**
 * Interface for benchmark results from Benny
 */
interface BenchmarkResult {
    name: string;
    ops: number;
    margin: number;
    percentSlower?: number;
}

interface BenchmarkResults {
    fastest?: string;
    results: BenchmarkResult[];
    alternatives?: string[];
}

// The extension output channel
const outputChannel = vscode.window.createOutputChannel('PerfCopilot');

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('PerfCopilot extension activated');
    
    // Register the command to analyze a function
    const disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return;
            }
            
            // Get the selected text
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            
            if (!selectedText) {
                vscode.window.showErrorMessage('No function selected');
                return;
            }
            
            outputChannel.appendLine(`Analyzing function: ${selectedText.substring(0, 100)}...`);
            
            // Create webview panel
            const panel = vscode.window.createWebviewPanel(
                'perfcopilot',
                'Function Analysis',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            
            // Set initial HTML
            panel.webview.html = getLoadingContent();
            
            // Store original function for later comparison
            const originalFunction = selectedText;
            
            // Prepare a document with setup for Copilot analysis
            // Create a template that will be completed by Copilot
            const template = `
// Function to analyze:
${originalFunction}

/*
Please provide a comprehensive performance analysis of the function above, including:
1. Time and space complexity analysis
2. Explanation of algorithmic approach and possible bottlenecks
3. Compare performance using Benny or other benchmarking method
4. Return a complete analysis with time/space complexity and benchmark results

Format the output as follows:
===========================
# Performance Analysis

## Time Complexity
[Explanation of the time complexity]

## Space Complexity
[Explanation of the space complexity]

## Algorithm Analysis
[Detailed explanation of how the algorithm works and potential bottlenecks]

## Suggested Optimizations
[Explain potential optimizations]

## Alternative Implementations
[Provide 1-3 alternative implementations with explanations]

## Benchmark Results:
\`\`\`json
{
  "fastest": "implementation name",
  "results": [
    {
      "name": "original",
      "ops": number of operations per second,
      "margin": error margin,
      "percentSlower": percent slower than fastest
    },
    {
      "name": "alternative1",
      "ops": number of operations per second,
      "margin": error margin,
      "percentSlower": percent slower than fastest
    }
  ]
}
\`\`\`
===========================
*/
`;
            
            // Create a temporary document with the template
            const tempUri = vscode.Uri.parse(`untitled:${Math.random().toString(36).substring(2)}.js`);
            const tempDoc = await vscode.workspace.openTextDocument(tempUri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(tempUri, new vscode.Position(0, 0), template);
            await vscode.workspace.applyEdit(edit);
            
            await vscode.window.showTextDocument(tempDoc, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
                selection: new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(0, 0)
                )
            });

            // Get Copilot's complete analysis and implementation
            const analysis = await getCopilotSuggestion(tempDoc, tempDoc.lineCount - 1);
            
            // Log the full analysis for debugging
            outputChannel.appendLine('Raw Copilot Analysis:');
            outputChannel.appendLine(analysis);
            
            // Extract benchmark results from the analysis
            try {
                // Look for JSON inside the analysis - specifically in the Benchmark Results section
                // Improved regex that's more flexible with whitespace and newlines
                const jsonMatch = analysis.match(/Benchmark Results:[\s\S]*?```(?:json)?([\s\S]*?)```/);
                let benchmarkResults: BenchmarkResults = { results: [] };
                
                if (jsonMatch && jsonMatch[1]) {
                    try {
                        // Clean up the extracted JSON text
                        let jsonText = jsonMatch[1].trim();
                        
                        // Remove any extra backticks or comments that might be in the JSON
                        jsonText = jsonText.replace(/^```.*$/gm, '').trim();
                        
                        outputChannel.appendLine('Extracted benchmark JSON:');
                        outputChannel.appendLine(jsonText);
                        
                        // Try to parse the JSON
                        benchmarkResults = JSON.parse(jsonText);
                        outputChannel.appendLine('Successfully parsed benchmark data');
                        
                        // Validate the benchmark results structure
                        if (!benchmarkResults.hasOwnProperty('results')) {
                            outputChannel.appendLine('Warning: Benchmark results missing "results" array');
                            benchmarkResults = { 
                                ...benchmarkResults,
                                results: []
                            };
                        }
                    } catch (jsonError: any) {
                        outputChannel.appendLine(`Error parsing benchmark JSON: ${jsonError.message}`);
                        // Continue with the analysis even if benchmark parsing fails
                    }
                } else {
                    outputChannel.appendLine('Warning: No benchmark results section found in the analysis');
                }
                
                // Extract alternative implementations
                const implementations: string[] = [];
                const codeBlockRegex = /```(?:javascript|js)?([\s\S]*?)```/g;
                let match;
                
                while ((match = codeBlockRegex.exec(analysis)) !== null) {
                    const codeContent = match[1].trim();
                    if (codeContent.includes('function ') && !codeContent.includes(originalFunction.substring(0, 30))) {
                        implementations.push(codeContent);
                    }
                }
                
                if (implementations.length > 0) {
                    outputChannel.appendLine(`Found ${implementations.length} alternative implementations`);
                }
                
                // Create results object
                const results: BenchmarkResults = {
                    ...(benchmarkResults as any),
                    alternatives: implementations
                };
                
                // Display the analysis with the results
                panel.webview.html = getWebviewContentWithAnalysis(results, analysis);
            } catch (error: any) {
                outputChannel.appendLine(`Error processing analysis: ${error.message}`);
                panel.webview.html = getWebviewContentWithAnalysis({ results: [] }, analysis);
            }
            
            panel.reveal(vscode.ViewColumn.Two);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error analyzing function: ${error.message || error}`);
        }
    });

    context.subscriptions.push(disposable);
    
    // Register command to show logs
    context.subscriptions.push(
        vscode.commands.registerCommand('perfcopilot.showLogs', () => {
            outputChannel.show();
        })
    );
}

/**
 * Gets a code suggestion from GitHub Copilot
 */
async function getCopilotSuggestion(document: vscode.TextDocument, _line: number): Promise<string> {
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilot) {
        throw new Error('GitHub Copilot extension is not installed');
    }

    if (!copilot.isActive) {
        await copilot.activate();
    }

    // For benchmark results, we need to ensure the document contains clear instructions
    // for Copilot to format the results in a consistent way
    const currentText = document.getText();
    let documentText = currentText;
    
    // Add explicit instructions for benchmark results format if not already present
    if (!currentText.includes("FORMAT INSTRUCTIONS FOR BENCHMARK RESULTS")) {
        const formatInstructions = `
// FORMAT INSTRUCTIONS FOR BENCHMARK RESULTS:
// 1. Always include a 'Benchmark Results:' section with valid JSON in the following format:
// \`\`\`json
// {
//   "fastest": "functionName",
//   "results": [
//     {
//       "name": "functionName",
//       "ops": 1000000,
//       "margin": 1.5,
//       "percentSlower": 0
//     },
//     {
//       "name": "alternativeImplementation",
//       "ops": 800000,
//       "margin": 1.8,
//       "percentSlower": 20
//     }
//   ]
// }
// \`\`\`
// 2. Make sure to provide proper JSON that can be parsed
// 3. Include both the original function and alternatives in the benchmark
`;
        // Create a new document with the instructions
        // Insert instructions after initial function but before expected completion
        const lastLine = document.lineCount - 1;
        documentText = currentText.substring(0, document.offsetAt(new vscode.Position(lastLine, 0))) + 
                      formatInstructions + 
                      currentText.substring(document.offsetAt(new vscode.Position(lastLine, 0)));
        
        // Log the modified prompt
        outputChannel.appendLine('Modified prompt with format instructions:');
        outputChannel.appendLine(documentText.substring(0, 500) + '...');
    }

    // Try to use Copilot's direct API if available
    try {
        if (copilot.exports && typeof copilot.exports.getCompletions === 'function') {
            outputChannel.appendLine('Using Copilot exports.getCompletions');
            
            // Create a temporary document with our instructions
            const tempUri = vscode.Uri.parse(`untitled:${Math.random().toString(36).substring(2)}.js`);
            const tempDoc = await vscode.workspace.openTextDocument(tempUri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(tempUri, new vscode.Position(0, 0), documentText);
            await vscode.workspace.applyEdit(edit);
            
            // Get completions from the temp document
            const completions = await copilot.exports.getCompletions(tempDoc, new vscode.Position(tempDoc.lineCount - 1, 0), {});
            
            // Close the temp document
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            
            if (completions && completions.length > 0) {
                const completion = completions[0] || '';
                outputChannel.appendLine(`Received completion from Copilot exports: ${completion.substring(0, 100)}...`);
                return completion;
            }
        }
    } catch (e: any) {
        outputChannel.appendLine(`Error using Copilot exports: ${e.message}`);
        // Fall back to the standard method
    }

    // Standard method as fallback
    try {
        // Create a temporary document with our instructions
        const tempUri = vscode.Uri.parse(`untitled:${Math.random().toString(36).substring(2)}.js`);
        const tempDoc = await vscode.workspace.openTextDocument(tempUri);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(tempUri, new vscode.Position(0, 0), documentText);
        await vscode.workspace.applyEdit(edit);
        
        // Open the document and position at the end
        const editor = await vscode.window.showTextDocument(tempDoc);
        editor.selection = new vscode.Selection(
            new vscode.Position(tempDoc.lineCount - 1, 0),
            new vscode.Position(tempDoc.lineCount - 1, 0)
        );
        
        // Trigger suggest and wait for completions
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
        
        const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            tempDoc.uri,
            new vscode.Position(tempDoc.lineCount - 1, 0),
            undefined,
            50
        );
        
        // Close the temp document
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        if (!suggestions?.items.length) {
            throw new Error('No suggestions received from Copilot');
        }
        
        return suggestions.items[0].insertText?.toString() || '';
    } catch (e: any) {
        outputChannel.appendLine(`Error with standard method: ${e.message}`);
        throw e;
    }
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
            <h2>Analyzing Function Performance...</h2>
            <p>Please wait while GitHub Copilot analyzes and benchmarks the function.</p>
        </div>
    </body>
    </html>`;
}

function getErrorContent(error: string, originalFunction: string, analysis: string): string {
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
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Error Analyzing Function</h1>
            <div class="error-card">
                <h2>Error Details</h2>
                <p>${escapeHtml(error)}</p>
            </div>
            <h2>Original Function</h2>
            <pre class="code-block">${escapeHtml(originalFunction)}</pre>
            <h2>Analysis</h2>
            <pre class="code-block">${escapeHtml(analysis)}</pre>
        </div>
    </body>
    </html>`;
}

function getWebviewContentWithAnalysis(results: any, analysis: string): string {
    // Enhanced HTML template with better styling and structure
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Function Performance Analysis</title>
        <style>
            body {
                padding: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                line-height: 1.5;
                color: #333;
                max-width: 1200px;
                margin: 0 auto;
            }
            .header {
                margin-bottom: 20px;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
            }
            .analysis {
                background-color: #f8f9fa;
                padding: 20px;
                border-radius: 5px;
                margin-bottom: 20px;
                white-space: pre-wrap;
                font-family: monospace;
                font-size: 14px;
            }
            .code-block {
                background-color: #1e1e1e;
                color: #d4d4d4;
                padding: 15px;
                border-radius: 4px;
                overflow-x: auto;
                margin: 15px 0;
                font-family: 'Courier New', monospace;
            }
            .benchmark {
                background-color: #f0f7ff;
                padding: 15px;
                border-radius: 5px;
                margin-top: 20px;
            }
            .benchmark h2 {
                margin-top: 0;
                color: #0366d6;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
            }
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
                text-align: left;
            }
            th {
                background-color: #f1f1f1;
            }
            .fastest {
                font-weight: bold;
                color: #28a745;
            }
            /* Syntax highlighting */
            .analysis .keyword { color: #569CD6; }
            .analysis .function { color: #DCDCAA; }
            .analysis .string { color: #CE9178; }
            .analysis .number { color: #B5CEA8; }
            .analysis .comment { color: #6A9955; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Function Performance Analysis</h1>
        </div>
        
        <div class="analysis">
${escapeHtml(analysis)}
        </div>
        
        ${results.results ? `
        <div class="benchmark">
            <h2>Benchmark Results</h2>
            <p>Fastest implementation: <span class="fastest">${escapeHtml(results.fastest || 'Not specified')}</span></p>
            
            <table>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Operations/sec</th>
                        <th>Margin</th>
                        <th>Relative</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.results.map((result: any) => {
                        const isFastest = result.name === results.fastest;
                        const relative = isFastest ? '100%' : 
                                      result.percentSlower ? `${100 - result.percentSlower}%` : 
                                      'N/A';
                        return `
                    <tr class="${isFastest ? 'fastest' : ''}">
                        <td>${escapeHtml(result.name)}</td>
                        <td>${Number(result.ops).toLocaleString()}</td>
                        <td>±${result.margin}%</td>
                        <td>${relative}</td>
                    </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
    </body>
    </html>`;
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
    outputChannel?.dispose();
} 