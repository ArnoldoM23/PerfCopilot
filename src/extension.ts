import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

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
                // Get function alternatives from Copilot Chat
                const alternatives = await getFunctionAlternativesFromChat(selectedText);
                if (!alternatives) {
                    panel.webview.html = getErrorHtml('Could not get alternatives from Copilot Chat. Please make sure GitHub Copilot Chat is installed and working.');
                    return;
                }
                
                outputChannel.appendLine(`Got alternatives: ${alternatives.length} bytes`);
                
                // Extract the alternative functions
                const extractedFunctions = extractFunctionsFromChatResponse(alternatives, selectedText);
                
                if (!extractedFunctions || Object.keys(extractedFunctions).length < 2) {
                    panel.webview.html = getErrorHtml('Could not extract alternative functions from Copilot Chat response.');
                    return;
                }
                
                // Create benchmark file and run it
                const benchmarkResults = await createAndRunBenchmark(extractedFunctions);
                
                // Format the results nicely
                const formattedResults = await formatBenchmarkResultsWithCopilot(extractedFunctions, benchmarkResults);
                
                // Display the results
                panel.webview.html = getResultsHtml(formattedResults);
                
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
 * Get function alternatives from Copilot Chat
 */
async function getFunctionAlternativesFromChat(functionText: string): Promise<string> {
    outputChannel.appendLine('Getting function alternatives from Copilot Chat...');
    
    try {
        // Create a temporary markdown file to store the chat
        const chatPrompt = `can you create two alternative functions for this?\n\n${functionText}`;
        const chatFile = await createTempFile(chatPrompt, 'copilot-chat-functions.md');
        
        // Open the chat file
        const document = await vscode.workspace.openTextDocument(chatFile);
        await vscode.window.showTextDocument(document);
        
        // Send the question to Copilot Chat
        await vscode.commands.executeCommand('github.copilot.chat.sendToChat');
        
        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get the response text
        const response = document.getText();
        
        // Close the editor
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // Return the response
        return response;
    } catch (error: any) {
        outputChannel.appendLine(`Error getting alternatives from chat: ${error.message}`);
        throw new Error('Failed to get alternatives from Copilot Chat');
    }
}

/**
 * Extract functions from Copilot Chat response
 */
function extractFunctionsFromChatResponse(response: string, originalFunction: string): Record<string, string> {
    outputChannel.appendLine('Extracting functions from chat response...');
    
    const result: Record<string, string> = {
        'original': originalFunction
    };
    
    // Extract function definitions using regex
    const functionRegex = /function\s+(\w+)\s*\([^)]*\)\s*{[\s\S]*?}/g;
    let match;
    while ((match = functionRegex.exec(response)) !== null) {
        const fullFunction = match[0];
        // Extract function name using another regex
        const nameMatch = /function\s+(\w+)/.exec(fullFunction);
        if (nameMatch && nameMatch[1]) {
            const functionName = nameMatch[1];
            result[functionName] = fullFunction;
        }
    }
    
    outputChannel.appendLine(`Extracted ${Object.keys(result).length - 1} alternative functions`);
    return result;
}

/**
 * Create and run a benchmark file for the functions
 */
async function createAndRunBenchmark(functions: Record<string, string>): Promise<string> {
    outputChannel.appendLine('Creating and running benchmark...');
    
    try {
        // Create a benchmark file
        const benchmarkFileContent = `
// Generated benchmark file
const b = require('benny');

// Functions to benchmark
${Object.values(functions).join('\n\n')}

// Create a test array of random numbers
const testArray = Array.from({ length: 100000 }, () => Math.random());

// Run benchmarks
module.exports = b.suite(
  'Array Function Benchmark',

  ${Object.keys(functions).map(name => `b.add('${name}', () => {
    ${name}(testArray);
  })`).join(',\n\n  ')},

  b.cycle(),
  b.complete(),
  b.save({ file: 'benchmark-results', format: 'json' })
);
`;

        const benchmarkFile = await createTempFile(benchmarkFileContent, 'benchmark.js');
        
        // Create a package.json if it doesn't exist in the temp directory
        const packageJsonPath = path.join(path.dirname(benchmarkFile), 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            const packageJson = {
                "name": "benchmark-temp",
                "version": "1.0.0",
                "description": "Temporary package for benchmarking",
                "dependencies": {
                    "benny": "^3.7.1"
                }
            };
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        }
        
        // Install dependencies
        const npmInstallResult = await runCommand('npm install benny', path.dirname(benchmarkFile));
        outputChannel.appendLine(`npm install result: ${npmInstallResult}`);
        
        // Run the benchmark
        const benchmarkResult = await runCommand(`node "${benchmarkFile}"`, path.dirname(benchmarkFile));
        outputChannel.appendLine(`Benchmark result: ${benchmarkResult}`);
        
        // Read the JSON results if available
        const resultsPath = path.join(path.dirname(benchmarkFile), 'benchmark-results.json');
        if (fs.existsSync(resultsPath)) {
            try {
                const resultsJson = fs.readFileSync(resultsPath, 'utf8');
                outputChannel.appendLine('Read benchmark results from JSON file');
                return resultsJson;
            } catch (err) {
                outputChannel.appendLine(`Error reading results JSON: ${err}`);
            }
        }
        
        // Return the raw output if JSON file is not available
        return benchmarkResult;
    } catch (error: any) {
        outputChannel.appendLine(`Error in benchmark: ${error.message}`);
        throw new Error(`Failed to run benchmark: ${error.message}`);
    }
}

/**
 * Run a command asynchronously
 */
async function runCommand(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        child_process.exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Command error: ${error.message}`);
                outputChannel.appendLine(`stderr: ${stderr}`);
                reject(new Error(`Command failed: ${error.message}`));
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * Format benchmark results with Copilot
 */
async function formatBenchmarkResultsWithCopilot(functions: Record<string, string>, benchmarkResults: string): Promise<string> {
    outputChannel.appendLine('Formatting benchmark results with Copilot...');
    
    try {
        // Create a temporary file for Copilot to format the results
        const formatPrompt = `
# Benchmark Results

Here are the functions that were benchmarked:

${Object.entries(functions).map(([name, code]) => `## ${name}\n\`\`\`js\n${code}\n\`\`\``).join('\n\n')}

## Raw Benchmark Results
\`\`\`
${benchmarkResults}
\`\`\`

Please format these benchmark results in a nice way, identifying the fastest function and explaining why it might be faster. Also suggest any other optimizations that could be made.
`;

        const formatFile = await createTempFile(formatPrompt, 'format-results.md');
        
        // Open the file
        const document = await vscode.workspace.openTextDocument(formatFile);
        await vscode.window.showTextDocument(document);
        
        // Send to Copilot Chat
        await vscode.commands.executeCommand('github.copilot.chat.sendToChat');
        
        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 7000));
        
        // Get the response
        const formattedResponse = document.getText();
        
        // Close the editor
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // Extract the formatted part (after the prompt)
        const splitPoint = formattedResponse.indexOf('# Benchmark Results');
        const formatted = splitPoint >= 0
            ? formattedResponse.substring(splitPoint)
            : formattedResponse;
        
        return formatted;
    } catch (error: any) {
        outputChannel.appendLine(`Error formatting results: ${error.message}`);
        // Return a basic format if Copilot formatting fails
        return `# Benchmark Results

${benchmarkResults}

## Functions
${Object.entries(functions).map(([name, code]) => `### ${name}\n\`\`\`js\n${code}\n\`\`\``).join('\n\n')}
`;
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