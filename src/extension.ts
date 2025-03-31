import * as vscode from 'vscode';

// Type definition for Copilot Chat API
interface CopilotChatApi {
    requestChatResponse: (prompt: string) => Promise<string>;
    createChatRequest?: (prompt: string) => Promise<{ content: string }>;
    createConversation?: () => Promise<{ sendMessage: (prompt: string) => Promise<{ response: string }> }>;
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
            
            // First check if Copilot is available
            if (!await isCopilotAvailable()) {
                panel.webview.html = getErrorHtml("GitHub Copilot is not available. Please install and sign in to GitHub Copilot or GitHub Copilot Chat extensions.");
                return;
            }
            
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
                // Get the analysis using requestChatResponse from the API
                outputChannel.appendLine('Requesting function analysis from Copilot...');
                const analysis = await requestCopilotChatResponse(analysisPrompt);
                
                if (!analysis) {
                    panel.webview.html = getErrorHtml("Couldn't get a response from Copilot API. Please try again or restart VS Code.");
                    return;
                }
                
                outputChannel.appendLine('Analysis received from Copilot. Getting benchmark information...');
                
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

                const benchmarkResults = await requestCopilotChatResponse(benchmarkPrompt);
                
                // Combine the results and display them
                const combinedAnalysis = analysis + "\n\n## Benchmark Results\n\n" + (benchmarkResults || "No benchmark results available.");
                
                panel.webview.html = getResultsHtml(combinedAnalysis);
                outputChannel.appendLine('Analysis complete and displayed.');
            } catch (error: any) {
                outputChannel.appendLine(`Error during Copilot analysis: ${error.message}`);
                panel.webview.html = getErrorHtml(`Error: ${error.message}`);
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
 * Check if GitHub Copilot or Copilot Chat is available
 */
async function isCopilotAvailable(): Promise<boolean> {
    try {
        // Check for Copilot Chat extension
        const copilotChatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
        if (copilotChatExt) {
            outputChannel.appendLine('GitHub Copilot Chat extension found');
            
            if (!copilotChatExt.isActive) {
                outputChannel.appendLine('Activating GitHub Copilot Chat extension...');
                await copilotChatExt.activate();
            }
            
            const api = copilotChatExt.exports;
            outputChannel.appendLine(`Copilot Chat API available methods: ${Object.keys(api || {}).join(', ')}`);
            
            if (api && (api.requestChatResponse || api.createChatRequest || api.createConversation)) {
                return true;
            }
        }
        
        // Check for standard Copilot extension
        const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
        if (copilotExt) {
            outputChannel.appendLine('GitHub Copilot extension found');
            
            if (!copilotExt.isActive) {
                outputChannel.appendLine('Activating GitHub Copilot extension...');
                await copilotExt.activate();
            }
            
            const api = copilotExt.exports;
            outputChannel.appendLine(`Copilot API available methods: ${Object.keys(api || {}).join(', ')}`);
            
            return true;
        }
        
        outputChannel.appendLine('Neither GitHub Copilot nor Copilot Chat extension found');
        return false;
    } catch (error: any) {
        outputChannel.appendLine(`Error checking Copilot availability: ${error.message}`);
        return false;
    }
}

/**
 * Request a response from Copilot Chat using available API methods
 */
async function requestCopilotChatResponse(prompt: string): Promise<string | null> {
    try {
        outputChannel.appendLine('Attempting to get response from Copilot Chat...');
        
        // Try Copilot Chat first
        const copilotChatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
        if (copilotChatExt && copilotChatExt.isActive) {
            const api = copilotChatExt.exports as CopilotChatApi;
            
            // Method 1: Direct requestChatResponse (from your example)
            if (api.requestChatResponse) {
                outputChannel.appendLine('Using requestChatResponse method');
                try {
                    const response = await api.requestChatResponse(prompt);
                    if (response) {
                        outputChannel.appendLine('Successfully received response from requestChatResponse');
                        return response;
                    }
                } catch (error: any) {
                    outputChannel.appendLine(`Error with requestChatResponse: ${error.message}`);
                }
            }
            
            // Method 2: createChatRequest
            if (api.createChatRequest) {
                outputChannel.appendLine('Using createChatRequest method');
                try {
                    const response = await api.createChatRequest(prompt);
                    if (response && response.content) {
                        outputChannel.appendLine('Successfully received response from createChatRequest');
                        return response.content;
                    }
                } catch (error: any) {
                    outputChannel.appendLine(`Error with createChatRequest: ${error.message}`);
                }
            }
            
            // Method 3: createConversation
            if (api.createConversation) {
                outputChannel.appendLine('Using createConversation method');
                try {
                    const conversation = await api.createConversation();
                    if (conversation && conversation.sendMessage) {
                        const response = await conversation.sendMessage(prompt);
                        if (response && response.response) {
                            outputChannel.appendLine('Successfully received response from createConversation');
                            return response.response;
                        }
                    }
                } catch (error: any) {
                    outputChannel.appendLine(`Error with createConversation: ${error.message}`);
                }
            }
        }
        
        // Try standard Copilot as a fallback
        const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
        if (copilotExt && copilotExt.isActive) {
            outputChannel.appendLine('Falling back to standard Copilot...');
            
            // Last resort: use inline suggestions without UI
            try {
                outputChannel.appendLine('Using untitled document method');
                
                // Create a temporary document
                const document = await vscode.workspace.openTextDocument({
                    language: 'markdown',
                    content: prompt
                });
                
                // Show the document temporarily
                const editor = await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.One });
                
                // Position cursor at the end
                const position = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
                editor.selection = new vscode.Selection(position, position);
                
                // Wait for Copilot to initialize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Trigger inline suggestions
                await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
                
                // Wait for suggestions to appear and accept
                await new Promise(resolve => setTimeout(resolve, 2000));
                await vscode.commands.executeCommand('editor.action.inlineSuggest.accept');
                
                // Get the completion
                const newText = document.getText();
                const completion = newText.substring(prompt.length);
                
                // Close without saving
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                
                if (completion && completion.trim().length > 0) {
                    outputChannel.appendLine('Successfully received inline suggestion');
                    return completion;
                }
            } catch (error: any) {
                outputChannel.appendLine(`Error with inline suggestions: ${error.message}`);
            }
        }
        
        // If all methods failed, return null
        outputChannel.appendLine('All methods to get a Copilot response failed');
        return null;
    } catch (error: any) {
        outputChannel.appendLine(`Error requesting Copilot response: ${error.message}`);
        return null;
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
            <button onclick="window.location.reload()">Try Again</button>
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