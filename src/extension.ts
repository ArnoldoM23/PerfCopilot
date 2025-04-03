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
    
    // Add to subscriptions
    context.subscriptions.push(showLogsDisposable);
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
