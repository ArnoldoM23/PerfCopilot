/**
 * PerfCopilot extension entry point
 * 
 * This extension helps identify performance improvements for JavaScript/TypeScript functions
 * using GitHub Copilot to suggest optimized alternatives and benchmark them.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PerfCopilotParticipant } from './perfCopilotParticipant';
import { CopilotChatService } from './services/copilotChatService';
import { BenchmarkService } from './services/benchmarkService';

// The extension output channel
let outputChannel: vscode.OutputChannel;

interface ChatQuery {
    text: string;
    description: string;
    retryCount: number;
    waitForResponse: boolean;
    maxWaitTime?: number;
}

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context - The extension context
 */
export function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel('PerfCopilot');
    outputChannel.appendLine('PerfCopilot extension activated');
    
    // Create services
    const copilotChatService = new CopilotChatService(outputChannel);
    const benchmarkService = new BenchmarkService(outputChannel);
    
    // Register the PerfCopilot chat participant
    try {
        outputChannel.appendLine('Registering PerfCopilot chat participant...');
        const participant = new PerfCopilotParticipant(
            outputChannel,
            copilotChatService,
            benchmarkService
        );
        
        // Add participant to disposables
        const disposableParticipant = participant.register();
        context.subscriptions.push(disposableParticipant);
        
        outputChannel.appendLine('PerfCopilot chat participant registered successfully');
    } catch (error) {
        outputChannel.appendLine(`Failed to register PerfCopilot chat participant: ${error}`);
    }
    
    // Register the command to analyze a function using UI automation
    const disposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        try {
            const functionCode = getSelectedFunction();
            if (!functionCode) {
                return; // Error already shown to user
            }
            
            // Show in-progress notification
            const inProgressNotification = vscode.window.setStatusBarMessage('PerfCopilot: Opening VS Code Chat...');
            
            try {
                // Copy the function to clipboard
                await vscode.env.clipboard.writeText(functionCode);
                
                // Open VS Code Chat
                await vscode.commands.executeCommand('workbench.action.chat.open');
                
                // Wait for chat to open
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Paste the function
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                
                // Wait for paste to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Send @perfcopilot command
                await vscode.commands.executeCommand('type', { text: '@perfcopilot' });
                
                // Wait for typing to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Send Enter key
                await vscode.commands.executeCommand('type', { text: '\n' });
                
                // Show success message
                vscode.window.showInformationMessage(
                    'PerfCopilot: Function analysis started. Please wait for the results in the chat.'
                );
            } finally {
                // Clear the status bar message
                inProgressNotification.dispose();
            }
        } catch (error) {
            outputChannel.appendLine(`Error in analyzeFunction command: ${error}`);
            vscode.window.showErrorMessage(`Error analyzing function: ${error}`);
        }
    });
    
    // Register show logs command
    const showLogsDisposable = vscode.commands.registerCommand('perfcopilot.showLogs', () => {
        outputChannel.show();
    });
    
    // Add to subscriptions
    context.subscriptions.push(disposable);
    context.subscriptions.push(showLogsDisposable);
}

/**
 * Gets the selected function from the active editor
 * @returns The selected function code or undefined if none selected
 */
function getSelectedFunction(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return undefined;
    }
    
    // Get the selected text
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    
    if (!selectedText) {
        vscode.window.showErrorMessage('No function selected');
        return undefined;
    }
    
    outputChannel.appendLine(`Analyzing function: ${selectedText.substring(0, 50)}...`);
    outputChannel.appendLine(`Function code length: ${selectedText.length} characters`);
    return selectedText;
}

/**
 * Ensures that Copilot Chat is open and ready to receive input
 * @returns True if Copilot Chat is open, false otherwise
 */
async function ensureCopilotChatIsOpen(): Promise<boolean> {
    try {
        // First check if the Copilot Chat extension is available
        const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
        
        if (!copilotChat) {
            outputChannel.appendLine('Copilot Chat extension not found');
            vscode.window.showInformationMessage(
                'GitHub Copilot Chat extension not found. Please install it from the marketplace.',
                'Open Extensions'
            ).then(selection => {
                if (selection === 'Open Extensions') {
                    vscode.commands.executeCommand('workbench.extensions.search', '@category:"chatgpt"');
                }
            });
            return false;
        }
        
        // Try to activate it if needed
        if (!copilotChat.isActive) {
            await copilotChat.activate();
            outputChannel.appendLine('Activated Copilot Chat extension');
            // Wait for activation to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Try multiple commands to open Copilot Chat
        const chatCommands = [
            'github.copilot.chat.focus',
            'workbench.action.chat.open',
            'github.copilot.interactiveEditor.explain'
        ];
        
        for (const cmd of chatCommands) {
            try {
                outputChannel.appendLine(`Trying to open chat with command: ${cmd}`);
                await vscode.commands.executeCommand(cmd);
                outputChannel.appendLine(`Successfully opened chat with command: ${cmd}`);
                // Wait for the chat window to fully open
                await new Promise(resolve => setTimeout(resolve, 1000));
                return true;
            } catch (cmdError) {
                outputChannel.appendLine(`Command failed: ${cmd} - ${cmdError}`);
            }
        }
        
        return false;
    } catch (error) {
        outputChannel.appendLine(`Error ensuring Copilot Chat is open: ${error}`);
        return false;
    }
}

/**
 * Sends queries to Copilot Chat with retries for reliability
 * @param functionCode The function code to analyze
 */
async function sendQueriesWithRetry(functionCode: string): Promise<void> {
    // Queries to send in sequence
    const queries: ChatQuery[] = [
        { 
            text: functionCode,
            description: "Pasting function code",
            retryCount: 3,
            waitForResponse: false
        },
        {
            text: "\n\nCan you provide two optimized alternative implementations for this function that might have better performance?",
            description: "First query for alternatives",
            retryCount: 3,
            waitForResponse: true,
            maxWaitTime: 30000 // 30 seconds max wait time
        },
        {
            text: "\n\nNow use Benny.js to benchmark the original function and the two alternatives. Show an analysis of which is fastest and why.",
            description: "Second query for benchmarking",
            retryCount: 3,
            waitForResponse: true,
            maxWaitTime: 30000 // 30 seconds max wait time
        }
    ];
    
    // List of submit commands to try in order
    const submitCommands = [
        'github.copilot.chat.submit',
        'workbench.action.chat.submit',
        'enter',  // Special handling for Enter key
        'type', // Direct typing (fallback)
    ];
    
    // Process each query
    for (const query of queries) {
        outputChannel.appendLine(`Sending ${query.description}...`);
        
        // Copy to clipboard first
        await vscode.env.clipboard.writeText(query.text);
        outputChannel.appendLine('Copied to clipboard');
        
        // Try to paste the text
        try {
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            outputChannel.appendLine('Pasted text');
        } catch (error) {
            outputChannel.appendLine(`Error pasting text: ${error}`);
            // Show manual instructions if paste fails
            vscode.window.showInformationMessage(
                'Failed to paste text automatically. Please paste the text manually.',
                'Show Instructions'
            ).then(selection => {
                if (selection === 'Show Instructions') {
                    showManualInstructions(functionCode);
                }
            });
            return;
        }
        
        // Wait for the text to be pasted
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try to submit multiple times if needed
        let submitted = false;
        for (let attempt = 0; attempt < query.retryCount && !submitted; attempt++) {
            // Try each submit command
            for (const cmd of submitCommands) {
                try {
                    if (cmd === 'enter') {
                        // Special case for enter key
                        await vscode.env.clipboard.writeText('\n');
                        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                    } else if (cmd === 'type') {
                        await vscode.commands.executeCommand('type', { text: '\n' });
                    } else {
                        await vscode.commands.executeCommand(cmd);
                    }
                    
                    outputChannel.appendLine(`Successfully submitted with ${cmd}`);
                    submitted = true;
                    break;
                } catch (error) {
                    outputChannel.appendLine(`Submit command failed: ${cmd} - ${error}`);
                }
            }
            
            if (!submitted && attempt < query.retryCount - 1) {
                // Wait before retrying
                outputChannel.appendLine(`Retrying submission (attempt ${attempt + 2}/${query.retryCount})...`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        if (!submitted) {
            outputChannel.appendLine(`Failed to submit ${query.description} after ${query.retryCount} attempts`);
            throw new Error(`Failed to submit ${query.description}`);
        }
        
        // If we need to wait for a response, do so
        if (query.waitForResponse) {
            const startTime = Date.now();
            let responseReceived = false;
            
            // Show progress message
            const progressMessage = vscode.window.setStatusBarMessage(
                `PerfCopilot: Waiting for response to ${query.description}...`
            );
            
            // Keep checking for response until we get one or timeout
            while (!responseReceived && (Date.now() - startTime) < (query.maxWaitTime || 30000)) {
                try {
                    // Get the active chat editor
                    const chatEditor = vscode.window.activeTextEditor;
                    if (chatEditor && chatEditor.document.uri.scheme === 'vscode-chat') {
                        // Get the last few lines of the chat
                        const lastLines = chatEditor.document.getText().split('\n').slice(-5);
                        
                        // Check if we see a response from Copilot
                        if (lastLines.some(line => 
                            line.includes('Copilot:') || 
                            line.includes('GitHub Copilot:') ||
                            line.includes('```') // Code block indicates response
                        )) {
                            responseReceived = true;
                            outputChannel.appendLine(`Received response for ${query.description}`);
                            break;
                        }
                    }
                    
                    // Wait a bit before checking again
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    outputChannel.appendLine(`Error checking for response: ${error}`);
                }
            }
            
            // Clear progress message
            progressMessage.dispose();
            
            if (!responseReceived) {
                outputChannel.appendLine(`Timeout waiting for response to ${query.description}`);
                throw new Error(`Timeout waiting for response to ${query.description}`);
            }
        }
    }
    
    // Show success message
    vscode.window.showInformationMessage(
        'PerfCopilot has completed analyzing your function. Check the chat for results.'
    );
}

/**
 * Shows manual instructions for using PerfCopilot
 * @param functionCode The function code that was selected
 */
function showManualInstructions(functionCode: string): void {
    // Create a temporary file with instructions
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, 'perfcopilot-instructions.md');
    
    // Generate markdown instructions
    const instructions = `# PerfCopilot Instructions

Your function has been copied to clipboard. Here's how to analyze it:

1. The function code is already copied to your clipboard
2. In VS Code Chat (which should now be open), paste your function
3. Type "@perfcopilot" and press Enter
4. The function will be analyzed automatically and you'll get:
   - Alternative implementations
   - Performance benchmarks
   - Analysis of which is fastest and why

## Function to Analyze

\`\`\`javascript
${functionCode}
\`\`\`

## Why Use @perfcopilot?

The chat participant (@perfcopilot) is the recommended way to analyze functions because:
- It's more reliable than UI automation
- It provides better feedback and progress updates
- It can handle more complex functions
- It's easier to use and understand

`;

    // Write the instructions to the temp file
    fs.writeFileSync(tempFile, instructions);
    
    // Open the temp file
    vscode.window.showTextDocument(vscode.Uri.file(tempFile));
}

/**
 * Deactivates the extension
 */
export function deactivate() {
    // Clean up resources
    if (outputChannel) {
        outputChannel.dispose();
    }
} 