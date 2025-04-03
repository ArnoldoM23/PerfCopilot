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

        outputChannel.appendLine(`Selected text: \n${selectedText}`);

        // TODO: Implement the logic to call the analysis service/participant
        // This might involve creating a synthetic request or adding a new method
        // to PerfCopilotParticipant or BenchmarkService.
        vscode.window.showInformationMessage('Function analysis started... (Implementation Pending)');
        outputChannel.appendLine('Function analysis initiated (handler logic needs implementation).');

        // Example (Conceptual - requires PerfCopilotParticipant refactor or new method):
        // try {
        //     await participant.analyzeFunctionDirectly(selectedText);
        // } catch (error) {
        //     vscode.window.showErrorMessage(`Analysis failed: ${error}`);
        //     outputChannel.appendLine(`Error during analysis command: ${error}`);
        // }
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
