/**
 * PerfCopilot extension entry point
 * 
 * This extension helps identify performance improvements for JavaScript/TypeScript functions
 * using GitHub Copilot to suggest optimized alternatives and benchmark them.
 */

import * as vscode from 'vscode';
import { PerfCopilotParticipant } from './perfCopilotParticipant';
import { BenchmarkService } from './services/benchmarkService';

// The extension output channel
let outputChannel: vscode.OutputChannel;

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context - The extension context
 */
export function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel('PerfCopilot');
    outputChannel.appendLine('PerfCopilot extension activated');
    
    // Create services
    const benchmarkService = new BenchmarkService(outputChannel);
    
    // Register the PerfCopilot chat participant
    try {
        outputChannel.appendLine('Registering PerfCopilot chat participant...');
        const participant = new PerfCopilotParticipant(
            outputChannel,
            benchmarkService
        );
        
        // Add participant to disposables
        const disposableParticipant = participant.register();
        context.subscriptions.push(disposableParticipant);
        
        outputChannel.appendLine('PerfCopilot chat participant registered successfully');
    } catch (error) {
        outputChannel.appendLine(`Failed to register PerfCopilot chat participant: ${error}`);
    }
    
    // Register show logs command
    const showLogsDisposable = vscode.commands.registerCommand('perfcopilot.showLogs', () => {
        outputChannel.show();
    });

    // Register analyze function command
    const analyzeFunctionDisposable = vscode.commands.registerCommand('perfcopilot.analyzeFunction', async () => {
        outputChannel.appendLine('perfcopilot.analyzeFunction command triggered.');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor found.');
            outputChannel.appendLine('Error: No active text editor.');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText || selectedText.trim().length === 0) {
            vscode.window.showErrorMessage('No function selected. Please select the code of the function you want to analyze.');
            outputChannel.appendLine('Error: No text selected.');
            return;
        }

        outputChannel.appendLine(`Selected text: \\n${selectedText}`);

        // Format the prompt: @perfcopilot followed by the selected code
        const prompt = `@PerfCopilot ${selectedText}`;
        outputChannel.appendLine(`Formatted prompt for chat: ${prompt}`);

        // Open the chat view and pre-fill the input with the prompt
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
            outputChannel.appendLine('Opened chat view with pre-filled prompt via context menu.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open chat view: ${error}`);
            outputChannel.appendLine(`Error executing workbench.action.chat.open: ${error}`);
        }
    });
    
    // Add to subscriptions
    context.subscriptions.push(showLogsDisposable);
    context.subscriptions.push(analyzeFunctionDisposable);
}

/**
 * Deactivates the extension
 */
export function deactivate() {
    // Clean up resources
    if (outputChannel) {
        outputChannel.dispose();
    }
    outputChannel.appendLine('PerfCopilot extension deactivated.');
} 
