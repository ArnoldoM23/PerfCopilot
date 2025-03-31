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
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilot) {
        outputChannel.appendLine('GitHub Copilot extension not found');
        throw new Error('GitHub Copilot extension is required for PerfCopilot to work');
    }

    outputChannel.appendLine(`GitHub Copilot extension found: id=${copilot.id}, version=${copilot.packageJSON.version}`);
    
    if (!copilot.isActive) {
        outputChannel.appendLine('Activating GitHub Copilot extension...');
        await copilot.activate();
        outputChannel.appendLine('GitHub Copilot extension activated');
    } else {
        outputChannel.appendLine('GitHub Copilot extension is already active');
    }
    
    // First check if we have a direct path to the Copilot API
    outputChannel.appendLine('Exploring available Copilot APIs...');
    outputChannel.appendLine(`Copilot export keys: ${Object.keys(copilot.exports || {}).join(', ')}`);
    
    // First try to use Copilot Chat if available
    try {
        const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
        
        if (copilotChat) {
            outputChannel.appendLine(`Copilot Chat found: id=${copilotChat.id}, version=${copilotChat.packageJSON.version}`);
            
            if (!copilotChat.isActive) {
                outputChannel.appendLine('Activating GitHub Copilot Chat extension...');
                await copilotChat.activate();
                outputChannel.appendLine('GitHub Copilot Chat extension activated');
            } else {
                outputChannel.appendLine('GitHub Copilot Chat extension is already active');
            }
            
            outputChannel.appendLine(`Copilot Chat export keys: ${Object.keys(copilotChat.exports || {}).join(', ')}`);
            
            if (copilotChat.isActive) {
                outputChannel.appendLine('Using Copilot Chat for analysis...');
                
                // Construct a simple prompt for Copilot Chat
                const chatPrompt = `
Analyze this JavaScript function and provide:
1. Time and space complexity
2. Explanation of algorithm 
3. Possible optimizations
4. 1-2 alternative implementations
5. Theoretical benchmark comparison (do NOT execute any code)

The function:
\`\`\`javascript
${originalFunction}
\`\`\`

Include a "Benchmark Results:" section with a JSON object in this format:
\`\`\`json
{
  "fastest": "functionName",
  "results": [
    {
      "name": "original",
      "ops": <estimated number>,
      "margin": <estimated number>,
      "percentSlower": <estimated number>
    },
    {
      "name": "alternative1",
      "ops": <estimated number>,
      "margin": <estimated number>,
      "percentSlower": <estimated number>
    }
  ]
}
\`\`\`

IMPORTANT: Do NOT actually execute the code! Only provide theoretical analysis.
`;
                
                // Check if Copilot Chat API is available
                if (copilotChat.exports && typeof copilotChat.exports.createChatRequest === 'function') {
                    outputChannel.appendLine('Using Copilot Chat API directly via createChatRequest');
                    try {
                        const response = await copilotChat.exports.createChatRequest(chatPrompt);
                        if (response && response.content) {
                            outputChannel.appendLine('Received response from Copilot Chat API');
                            return response.content;
                        } else {
                            outputChannel.appendLine('No content in Copilot Chat response');
                        }
                    } catch (chatError: any) {
                        outputChannel.appendLine(`Error using Copilot Chat createChatRequest: ${chatError.message}`);
                    }
                } else {
                    outputChannel.appendLine('Copilot Chat createChatRequest API not available');
                }
                
                // Try alternative chat APIs if available
                if (copilotChat.exports && typeof copilotChat.exports.getChatAgent === 'function') {
                    outputChannel.appendLine('Trying Copilot Chat API via getChatAgent');
                    try {
                        const agent = copilotChat.exports.getChatAgent();
                        if (agent && typeof agent.sendMessage === 'function') {
                            const response = await agent.sendMessage(chatPrompt);
                            if (response && response.message) {
                                outputChannel.appendLine('Received response from Copilot Chat agent');
                                return response.message;
                            } else {
                                outputChannel.appendLine('No message in Copilot Chat agent response');
                            }
                        } else {
                            outputChannel.appendLine('Copilot Chat agent sendMessage not available');
                        }
                    } catch (agentError: any) {
                        outputChannel.appendLine(`Error using Copilot Chat agent: ${agentError.message}`);
                    }
                }
            }
        } else {
            outputChannel.appendLine('GitHub Copilot Chat extension not found');
        }
    } catch (e: any) {
        outputChannel.appendLine(`Error using Copilot Chat: ${e.message}`);
        // Fall back to standard Copilot
    }

    // Use the Copilot API directly
    try {
        outputChannel.appendLine('Trying standard Copilot APIs');
        
        // Try the new getInlineCompletions API first
        if (copilot.exports && typeof copilot.exports.getInlineCompletions === 'function') {
            outputChannel.appendLine('Using Copilot exports.getInlineCompletions');
            
            try {
                // Create a completion directly using the API
                const completions = await copilot.exports.getInlineCompletions(promptText);
                
                if (completions && completions.length > 0) {
                    const completion = completions[0]?.text || '';
                    if (completion) {
                        outputChannel.appendLine(`Received completion from Copilot getInlineCompletions: ${completion.substring(0, 100)}...`);
                        return completion;
                    } else {
                        outputChannel.appendLine('Empty text in completion from getInlineCompletions');
                    }
                } else {
                    outputChannel.appendLine('No completions returned from getInlineCompletions');
                }
            } catch (inlineError: any) {
                outputChannel.appendLine(`Error using getInlineCompletions: ${inlineError.message}`);
            }
        } else {
            outputChannel.appendLine('getInlineCompletions API not available');
        }
        
        // Try the older getCompletions API
        if (copilot.exports && typeof copilot.exports.getCompletions === 'function') {
            outputChannel.appendLine('Using Copilot exports.getCompletions');
            
            try {
                // Mock document position for the API
                const position = new vscode.Position(promptText.split('\n').length - 1, 0);
                
                // Get completions directly
                const completions = await copilot.exports.getCompletions(
                    { getText: () => promptText } as any, 
                    position, 
                    { maxResults: 1 }
                );
                
                if (completions && completions.length > 0) {
                    const completion = completions[0] || '';
                    outputChannel.appendLine(`Received completion from Copilot getCompletions: ${completion.substring(0, 100)}...`);
                    return completion;
                } else {
                    outputChannel.appendLine('No completions returned from getCompletions');
                }
            } catch (completionsError: any) {
                outputChannel.appendLine(`Error using getCompletions: ${completionsError.message}`);
            }
        } else {
            outputChannel.appendLine('getCompletions API not available');
        }
        
        // Try using the completion provider API
        if (copilot.exports && typeof copilot.exports.getCompletionProvider === 'function') {
            outputChannel.appendLine('Using Copilot CompletionProvider');
            
            try {
                const provider = copilot.exports.getCompletionProvider();
                outputChannel.appendLine(`Provider methods: ${Object.keys(provider || {}).join(', ')}`);
                
                if (provider && typeof provider.provideInlineCompletions === 'function') {
                    const mockDocument = {
                        getText: () => promptText,
                        getWordRangeAtPosition: () => undefined,
                        lineAt: (line: number) => ({ 
                            text: promptText.split('\n')[line] || '',
                            lineNumber: line,
                            range: new vscode.Range(line, 0, line, 0) 
                        }),
                        lineCount: promptText.split('\n').length,
                        offsetAt: (pos: vscode.Position) => {
                            const lines = promptText.split('\n');
                            let offset = 0;
                            for (let i = 0; i < pos.line; i++) {
                                offset += lines[i].length + 1; // +1 for the newline
                            }
                            return offset + pos.character;
                        },
                        positionAt: (offset: number) => {
                            const lines = promptText.split('\n');
                            let pos = 0;
                            let line = 0;
                            let char = 0;
                            
                            while (line < lines.length && pos + lines[line].length < offset) {
                                pos += lines[line].length + 1;
                                line++;
                            }
                            
                            char = offset - pos;
                            return new vscode.Position(line, char);
                        },
                        uri: vscode.Uri.parse('untitled:temp.js'),
                        version: 1
                    };
                    
                    const completions = await provider.provideInlineCompletions(
                        mockDocument as any, 
                        new vscode.Position(mockDocument.lineCount - 1, 0),
                        { triggerKind: 0, selectedCompletionInfo: undefined } as any, 
                        { previousResponseId: undefined, selectedItems: [] } as any,
                        new vscode.CancellationTokenSource().token
                    );
                    
                    if (completions && completions.items && completions.items.length > 0) {
                        const completion = completions.items[0].insertText.toString();
                        outputChannel.appendLine(`Received completion from provider: ${completion.substring(0, 100)}...`);
                        return completion;
                    } else {
                        outputChannel.appendLine('No completions returned from provider');
                    }
                } else {
                    outputChannel.appendLine('Provider does not have provideInlineCompletions method');
                }
            } catch (providerError: any) {
                outputChannel.appendLine(`Error using provider: ${providerError.message}`);
            }
        } else {
            outputChannel.appendLine('getCompletionProvider API not available');
        }
        
        // Last resort - try to get a direct completion through workspace API
        outputChannel.appendLine('Trying direct workspace API approach');
        
        try {
            // Create a temporary document and position to get completions
            const doc = await vscode.workspace.openTextDocument({ 
                content: promptText,
                language: 'javascript'
            });
            
            // Request completions from VS Code
            const position = new vscode.Position(doc.lineCount - 1, 0);
            
            // Try to get completions through VS Code's completion provider
            const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
                'vscode.executeCompletionItemProvider',
                doc.uri,
                position
            );
            
            if (completionList && completionList.items.length > 0) {
                // Find the longest completion which is likely to be from Copilot
                let bestCompletion = '';
                for (const item of completionList.items) {
                    const insertText = typeof item.insertText === 'string' 
                        ? item.insertText 
                        : item.insertText?.value || '';
                    
                    if (insertText.length > bestCompletion.length) {
                        bestCompletion = insertText;
                    }
                }
                
                if (bestCompletion.length > 0) {
                    outputChannel.appendLine(`Found completion via VS Code API: ${bestCompletion.substring(0, 100)}...`);
                    return bestCompletion;
                }
            }
            
            outputChannel.appendLine('No suitable completions found via VS Code API');
        } catch (wsError: any) {
            outputChannel.appendLine(`Error using VS Code workspace API: ${wsError.message}`);
        }
        
        outputChannel.appendLine('All Copilot API approaches failed');
        
        // If we've reached this point, all approaches have failed
        // As a last resort, return a fallback message that explains we couldn't get
        // a completion from Copilot but still provides some value to the user
        return `# Function Analysis

Unfortunately, we couldn't get a proper analysis from GitHub Copilot at this time. Here's some general information about analyzing this type of function:

## Time and Space Complexity
When analyzing a function like the one you've selected, consider:
- How many iterations through the data are performed
- Whether nested loops are present (which might indicate O(n²) complexity)
- How much additional memory is allocated

## Suggested Steps
1. Check that you're properly authenticated with GitHub Copilot
2. Try selecting the function again and running the analysis
3. If the problem persists, view the logs using the "PerfCopilot: Show Logs" command

## Benchmark Considerations
When benchmarking JavaScript functions:
- Consider input size and variety of test cases
- Look for algorithmic improvements rather than micro-optimizations
- Profile in the actual environment where the code will run

Please try again later or check the extension logs for more details.`;
        
    } catch (e: any) {
        outputChannel.appendLine(`Error using Copilot: ${e.message}`);
        throw new Error(`GitHub Copilot error: ${e.message}. PerfCopilot requires GitHub Copilot to function correctly.`);
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