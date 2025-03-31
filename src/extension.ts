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
            
            // Create a prompt directly - no need for a temporary file
            const prompt = `
// Function to analyze:
${originalFunction}

/*
Please provide a comprehensive performance analysis of the function above, including:
1. Time and space complexity analysis
2. Explanation of algorithmic approach and possible bottlenecks
3. Alternative implementations with different approaches
4. Theoretical benchmark comparison showing relative performance

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

Do NOT attempt to execute the code. Simply provide theoretical analysis based on algorithmic principles.
*/
`;

            // Check for GitHub Copilot
            const copilot = vscode.extensions.getExtension('GitHub.copilot');
            if (!copilot) {
                panel.webview.html = getErrorContent(
                    'GitHub Copilot extension is required for PerfCopilot to work', 
                    originalFunction, 
                    'Please install and sign in to GitHub Copilot to use this extension.'
                );
                panel.reveal(vscode.ViewColumn.Two);
                throw new Error('GitHub Copilot extension is required for PerfCopilot to work');
            }

            // Direct analysis using the prompt
            try {
                // Get Copilot's complete analysis directly passing our prompt
                const analysis = await getCopilotAnalysis(prompt, originalFunction);
                
                // Log the full analysis for debugging
                outputChannel.appendLine('Raw Copilot Analysis:');
                outputChannel.appendLine(analysis);
                
                // Display the analysis without any processing
                panel.webview.html = getWebviewContentWithAnalysis(analysis);
                panel.reveal(vscode.ViewColumn.Two);
            } catch (error: any) {
                panel.webview.html = getErrorContent(
                    `Error analyzing function: ${error.message || error}`, 
                    originalFunction, 
                    'PerfCopilot requires GitHub Copilot to function correctly.'
                );
                panel.reveal(vscode.ViewColumn.Two);
                throw error;
            }
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
 * Gets a performance analysis from GitHub Copilot
 */
async function getCopilotAnalysis(promptText: string, originalFunction: string): Promise<string> {
    // Log that we're starting the analysis
    outputChannel.appendLine('Starting function analysis with Copilot...');
    
    try {
        // Create a new untitled JavaScript document with our prompt
        const doc = await vscode.workspace.openTextDocument({ 
            content: promptText,
            language: 'javascript'
        });
        
        // We need to show the document to get completions
        const editor = await vscode.window.showTextDocument(doc, { 
            viewColumn: vscode.ViewColumn.One,
            preview: true
        });
        
        // Position cursor at the end of the document
        const endPosition = new vscode.Position(doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
        editor.selection = new vscode.Selection(endPosition, endPosition);
        
        // Wait a moment for Copilot to initialize with the document
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        outputChannel.appendLine('Requesting Copilot completions...');
        
        // Directly trigger the inline completion provider
        const inlineCompletions = await vscode.commands.executeCommand<vscode.InlineCompletionList>(
            'editor.action.inlineSuggest.trigger'
        );
        
        // Wait for Copilot to provide suggestions
        let attempts = 0;
        let completion = '';
        
        while (attempts < 5) {
            attempts++;
            outputChannel.appendLine(`Waiting for Copilot completions (attempt ${attempts}/5)...`);
            
            // Try to get the current inline suggestion
            try {
                // Accept the inline suggestion if available
                await vscode.commands.executeCommand('editor.action.inlineSuggest.accept');
                
                // Get the updated document text
                const newText = doc.getText();
                const originalPromptLength = promptText.length;
                
                // If we have more text than our original prompt, we got a completion
                if (newText.length > originalPromptLength) {
                    completion = newText.substring(originalPromptLength);
                    outputChannel.appendLine(`Received completion from Copilot (${completion.length} chars)`);
                    break;
                }
            } catch (e) {
                outputChannel.appendLine(`Error accepting suggestion: ${e}`);
            }
            
            // Wait before trying again
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Close the document without saving
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // If we got a completion, return it
        if (completion) {
            return completion;
        }
        
        // If we couldn't get a completion, try the Copilot Chat API as fallback
        outputChannel.appendLine('Trying Copilot Chat as fallback...');
        const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
        
        if (copilotChat && copilotChat.isActive) {
            try {
                const chatPrompt = `
Analyze this JavaScript function and provide detailed time and space complexity analysis, algorithm explanation, and optimization suggestions:

\`\`\`javascript
${originalFunction}
\`\`\`

Include a theoretical benchmark comparison of the original vs optimized versions.
`;
                // Try to send a message to Copilot Chat
                await vscode.commands.executeCommand('github.copilot.chat.focus');
                await vscode.commands.executeCommand('github.copilot.chat.newChat');
                
                // Type in the prompt
                await vscode.env.clipboard.writeText(chatPrompt);
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                
                // Send the message
                await vscode.commands.executeCommand('github.copilot.chat.sendApiRequest');
                
                // Let the user know to look at the Copilot Chat panel
                return `
# Function Analysis via Copilot Chat

The analysis of your function has been sent to the Copilot Chat panel. 
Please check there for the detailed performance analysis.

If the Copilot Chat panel is not visible:
1. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "GitHub Copilot: Open Chat View"
3. View your analysis in the chat panel

Function being analyzed:
\`\`\`javascript
${originalFunction}
\`\`\`
`;
            } catch (chatError) {
                outputChannel.appendLine(`Error using Copilot Chat: ${chatError}`);
            }
        }
        
        // Return a fallback message
        return `
# Function Analysis

Unfortunately, we couldn't get a proper analysis from GitHub Copilot at this time. Here's some general information about analyzing this type of function:

## Time and Space Complexity
When analyzing a function like the one you've selected, consider:
- How many iterations through the data are performed
- Whether nested loops are present (which might indicate O(n²) complexity)
- How much additional memory is allocated

## Suggested Steps
1. Make sure you're signed in to GitHub Copilot
2. Try using "GitHub Copilot Chat" directly instead with the prompt:
   "Analyze this function's time and space complexity: [your function]"
3. View the extension logs using the "PerfCopilot: Show Logs" command for more details

## Function Being Analyzed
\`\`\`javascript
${originalFunction}
\`\`\`
`;
    } catch (error: any) {
        outputChannel.appendLine(`Error in analysis process: ${error.message}`);
        throw new Error(`GitHub Copilot error: ${error.message}. PerfCopilot requires GitHub Copilot to function correctly.`);
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

function getWebviewContentWithAnalysis(analysis: string): string {
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
            h1, h2, h3 {
                color: #0366d6;
            }
            pre {
                background-color: #f6f8fa;
                border-radius: 3px;
                padding: 16px;
                overflow: auto;
            }
            code {
                font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
                font-size: 85%;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Function Performance Analysis</h1>
        </div>
        
        <div class="analysis">
${escapeHtml(analysis)}
        </div>
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