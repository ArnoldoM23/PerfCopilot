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
    context.subscriptions.push(outputChannel);
    
    let disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const originalFunction = editor.document.getText(selection);
        
        if (!originalFunction) {
            vscode.window.showErrorMessage('Please select a function to analyze');
            return;
        }

        try {
            // Create a webview panel
            const panel = vscode.window.createWebviewPanel(
                'functionAnalysis',
                'Function Performance Analysis',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );

            panel.webview.html = getLoadingContent();
            
            // Create a temporary file for Copilot to analyze and generate alternatives
            const tempDoc = await vscode.workspace.openTextDocument({
                content: `// Here's a function to analyze:
${originalFunction}

// Let's generate two alternative implementations and benchmark them.
// First, an optimized version focusing on performance:

// Second, a version using different JavaScript features:

// Now let's benchmark all three versions using Benny:

const benchmark = async () => {
    const results = await benny.suite(
        'Function Performance Comparison',
        benny.add('Original', () => {
            ${originalFunction}
            // Add test call here
        }),
        benny.add('Alternative 1', () => {
            // Add first alternative here
        }),
        benny.add('Alternative 2', () => {
            // Add second alternative here
        }),
        benny.cycle(),
        benny.complete()
    );
    return results;
};

// Let's analyze the performance differences:
`,
                language: 'javascript'
            });

            // Get Copilot's complete analysis and implementation
            const analysis = await getCopilotSuggestion(tempDoc, tempDoc.lineCount - 1);
            
            // Extract the benchmark results from the analysis
            const resultsMatch = analysis.match(/Results:\s*({[\s\S]*})/);
            if (!resultsMatch) {
                throw new Error('Could not extract benchmark results from analysis');
            }

            try {
                const results = JSON.parse(resultsMatch[1]);
                panel.webview.html = getWebviewContentWithAnalysis(results, analysis);
            } catch (error) {
                panel.webview.html = getErrorContent('Failed to parse benchmark results', originalFunction, analysis);
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

    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
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

function getWebviewContentWithAnalysis(_results: any, analysis: string): string {
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
            }
            pre {
                background-color: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                overflow-x: auto;
            }
            .error {
                color: #dc3545;
                padding: 10px;
                border: 1px solid #dc3545;
                border-radius: 5px;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <h1>Function Performance Analysis</h1>
        <pre>${escapeHtml(analysis)}</pre>
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