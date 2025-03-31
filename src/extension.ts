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
            
            // Copy the selected function to clipboard
            await vscode.env.clipboard.writeText(selectedText);
            outputChannel.appendLine('Copied function to clipboard');
            
            // Instructions for the user
            vscode.window.showInformationMessage(
                'Function copied to clipboard. Please open Copilot Chat, paste the function, and ask for alternatives and benchmarking.'
            );
            
            // Try to focus Copilot Chat
            try {
                // First check if the Copilot Chat extension is available
                const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
                
                if (!copilotChat) {
                    outputChannel.appendLine('Copilot Chat extension not found');
                    vscode.window.showInformationMessage(
                        'GitHub Copilot Chat extension not found. Please install it from the marketplace, ' +
                        'then open it manually using the Copilot Chat icon in the sidebar.'
                    );
                    return;
                }
                
                // Try to activate it if needed
                if (!copilotChat.isActive) {
                    await copilotChat.activate();
                    outputChannel.appendLine('Activated Copilot Chat extension');
                }
                
                // Try multiple commands to open Copilot Chat
                const chatCommands = [
                    'github.copilot.chat.focus',
                    'workbench.action.chat.open',
                    'github.copilot.interactiveEditor.explain'
                ];
                
                let success = false;
                
                for (const cmd of chatCommands) {
                    try {
                        outputChannel.appendLine(`Trying to open chat with command: ${cmd}`);
                        await vscode.commands.executeCommand(cmd);
                        success = true;
                        outputChannel.appendLine(`Successfully opened chat with command: ${cmd}`);
                        break;
                    } catch (cmdError) {
                        outputChannel.appendLine(`Command failed: ${cmd} - ${cmdError}`);
                    }
                }
                
                if (!success) {
                    throw new Error('All chat open commands failed');
                }
                
                // Wait a bit
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Try to paste the text
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                outputChannel.appendLine('Attempted to paste text into chat');
                
                // Wait another second
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Type the first query
                const firstQuery = "can you create two alternative functions for this?";
                await vscode.env.clipboard.writeText(firstQuery);
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                outputChannel.appendLine('Typed first query');
                
                // Try multiple submit commands to find one that works
                const submitCommands = [
                    'github.copilot.chat.submit',  // Direct Copilot Chat submit command
                    'workbench.action.chat.submit', // VSCode chat submit
                    'editor.action.inlineSuggest.commit', // Generic submit
                    'workbench.action.terminal.sendSequence', // Terminal sequence
                    'workbench.action.acceptSelectedQuickOpenItem' // Quick open accept
                ];
                
                for (const cmd of submitCommands) {
                    try {
                        if (cmd === 'workbench.action.terminal.sendSequence') {
                            // Special case for terminal sequence
                            await vscode.commands.executeCommand(cmd, { text: '\u000D' }); // Carriage return
                        } else {
                            await vscode.commands.executeCommand(cmd);
                        }
                        outputChannel.appendLine(`Tried submit command: ${cmd}`);
                    } catch (submitError) {
                        outputChannel.appendLine(`Submit command failed: ${cmd} - ${submitError}`);
                    }
                    
                    // Small delay between attempts
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                
                // Press Enter key directly as a last resort
                try {
                    await vscode.commands.executeCommand('type', { text: '\n' });
                    outputChannel.appendLine('Tried direct Enter key');
                } catch (typeError) {
                    outputChannel.appendLine(`Type command failed: ${typeError}`);
                }
                
                outputChannel.appendLine('Tried to submit first query');
                
                // Wait for response (10 seconds)
                vscode.window.showInformationMessage('Waiting for Copilot to generate alternative functions...');
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Type the second query
                const secondQuery = `can you now use benny to test the three functions. Here's a template:

const b = require('benny');

// The three functions to benchmark

// Original function 
// (paste the original function here)

// Alternative 1
// (paste the first alternative function here)

// Alternative 2
// (paste the second alternative function here)

// Create test data
const testArray = Array.from({ length: 100000 }, () => Math.random());

// Run the benchmark
b.suite(
  'Array Sum Functions Benchmark',

  b.add('Original Function', () => {
    // Call the original function with testArray
  }),

  b.add('Alternative 1', () => {
    // Call alternative 1 with testArray
  }),

  b.add('Alternative 2', () => {
    // Call alternative 2 with testArray
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: 'results', format: 'json' })
);`;
                await vscode.env.clipboard.writeText(secondQuery);
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                outputChannel.appendLine('Typed second query with Benny.js template');
                
                // Try the submit commands again for the second query
                for (const cmd of submitCommands) {
                    try {
                        if (cmd === 'workbench.action.terminal.sendSequence') {
                            // Special case for terminal sequence
                            await vscode.commands.executeCommand(cmd, { text: '\u000D' }); // Carriage return
                        } else {
                            await vscode.commands.executeCommand(cmd);
                        }
                        outputChannel.appendLine(`Tried submit command for second query: ${cmd}`);
                    } catch (submitError) {
                        outputChannel.appendLine(`Submit command failed for second query: ${cmd} - ${submitError}`);
                    }
                    
                    // Small delay between attempts
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                
                // Press Enter key directly as a last resort
                try {
                    await vscode.commands.executeCommand('type', { text: '\n' });
                    outputChannel.appendLine('Tried direct Enter key for second query');
                } catch (typeError) {
                    outputChannel.appendLine(`Type command failed for second query: ${typeError}`);
                }
                
                outputChannel.appendLine('Tried to submit second query');
                
                // Final instructions
                vscode.window.showInformationMessage(
                    'PerfCopilot has asked Copilot Chat to analyze your function and provide benchmarks. ' +
                    'Please wait for the complete response in the Copilot Chat panel.'
                );
            } catch (error) {
                outputChannel.appendLine(`Error opening Copilot Chat: ${error}`);
                
                // Show a more detailed message with step-by-step instructions
                vscode.window.showInformationMessage('Could not automatically open Copilot Chat. Please follow these steps manually:');
                
                // Using multiple info messages for better readability
                setTimeout(() => {
                    vscode.window.showInformationMessage('1. Open Copilot Chat from the sidebar (Copilot icon) or by pressing Ctrl/Cmd+Shift+I');
                }, 1000);
                
                setTimeout(() => {
                    vscode.window.showInformationMessage('2. Paste the function (already copied to clipboard)');
                }, 2000);
                
                setTimeout(() => {
                    vscode.window.showInformationMessage('3. Type: "can you create two alternative functions for this?"');
                }, 3000);
                
                setTimeout(() => {
                    const benchmarkInstructions = 'After getting the response, ask Copilot to create a benchmark with Benny.js. Use View > Output > PerfCopilot to see the template.';
                    vscode.window.showInformationMessage('4. ' + benchmarkInstructions);
                    
                    // Show the template in the output channel so the user can copy it
                    outputChannel.appendLine('\n--- BENCHMARK TEMPLATE ---');
                    outputChannel.appendLine(`
const b = require('benny');

// The three functions to benchmark (paste them here from the chat)

// Original function 
// (original function here)

// Alternative 1
// (alternative 1 here)

// Alternative 2
// (alternative 2 here)

// Create test data
const testArray = Array.from({ length: 100000 }, () => Math.random());

// Run the benchmark
b.suite(
  'Array Sum Functions Benchmark',

  b.add('Original Function', () => {
    // Call the original function with testArray
  }),

  b.add('Alternative 1', () => {
    // Call alternative 1 with testArray
  }),

  b.add('Alternative 2', () => {
    // Call alternative 2 with testArray
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: 'results', format: 'json' })
);`);
                    outputChannel.appendLine('--- END TEMPLATE ---\n');
                    outputChannel.show();
                }, 4000);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
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