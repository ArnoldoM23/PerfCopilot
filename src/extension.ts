import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
            // First check if Copilot is available
            const isCopilotAvailable = await checkCopilotOrChatAvailable();
            if (!isCopilotAvailable) {
                vscode.window.showErrorMessage('GitHub Copilot or Copilot Chat is required but not detected. Please install from the marketplace and sign in.');
                return;
            }
            
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
            
            try {
                // First try to open Chat directly
                let analysis = await analyzeFunctionUsingChat(selectedText);
                
                // If chat didn't work, try inline suggestions
                if (!analysis || analysis.length < 50) {
                    outputChannel.appendLine('Chat failed or returned insufficient data, trying inline suggestions...');
                    analysis = await analyzeFunctionUsingInlineSuggestions(selectedText);
                }
                
                // If we still don't have an analysis, try with GitHub.dev approach
                if (!analysis || analysis.length < 50) {
                    outputChannel.appendLine('Inline suggestions failed, trying alternative method...');
                    analysis = await analyzeFunctionWithAlternative(selectedText);
                }
                
                // Final check if we got any usable analysis
                if (!analysis || analysis.length < 50) {
                    panel.webview.html = getErrorHtml('Could not get a good analysis from Copilot. Please make sure GitHub Copilot is properly installed, signed in, and working.');
                    return;
                }
                
                // Try to get benchmark results
                let benchmarkResults = await getBenchmarkResults(selectedText);
                
                // If we couldn't get benchmark results, use a fallback
                if (!benchmarkResults || benchmarkResults.length < 50) {
                    benchmarkResults = `
*Benchmark information could not be retrieved from Copilot. Here's a theoretical comparison:*

In general, the optimized implementations should perform better with the following characteristics:
- More efficient use of built-in methods and language features
- Reduced time complexity for operations
- Better memory usage patterns
- Potentially taking advantage of caching or memoization

For precise benchmark results, you can use Benny.js to compare the implementations manually.
`;
                }
                
                // Combine the analysis and benchmark results
                const fullAnalysis = `# Function Performance Analysis

${analysis}

## Benchmark Results

${benchmarkResults}`;
                
                // Display the results
                panel.webview.html = getResultsHtml(fullAnalysis);
                
                // Bring the panel to focus
                panel.reveal(vscode.ViewColumn.Two);
                
            } catch (error: any) {
                outputChannel.appendLine(`Error during analysis: ${error.message}`);
                panel.webview.html = getErrorHtml(`An error occurred: ${error.message}. Make sure GitHub Copilot is properly installed and signed in.`);
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
 * Check if either Copilot or Copilot Chat is available
 */
async function checkCopilotOrChatAvailable(): Promise<boolean> {
    const copilot = vscode.extensions.getExtension('GitHub.copilot');
    const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
    
    if (copilot || copilotChat) {
        outputChannel.appendLine(`Copilot: ${copilot ? 'Found' : 'Not found'}, Copilot Chat: ${copilotChat ? 'Found' : 'Not found'}`);
        return true;
    }
    
    return false;
}

/**
 * Analyze a function using Copilot Chat directly
 */
async function analyzeFunctionUsingChat(functionText: string): Promise<string> {
    outputChannel.appendLine('Attempting to use Copilot Chat for analysis...');
    
    try {
        // Create the analysis prompt
        const analysisPrompt = `
I need you to analyze this JavaScript function and provide two alternative implementations that should be more efficient:

\`\`\`javascript
${functionText}
\`\`\`

Please:
1. Analyze the time complexity of the original function
2. Analyze the space complexity of the original function
3. Explain the algorithm and potential bottlenecks
4. Provide two alternative implementations with better performance characteristics
5. Name the implementations "alternativeOne" and "alternativeTwo"
6. Explain why each alternative should perform better

Format your response as markdown.
`;

        // Try to open Copilot Chat
        const chatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
        if (chatExtension && chatExtension.isActive) {
            // Open Chat panel directly if it's available
            outputChannel.appendLine('Copilot Chat extension is active, trying to open panel');
            
            // Try opening the panel by command
            try {
                await vscode.commands.executeCommand('github.copilot.interactiveEditor.explain');
                await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                
                // Wait for the interface to load
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Type the prompt
                await vscode.env.clipboard.writeText(analysisPrompt);
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                
                // Submit the prompt
                await vscode.commands.executeCommand('editor.action.addCommentLine');
                
                // Wait for a response (this is just a placeholder since we can't easily capture the response from chat)
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // For Chat, we'll need to return a dummy string since we can't capture the output
                return "Analysis has been sent to Copilot Chat. Please check the chat panel.";
            } catch (chatErr) {
                outputChannel.appendLine(`Error using Copilot Chat panel: ${chatErr}`);
            }
        }
        
        // If direct chat panel didn't work, try opening a temp file for chatting
        outputChannel.appendLine('Direct chat panel failed, trying temp file approach');
        const tempChatFile = await createTempFile(analysisPrompt, 'perf-chat-prompt.md');
        
        // Open the temp file
        const chatDoc = await vscode.workspace.openTextDocument(tempChatFile);
        await vscode.window.showTextDocument(chatDoc);
        
        // Try to trigger Copilot chat/explain command
        try {
            await vscode.commands.executeCommand('github.copilot.generate');
            // Wait a bit for the generation
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Get the response text (might be incomplete)
            const responseText = chatDoc.getText();
            
            // Clean up
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            try {
                fs.unlinkSync(tempChatFile);
            } catch {}
            
            // Extract just the response part (after our prompt)
            return responseText.substring(analysisPrompt.length).trim();
        } catch (err) {
            outputChannel.appendLine(`Error generating with Copilot: ${err}`);
            return "";
        }
    } catch (error: any) {
        outputChannel.appendLine(`Error in Copilot Chat analysis: ${error.message}`);
        return "";
    }
}

/**
 * Analyze a function using inline suggestions
 */
async function analyzeFunctionUsingInlineSuggestions(functionText: string): Promise<string> {
    outputChannel.appendLine('Attempting to use inline suggestions for analysis...');
    
    try {
        // Create content for the temp file
        const analysisContent = createAnalysisContent(functionText);
        const tempFilePath = await createTempFile(analysisContent, 'perf-analysis.js');
        
        outputChannel.appendLine(`Created temp file at: ${tempFilePath}`);
        
        // Open the temp file
        const document = await vscode.workspace.openTextDocument(tempFilePath);
        const tempEditor = await vscode.window.showTextDocument(document, { preview: true });
        
        // Make sure inline suggestions are enabled
        const config = vscode.workspace.getConfiguration('editor');
        const inlineSuggestEnabled = config.get('inlineSuggest.enabled');
        if (!inlineSuggestEnabled) {
            await config.update('inlineSuggest.enabled', true, true);
        }
        
        // Place cursor at the end of the document
        const lastLine = document.lineCount - 1;
        const lastChar = document.lineAt(lastLine).text.length;
        tempEditor.selection = new vscode.Selection(
            new vscode.Position(lastLine, lastChar),
            new vscode.Position(lastLine, lastChar)
        );
        
        // Force trigger inline suggestions
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        outputChannel.appendLine('Triggered inline suggestions');
        
        // Wait for Copilot to analyze and provide suggestions
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if we got an inline suggestion and accept it
        await vscode.commands.executeCommand('editor.action.inlineSuggest.accept');
        outputChannel.appendLine('Accepted inline suggestions');
        
        // Wait a little more for the suggestion to be accepted
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get the entire document text which should now include the Copilot analysis
        const analysisText = document.getText();
        const analysis = extractAnalysis(analysisText, analysisContent);
        
        outputChannel.appendLine(`Analysis extracted (${analysis.length} chars)`);
        
        // Close the temp editor
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // Delete the temp file
        try {
            fs.unlinkSync(tempFilePath);
            outputChannel.appendLine('Deleted temp file');
        } catch (err) {
            // Ignore deletion errors
            outputChannel.appendLine(`Failed to delete temp file: ${err}`);
        }
        
        // Restore inline suggest setting if needed
        if (!inlineSuggestEnabled) {
            await config.update('inlineSuggest.enabled', false, true);
        }
        
        return analysis;
    } catch (error: any) {
        outputChannel.appendLine(`Error in inline suggestions analysis: ${error.message}`);
        return "";
    }
}

/**
 * Get benchmark results for a function
 */
async function getBenchmarkResults(functionText: string): Promise<string> {
    outputChannel.appendLine('Attempting to get benchmark results...');
    
    try {
        // Create content for the benchmark temp file
        const benchmarkContent = createBenchmarkContent(functionText);
        const benchTempFilePath = await createTempFile(benchmarkContent, 'perf-benchmark.js');
        
        outputChannel.appendLine(`Created benchmark temp file at: ${benchTempFilePath}`);
        
        // Open the benchmark temp file
        const benchDocument = await vscode.workspace.openTextDocument(benchTempFilePath);
        const benchEditor = await vscode.window.showTextDocument(benchDocument, { preview: true });
        
        // Make sure inline suggestions are enabled
        const config = vscode.workspace.getConfiguration('editor');
        const inlineSuggestEnabled = config.get('inlineSuggest.enabled');
        if (!inlineSuggestEnabled) {
            await config.update('inlineSuggest.enabled', true, true);
        }
        
        // Place cursor at the end of the document
        const benchLastLine = benchDocument.lineCount - 1;
        const benchLastChar = benchDocument.lineAt(benchLastLine).text.length;
        benchEditor.selection = new vscode.Selection(
            new vscode.Position(benchLastLine, benchLastChar),
            new vscode.Position(benchLastLine, benchLastChar)
        );
        
        // Force trigger inline suggestions
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        outputChannel.appendLine('Triggered benchmark inline suggestions');
        
        // Wait for Copilot to analyze and provide suggestions
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Accept the suggestion
        await vscode.commands.executeCommand('editor.action.inlineSuggest.accept');
        outputChannel.appendLine('Accepted benchmark inline suggestions');
        
        // Wait a little more
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get the benchmark text
        const benchmarkText = benchDocument.getText();
        const benchmarkResults = extractAnalysis(benchmarkText, benchmarkContent);
        
        outputChannel.appendLine(`Benchmark results extracted (${benchmarkResults.length} chars)`);
        
        // Close the benchmark editor
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // Delete the benchmark temp file
        try {
            fs.unlinkSync(benchTempFilePath);
            outputChannel.appendLine('Deleted benchmark temp file');
        } catch (err) {
            // Ignore deletion errors
            outputChannel.appendLine(`Failed to delete benchmark temp file: ${err}`);
        }
        
        // Restore inline suggest setting if needed
        if (!inlineSuggestEnabled) {
            await config.update('inlineSuggest.enabled', false, true);
        }
        
        return benchmarkResults;
    } catch (error: any) {
        outputChannel.appendLine(`Error in benchmark analysis: ${error.message}`);
        return "";
    }
}

/**
 * Alternative method to analyze a function with fallback
 */
async function analyzeFunctionWithAlternative(functionText: string): Promise<string> {
    outputChannel.appendLine('Attempting alternative function analysis method...');
    
    try {
        // This is a third fallback method that might work in environments like GitHub.dev
        // Try to use VS Code's built-in commands for AI features
        
        // Create a new untitled document with the function
        const doc = await vscode.workspace.openTextDocument({ 
            content: `
// Function to analyze:
${functionText}

/*
Please analyze this function and provide:
1. Time complexity analysis
2. Space complexity analysis
3. Algorithm explanation with bottlenecks
4. Two alternative implementations named "alternativeOne" and "alternativeTwo"
5. Performance comparison between implementations

The output should be formatted as markdown.
*/

// Analysis:

`,
            language: 'javascript'
        });
        
        // Show the document
        const editor = await vscode.window.showTextDocument(doc);
        
        // Position cursor where we want the suggestions
        const line = doc.lineCount - 1;
        editor.selection = new vscode.Selection(
            new vscode.Position(line, 0),
            new vscode.Position(line, 0)
        );
        
        // Try various commands that might trigger AI assistance
        const commands = [
            'editor.action.inlineSuggest.trigger',
            'github.copilot.generate',
            'editor.action.inlineCompletionShow',
            'editor.action.inlineSuggest.showNext',
            'github.copilot.interactiveEditor.explain'
        ];
        
        for (const command of commands) {
            try {
                outputChannel.appendLine(`Trying command: ${command}`);
                await vscode.commands.executeCommand(command);
                // Wait a bit to see if it worked
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Check if we got content
                const text = doc.getText();
                if (text.length > 500) {  // Arbitrary length that's more than our template
                    outputChannel.appendLine(`Got response with command: ${command}`);
                    break;
                }
            } catch (err) {
                outputChannel.appendLine(`Command ${command} failed: ${err}`);
            }
        }
        
        // Wait a bit longer for any slow responses
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get the text and extract the analysis part
        const text = doc.getText();
        let analysis = text.split('// Analysis:')[1] || '';
        
        // If we didn't get anything useful, add a basic placeholder
        if (analysis.length < 50) {
            analysis = `
Unfortunately, the automated analysis could not generate a response. Here are some general guidelines:

Time Complexity: 
- Check if the function has nested loops (O(n²))
- Look for linear scans (O(n))
- Identify constant time operations (O(1))

Space Complexity:
- Note how much extra memory is allocated
- Check if memory usage scales with input size

Alternative Implementations:
- Consider using built-in methods
- Look for algorithms with better time complexity
- Consider memoization or caching
`;
        }
        
        // Close the editor without saving
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor', { silent: true });
        
        return analysis;
    } catch (error: any) {
        outputChannel.appendLine(`Error in alternative analysis: ${error.message}`);
        return "";
    }
}

/**
 * Create a temporary file with the provided content
 */
async function createTempFile(content: string, fileName: string): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, fileName);
    
    return new Promise((resolve, reject) => {
        fs.writeFile(tempFilePath, content, 'utf8', (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(tempFilePath);
            }
        });
    });
}

/**
 * Create the content for the analysis file
 */
function createAnalysisContent(functionText: string): string {
    return `// PerfCopilot Function Analysis
// Function to analyze:

${functionText}

/*
Please provide an analysis of the function above, including:
1. Time complexity analysis
2. Space complexity analysis
3. Explanation of the algorithm and possible bottlenecks
4. Two alternative implementations with better performance characteristics

Please name the alternative implementations "alternativeOne" and "alternativeTwo" and
explain the performance improvements in each.

Format your response as markdown.
*/

// Analysis:
`;
}

/**
 * Create the content for the benchmark file
 */
function createBenchmarkContent(functionText: string): string {
    return `// PerfCopilot Benchmark Analysis
// Original function:

${functionText}

/*
Please provide a benchmarking analysis using the Benny.js library. Include:
1. A complete benchmark script that compares the original function with two optimized alternatives
2. Real benchmark results showing operations per second
3. An explanation of which implementation is fastest and why

Format your response as markdown.
*/

// Benchmark Analysis:
`;
}

/**
 * Extract the analysis from the full text
 */
function extractAnalysis(fullText: string, promptText: string): string {
    // Get everything after the initial prompt
    if (fullText.length <= promptText.length) {
        return "No analysis was generated. Please try again or make sure GitHub Copilot is properly configured.";
    }
    
    // Extract the analysis - everything after the prompt
    return fullText.substring(promptText.length).trim();
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