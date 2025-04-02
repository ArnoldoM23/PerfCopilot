/**
 * VS Code Chat Service
 * 
 * This service handles interactions with VS Code's Chat API.
 * It uses VS Code commands to communicate with language models.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * A service for interacting with VS Code Chat
 */
export class VSCodeChatService {
    /**
     * Output channel for logging
     */
    private outputChannel: vscode.OutputChannel;
    
    /**
     * Creates a new VS Code Chat Service
     * 
     * @param outputChannel - The output channel for logging
     */
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }
    
    /**
     * Sends a chat message using VS Code commands.
     * This method tries multiple approaches in sequence:
     * 1. VS Code chat if available
     * 2. GitHub Copilot chat if available
     * 3. Creating a temporary file as a last resort
     * 
     * @param prompt - The prompt to send to the chat model
     * @returns A promise that resolves to the response text
     * @throws Error if no method succeeds
     */
    public async sendChatMessage(prompt: string): Promise<string> {
        try {
            this.outputChannel.appendLine(`Sending chat message: ${prompt.substring(0, 100)}...`);
            
            // Get available commands
            const commands = await vscode.commands.getCommands();
            
            // Check for chat commands in order of preference
            const vscodeChat = this.findCommand(commands, [
                'workbench.action.chat.open',
                'workbench.action.chat.submit'
            ]);
            
            const copilotChat = this.findCommand(commands, [
                'github.copilot.chat.focus', 
                'github.copilot.chat.explain'
            ]);
            
            if (vscodeChat) {
                return await this.useVSCodeChat(prompt, vscodeChat);
            } else if (copilotChat) {
                return await this.useCopilotChat(prompt, copilotChat);
            } else {
                // Try creating a temporary file with our prompt as a last resort
                return await this.useTemporaryFile(prompt);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error sending chat message: ${error}`);
            throw new Error(`Failed to send chat message: ${error}`);
        }
    }
    
    /**
     * Finds the first available command from the list of candidates
     * 
     * @param commands - List of available commands
     * @param candidates - Candidate commands in priority order
     * @returns The first matching command or undefined if none found
     */
    private findCommand(commands: string[], candidates: string[]): string | undefined {
        for (const candidate of candidates) {
            if (commands.includes(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
    
    /**
     * Use VS Code's chat with preferred commands
     * 
     * @param prompt - The prompt to send
     * @param command - The command to use for opening chat
     * @returns A promise that resolves to the response
     */
    private async useVSCodeChat(prompt: string, command: string): Promise<string> {
        this.outputChannel.appendLine(`Using VS Code chat command: ${command}`);
        
        try {
            // Open the chat panel
            await vscode.commands.executeCommand(command);
            
            // Copy the prompt to clipboard for manual pasting if needed
            await vscode.env.clipboard.writeText(prompt);
            
            // Try to make the chat editable (if applicable)
            try {
                await vscode.commands.executeCommand('workbench.action.chat.startEditing');
                this.outputChannel.appendLine('Made chat editable');
            } catch (e) {
                this.outputChannel.appendLine(`Could not make chat editable: ${e}`);
            }
            
            // Try to send the message
            try {
                await vscode.commands.executeCommand('workbench.action.chat.submit', prompt);
                this.outputChannel.appendLine('Submitted prompt via command with prompt parameter');
            } catch (e) {
                this.outputChannel.appendLine(`Could not submit via command with param: ${e}`);
                
                // Try to paste and submit a different way
                try {
                    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                    await vscode.commands.executeCommand('workbench.action.chat.submit');
                    this.outputChannel.appendLine('Submitted prompt via paste and submit');
                } catch (e2) {
                    this.outputChannel.appendLine(`Could not paste and submit: ${e2}`);
                    
                    // Show a message to the user if we couldn't submit automatically
                    vscode.window.showInformationMessage(
                        'Please paste the prompt into the VS Code chat and press Enter.'
                    );
                }
            }
            
            // Create a placeholder response - actual interaction happens in UI
            return "Request sent to VS Code chat - please check the chat panel for results";
        } catch (error) {
            this.outputChannel.appendLine(`Error with VS Code chat: ${error}`);
            throw error;
        }
    }
    
    /**
     * Use GitHub Copilot chat commands
     * 
     * @param prompt - The prompt to send
     * @param command - The command to use for opening Copilot chat
     * @returns A promise that resolves to the response
     */
    private async useCopilotChat(prompt: string, command: string): Promise<string> {
        this.outputChannel.appendLine(`Using GitHub Copilot chat command: ${command}`);
        
        try {
            // Open Copilot chat
            await vscode.commands.executeCommand(command);
            
            // Copy the prompt to clipboard
            await vscode.env.clipboard.writeText(prompt);
            
            // Try to paste the prompt
            try {
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                this.outputChannel.appendLine('Pasted prompt to Copilot chat');
                
                // Try to submit
                try {
                    await vscode.commands.executeCommand('github.copilot.chat.submit');
                    this.outputChannel.appendLine('Submitted to Copilot chat via command');
                } catch (e) {
                    // Try generic enter key
                    try {
                        await vscode.commands.executeCommand('type', { text: '\n' });
                        this.outputChannel.appendLine('Submitted to Copilot chat via enter key');
                    } catch (e2) {
                        this.outputChannel.appendLine(`Could not submit to Copilot chat: ${e2}`);
                        
                        // Show a message to the user
                        vscode.window.showInformationMessage(
                            'Please press Enter to submit the prompt in the GitHub Copilot chat panel.'
                        );
                    }
                }
            } catch (e) {
                this.outputChannel.appendLine(`Could not paste to Copilot chat: ${e}`);
                
                // Show a message to the user
                vscode.window.showInformationMessage(
                    'Please paste the prompt into the GitHub Copilot chat panel and press Enter.'
                );
            }
            
            return "Request sent to GitHub Copilot - please check the chat panel for results";
        } catch (error) {
            this.outputChannel.appendLine(`Error with GitHub Copilot chat: ${error}`);
            throw error;
        }
    }
    
    /**
     * Use a temporary file as a last resort when no chat interface is available
     * 
     * @param prompt - The prompt text
     * @returns A promise that resolves to a message about the temporary file
     */
    private async useTemporaryFile(prompt: string): Promise<string> {
        this.outputChannel.appendLine('Using temporary file as last resort');
        
        try {
            // Create a temporary file with the prompt
            const tmpDir = path.join(os.tmpdir(), 'perfcopilot');
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            
            // Write prompt to file
            const fileName = `prompt_${Date.now()}.md`;
            const filePath = path.join(tmpDir, fileName);
            fs.writeFileSync(filePath, prompt);
            
            // Open the file
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
            
            // Show a message to the user
            vscode.window.showInformationMessage(
                'Please copy this text and use it with a language model tool of your choice.'
            );
            
            return `Prompt saved to temporary file: ${filePath}. Please use a chat tool manually.`;
        } catch (error) {
            this.outputChannel.appendLine(`Error creating temporary file: ${error}`);
            throw error;
        }
    }
} 