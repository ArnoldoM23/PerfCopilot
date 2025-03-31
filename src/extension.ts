import * as vscode from 'vscode';

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
            
            // Create a webview panel to display results
            const panel = vscode.window.createWebviewPanel(
                'perfCopilot',
                'Function Analysis',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            
            // Set loading state
            panel.webview.html = getLoadingHtml();
            
            // First try to analyze the function
            const analysisPrompt = `
I need you to analyze this JavaScript function and provide two alternative implementations that should be more efficient:

\`\`\`javascript
${selectedText}
\`\`\`

Please:
1. Analyze the time and space complexity of the original function
2. Provide two alternative implementations with better algorithmic approaches 
3. Name the implementations "alternativeOne" and "alternativeTwo"
4. Explain why each alternative should perform better

Format your response with clear code blocks for each implementation.
`;

            try {
                // Get the analysis from Copilot
                const analysis = await getCopilotResponse(analysisPrompt);
                
                if (!analysis) {
                    panel.webview.html = getErrorHtml("Couldn't get a response from Copilot. Make sure GitHub Copilot is properly installed and signed in.");
                    return;
                }
                
                // Now get benchmark information
                const benchmarkPrompt = `
Now I want you to create a benchmarking test using Benny.js to compare the original function with the two alternatives you just created.

Original function:
\`\`\`javascript
${selectedText}
\`\`\`

Please:
1. Create a complete benchmarking script using Benny.js that compares all three implementations
2. Make sure to include realistic test cases that work with all implementations
3. Analyze the benchmark results and explain which implementation is fastest and why
4. Present the benchmark results in a table format showing ops/sec

Run the benchmark and show me the complete results.
`;

                const benchmarkResults = await getCopilotResponse(benchmarkPrompt);
                
                // Combine the results and display them
                const combinedAnalysis = analysis + "\n\n## Benchmark Results\n\n" + (benchmarkResults || "No benchmark results available.");
                
                panel.webview.html = getResultsHtml(combinedAnalysis);
            } catch (error: any) {
                panel.webview.html = getErrorHtml(`Error: ${error.message}`);
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
 * Get a response from GitHub Copilot
 */
async function getCopilotResponse(prompt: string): Promise<string | null> {
    try {
        // Try Copilot Chat first
        const copilotChatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
        if (copilotChatExt) {
            // Ensure it's activated
            if (!copilotChatExt.isActive) {
                await copilotChatExt.activate();
            }
            
            // Access the Copilot Chat API
            const copilotChatApi = copilotChatExt.exports;
            
            // Check if the API has the requestChatResponse method
            if (copilotChatApi && copilotChatApi.requestChatResponse) {
                outputChannel.appendLine('Using Copilot Chat API requestChatResponse method');
                const response = await copilotChatApi.requestChatResponse(prompt);
                if (response && typeof response === 'string') {
                    return response;
                }
            }
            
            // Try alternative method if available
            if (copilotChatApi && copilotChatApi.createConversation) {
                outputChannel.appendLine('Using Copilot Chat API createConversation method');
                const conversation = await copilotChatApi.createConversation();
                if (conversation && conversation.sendMessage) {
                    const response = await conversation.sendMessage(prompt);
                    if (response && typeof response === 'string') {
                        return response;
                    } else if (response && response.response && typeof response.response === 'string') {
                        return response.response;
                    }
                }
            }
        }
        
        // Try standard Copilot as a fallback
        const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
        if (copilotExt) {
            // Ensure it's activated
            if (!copilotExt.isActive) {
                await copilotExt.activate();
            }
            
            // Check if the VS Code API provides languageModels directly
            const vscodeWithApi = vscode as any;
            if (vscodeWithApi.languageModels && vscodeWithApi.languageModels.generateText) {
                outputChannel.appendLine('Using VS Code languageModels API');
                const response = await vscodeWithApi.languageModels.generateText(prompt);
                if (response) {
                    return response;
                }
            }
            
            // Use Copilot extension API
            const copilotApi = copilotExt.exports;
            
            // Try any available API methods
            if (copilotApi) {
                outputChannel.appendLine(`Available Copilot APIs: ${Object.keys(copilotApi).join(', ')}`);
                
                // Option 1: Check for getCompletions or similar methods
                if (copilotApi.getCompletions) {
                    outputChannel.appendLine('Using Copilot getCompletions API');
                    // Create a simple document to get completions for
                    const document = {
                        getText: () => prompt,
                        offsetAt: (_: any) => prompt.length,
                        positionAt: (_: any) => new vscode.Position(0, 0),
                        lineAt: (_: any) => ({ text: prompt })
                    };
                    
                    const position = new vscode.Position(0, 0);
                    const completions = await copilotApi.getCompletions(document, position, {});
                    
                    if (completions && completions.length > 0) {
                        return completions[0].displayText || completions[0].text || null;
                    }
                }
            }
        }
        
        // If we get here, we couldn't get a response
        outputChannel.appendLine('No Copilot API method succeeded');
        return null;
    } catch (error: any) {
        outputChannel.appendLine(`Error using Copilot: ${error.message}`);
        throw new Error(`Failed to get Copilot response: ${error.message}`);
    }
}

function getLoadingHtml(): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                line-height: 1.5;
            }
            .loader {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Analyzing Function...</h1>
            <div class="loader"></div>
            <p>Please wait while Copilot analyzes your function and generates alternatives.</p>
        </div>
    </body>
    </html>`;
}

function getErrorHtml(errorMessage: string): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                line-height: 1.5;
            }
            .error {
                color: #d73a49;
                background-color: #ffeef0;
                padding: 15px;
                border-radius: 6px;
                margin: 20px 0;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Error</h1>
            <div class="error">
                <p>${escapeHtml(errorMessage)}</p>
            </div>
            <p>Please make sure GitHub Copilot is properly installed and try again.</p>
        </div>
    </body>
    </html>`;
}

function getResultsHtml(analysis: string): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                padding: 20px;
                line-height: 1.5;
                color: #333;
            }
            .container {
                max-width: 900px;
                margin: 0 auto;
            }
            h1, h2, h3 {
                color: #0366d6;
            }
            pre {
                background-color: #f6f8fa;
                padding: 16px;
                border-radius: 6px;
                overflow: auto;
            }
            code {
                font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
                font-size: 85%;
            }
            table {
                border-collapse: collapse;
                width: 100%;
                margin: 16px 0;
            }
            th, td {
                border: 1px solid #dfe2e5;
                padding: 8px 12px;
                text-align: left;
            }
            th {
                background-color: #f6f8fa;
            }
            .markdown-body {
                line-height: 1.6;
            }
        </style>
    </head>
    <body>
        <div class="container markdown-body">
            <h1>Function Performance Analysis</h1>
            <div id="analysis">
${convertMarkdownToHtml(analysis)}
            </div>
        </div>
    </body>
    </html>`;
}

function convertMarkdownToHtml(markdown: string): string {
    // This is a simple markdown converter
    // For a real extension, consider using a proper markdown library
    
    let html = escapeHtml(markdown);
    
    // Convert code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, '<pre><code>$2</code></pre>');
    
    // Convert headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Convert list items
    html = html.replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>');
    html = html.replace(/^- (.*$)/gm, '<ul><li>$1</li></ul>');
    
    // Fix consecutive list items
    html = html.replace(/<\/ul>\n<ul>/g, '');
    
    // Convert paragraphs
    html = html.replace(/^\s*(\n)?(.+)/gm, function(match) {
        return /^<(\/)?(h\d|ul|li|pre)/.test(match) ? match : '<p>' + match + '</p>';
    });
    
    // Remove empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    
    return html;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function deactivate() {
    outputChannel?.dispose();
} 