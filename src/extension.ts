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
}

/**
 * Activates the extension
 */
export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('PerfCopilot');
    outputChannel.appendLine('PerfCopilot extension activated');
    
    let disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showErrorMessage('Please select a function to analyze');
                return;
            }

            const originalFunction = editor.document.getText(selection);
            outputChannel.appendLine(`Analyzing function: ${originalFunction.substring(0, 100)}...`);

            // Create a WebView panel
            const panel = vscode.window.createWebviewPanel(
                'functionAnalysis',
                'Function Performance Analysis',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );

            // Show loading indicator
            panel.webview.html = getLoadingContent();
            
            // Create a temporary document for Copilot to analyze
            const tempDoc = await vscode.workspace.openTextDocument({
                content: `
/* 
 * PERFORMANCE ANALYSIS TASK
 * ------------------------
 * 1. Analyze this JavaScript function
 * 2. Generate 1-2 alternative implementations 
 * 3. Compare performance using Benny or other benchmarking method
 * 4. Return a complete analysis with time/space complexity and benchmark results
 * 
 * FUNCTION TO ANALYZE:
 * ${originalFunction}
 *
 * IMPORTANT: Do not try to execute this code. Instead, analyze it theoretically and
 * provide improvements based on algorithmic understanding.
 * 
 * FORMAT YOUR RESPONSE AS FOLLOWS:
 * 
 * Time Complexity: O(?)
 * Space Complexity: O(?)
 * 
 * Analysis:
 * (Your detailed analysis here)
 * 
 * Alternative Implementation:
 * \`\`\`javascript
 * // Your improved implementation
 * function improvedVersion() {
 *   // Code here
 * }
 * \`\`\`
 * 
 * Benchmark Results:
 * \`\`\`json
 * {
 *   "fastest": "improvedVersion",
 *   "results": [
 *     {"name": "original", "ops": 1000000, "margin": 0.5},
 *     {"name": "improvedVersion", "ops": 1500000, "margin": 0.5}
 *   ]
 * }
 * \`\`\`
 */

// Begin analysis:
`,
                language: 'javascript'
            });

            // Get Copilot's complete analysis and implementation
            const analysis = await getCopilotSuggestion(tempDoc, tempDoc.lineCount - 1);
            
            // Log the full analysis for debugging
            outputChannel.appendLine('Raw Copilot Analysis:');
            outputChannel.appendLine(analysis);
            
            // Extract benchmark results from the analysis
            try {
                // Look for JSON inside the analysis - specifically in the Benchmark Results section
                const jsonMatch = analysis.match(/Benchmark Results:[\s\S]*?```json[\s\S]*?([\s\S]*?)[\s\S]*?```/);
                let benchmarkResults = {};
                
                if (jsonMatch && jsonMatch[1]) {
                    try {
                        const jsonText = jsonMatch[1].trim();
                        outputChannel.appendLine('Extracted benchmark JSON:');
                        outputChannel.appendLine(jsonText);
                        benchmarkResults = JSON.parse(jsonText);
                        outputChannel.appendLine('Successfully parsed benchmark data');
                    } catch (jsonError: any) {
                        outputChannel.appendLine(`Error parsing benchmark JSON: ${jsonError.message}`);
                        // Continue with the analysis even if benchmark parsing fails
                    }
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
                const results = {
                    ...(benchmarkResults as any),
                    alternatives: implementations
                };
                
                // Display the analysis with the results
                panel.webview.html = getWebviewContentWithAnalysis(results, analysis);
            } catch (error: any) {
                outputChannel.appendLine(`Error processing analysis: ${error.message}`);
                panel.webview.html = getWebviewContentWithAnalysis({}, analysis);
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
async function getCopilotSuggestion(document: vscode.TextDocument, line: number): Promise<string> {
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilot) {
        throw new Error('GitHub Copilot extension is not installed');
    }

    if (!copilot.isActive) {
        await copilot.activate();
    }

    // Get the full document text instead of just triggering at the cursor position
    const fullPrompt = document.getText();
    outputChannel.appendLine(`Sending prompt to Copilot: ${fullPrompt.substring(0, 500)}...`);

    // Instead of using the standard vscode commands, let's try to use Copilot's getCompletions directly
    try {
        if (copilot.exports && typeof copilot.exports.getCompletions === 'function') {
            outputChannel.appendLine('Using Copilot exports.getCompletions');
            const completions = await copilot.exports.getCompletions(document, new vscode.Position(line, 0), {});
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
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
    
    const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(line, 0),
        undefined,
        50
    );

    if (!suggestions?.items.length) {
        throw new Error('No suggestions received from Copilot');
    }

    return suggestions.items[0].insertText?.toString() || '';
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