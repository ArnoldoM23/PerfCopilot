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
            const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
            if (!copilotExtension) {
                vscode.window.showErrorMessage('GitHub Copilot extension is required but not installed. Please install it from the marketplace.');
                return;
            }
            
            outputChannel.appendLine(`Found GitHub Copilot extension (${copilotExtension.packageJSON.version})`);
            
            // Check if inline suggestions are enabled
            const config = vscode.workspace.getConfiguration('editor');
            const inlineSuggestEnabled = config.get('inlineSuggest.enabled');
            
            if (!inlineSuggestEnabled) {
                // Try to enable it
                outputChannel.appendLine('Inline suggestions are disabled, attempting to enable temporarily');
                await config.update('inlineSuggest.enabled', true, true);
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
                // Use a simple approach - create a temporary file with our instructions and function
                const analysisContent = createAnalysisContent(selectedText);
                const tempFilePath = await createTempFile(analysisContent, 'perf-analysis.js');
                
                outputChannel.appendLine(`Created temp file at: ${tempFilePath}`);
                
                // Open the temp file
                const document = await vscode.workspace.openTextDocument(tempFilePath);
                const tempEditor = await vscode.window.showTextDocument(document, { preview: true });
                
                // Place cursor at the end of the document
                const lastLine = document.lineCount - 1;
                const lastChar = document.lineAt(lastLine).text.length;
                tempEditor.selection = new vscode.Selection(
                    new vscode.Position(lastLine, lastChar),
                    new vscode.Position(lastLine, lastChar)
                );
                
                // Tell the user what's happening
                vscode.window.showInformationMessage('Please wait while Copilot analyzes the function. This may take a few seconds...');
                
                // Force trigger inline suggestions
                await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
                outputChannel.appendLine('Triggered inline suggestions');
                
                // Wait a bit to ensure Copilot has time to analyze and provide suggestions
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
                
                // Check if we actually got any analysis
                if (analysis.length < 50) {
                    outputChannel.appendLine('Analysis looks too short, might not have received Copilot suggestions');
                    panel.webview.html = getErrorHtml(`Could not get analysis from Copilot. Please make sure GitHub Copilot is properly installed, signed in, and providing suggestions in your editor.`);
                    return;
                }
                
                // Create the benchmark content
                const benchmarkContent = createBenchmarkContent(selectedText);
                const benchTempFilePath = await createTempFile(benchmarkContent, 'perf-benchmark.js');
                
                outputChannel.appendLine(`Created benchmark temp file at: ${benchTempFilePath}`);
                
                // Open the benchmark temp file
                const benchDocument = await vscode.workspace.openTextDocument(benchTempFilePath);
                const benchEditor = await vscode.window.showTextDocument(benchDocument, { preview: true });
                
                // Place cursor at the end of the document
                const benchLastLine = benchDocument.lineCount - 1;
                const benchLastChar = benchDocument.lineAt(benchLastLine).text.length;
                benchEditor.selection = new vscode.Selection(
                    new vscode.Position(benchLastLine, benchLastChar),
                    new vscode.Position(benchLastLine, benchLastChar)
                );
                
                // Show info message
                vscode.window.showInformationMessage('Now generating benchmark comparison...');
                
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
                
                // Combine the analysis and benchmark results
                const fullAnalysis = `# Function Performance Analysis

${analysis}

## Benchmark Results

${benchmarkResults}`;
                
                // Display the results
                panel.webview.html = getResultsHtml(fullAnalysis);
                
                // Bring the panel to focus
                panel.reveal(vscode.ViewColumn.Two);
                
                // Restore inline suggest setting if we changed it
                if (!inlineSuggestEnabled) {
                    await config.update('inlineSuggest.enabled', false, true);
                    outputChannel.appendLine('Restored inline suggestions setting');
                }
                
            } catch (error: any) {
                outputChannel.appendLine(`Error during analysis: ${error.message}`);
                panel.webview.html = getErrorHtml(`An error occurred: ${error.message}. Make sure GitHub Copilot is properly installed and signed in.`);
                
                // Restore inline suggest setting if needed
                if (!inlineSuggestEnabled) {
                    await config.update('inlineSuggest.enabled', false, true);
                }
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