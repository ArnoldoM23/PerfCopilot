/**
 * Chat Service
 * 
 * This service handles all interactions with VS Code's Chat API.
 * It provides methods to send prompts to language models and process responses.
 */

import * as vscode from 'vscode';
import { FunctionImplementation } from '../models/types';
import { generateBenchmarkCode } from '../utils/benchmarkGenerator';
import { VSCodeChatService } from './vscodeChat';

/**
 * Service for interacting with VS Code's Chat API.
 */
export class CopilotChatService {
    /**
     * Output channel for logging
     */
    private outputChannel: vscode.OutputChannel;

    /**
     * VSCodeChatService instance
     */
    private vsCodeChatService: VSCodeChatService;

    /**
     * Creates a new Chat Service.
     * 
     * @param outputChannel - The output channel for logging
     */
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.vsCodeChatService = new VSCodeChatService(outputChannel);
    }

    /**
     * Sends a prompt to the language model and gets the response.
     * 
     * @param prompt - The prompt to send
     * @returns The response from the language model
     */
    public async sendPrompt(prompt: string): Promise<string> {
        try {
            this.outputChannel.appendLine(`Sending prompt: ${prompt.substring(0, 100)}...`);
            
            // Directly use the VS Code Chat service without trying Copilot API
            return await this.vsCodeChatService.sendChatMessage(prompt);
        } catch (error) {
            this.outputChannel.appendLine(`Chat methods failed: ${error}`);
            
            // Show an error message to the user
            vscode.window.showErrorMessage(
                `PerfCopilot requires a language model provider. Please make sure GitHub Copilot Chat is installed or you're using a compatible VS Code version.`,
                'Open Extensions'
            ).then(selection => {
                if (selection === 'Open Extensions') {
                    vscode.commands.executeCommand('workbench.extensions.action.installExtensions');
                }
            });
            
            throw new Error(`No available chat interface found: ${error}`);
        }
    }

    /**
     * Requests alternative implementations for a function.
     * 
     * @param functionCode - The original function code
     * @returns A list of alternative implementations with descriptions
     */
    public async getAlternativeImplementations(functionCode: string): Promise<FunctionImplementation[]> {
        this.outputChannel.appendLine('Requesting alternative implementations from GitHub Copilot Chat...');
        
        // Create prompt for alternative implementations
        const prompt = `
I need two optimized alternative implementations of this JavaScript/TypeScript function.

Original function:
\`\`\`javascript
${functionCode}
\`\`\`

Please provide exactly 2 alternative implementations that:
1. Produce the same output for all inputs
2. Have better performance than the original
3. Focus on algorithmic improvements or data structure changes
4. Use the same function signature and parameters
5. Are complete, standalone, and well-documented

For each alternative, include:
- A brief explanation of why it might be faster
- Label them as "Alternative 1" and "Alternative 2"
`;
        
        try {
            // Use the sendPrompt method which will already try VSCodeChatService if direct API fails
            const response = await this.sendPrompt(prompt);
            this.outputChannel.appendLine(`Received response of length: ${response.length}`);
            
            // Parse the response to extract alternative implementations
            return this.parseAlternativeImplementations(functionCode, response);
        } catch (error) {
            this.outputChannel.appendLine(`Error getting alternative implementations: ${error}`);
            throw new Error(`Failed to get alternatives: ${error}`);
        }
    }

    /**
     * Generates benchmark code for comparing function implementations.
     * 
     * @param originalFunction - The original function implementation
     * @param alternatives - The alternative implementations
     * @returns Benchmark code that can be executed to compare the implementations
     */
    public async getBenchmarkCode(
        originalFunction: FunctionImplementation, 
        alternatives: FunctionImplementation[]
    ): Promise<string> {
        this.outputChannel.appendLine('Generating benchmark code with Benny.js...');
        // Use the utility function to generate the benchmark code
        const benchmarkCode = generateBenchmarkCode(originalFunction, alternatives);
        this.outputChannel.appendLine(`Generated ${benchmarkCode.length} bytes of benchmark code`);
        return benchmarkCode;
    }
    
    /**
     * Formats benchmark results as markdown for displaying.
     * 
     * @param original - The original function
     * @param alternatives - The alternative implementations
     * @param results - The benchmark results object
     * @returns Formatted markdown string
     */
    public formatResultsAsMarkdown(
        original: FunctionImplementation,
        alternatives: FunctionImplementation[],
        benchmarkResults: any
    ): string {
        try {
            // Extract the results
            const results = benchmarkResults.results || [];
            const fastest = benchmarkResults.fastest || 'Unknown';
            
            // Create a header section
            let markdown = `# 🚀 PerfCopilot Performance Analysis Results\n\n`;
            
            // Add a summary section
            markdown += `## Summary\n\n`;
            
            if (results.length > 0) {
                // Find the original function's result
                const originalResult = results.find((r: any) => r.name.toLowerCase().includes('original'));
                const fastestResult = results.find((r: any) => r.name === fastest);
                
                if (originalResult && fastestResult && originalResult !== fastestResult) {
                    const improvement = ((fastestResult.ops - originalResult.ops) / originalResult.ops * 100).toFixed(2);
                    markdown += `✅ The **${fastest}** implementation is the fastest, with **${improvement}%** better performance than the original.\n\n`;
                } else if (originalResult && originalResult.name === fastest) {
                    markdown += `✅ The original implementation is already the fastest version tested.\n\n`;
                }
                
                // Add a table of results
                markdown += `| Implementation | Operations/sec | Improvement |\n`;
                markdown += `| -------------- | ------------- | ----------- |\n`;
                
                results.forEach((result: any) => {
                    const isOriginal = result.name.toLowerCase().includes('original');
                    const improvementText = isOriginal ? 'Baseline' : 
                        `${((result.ops - originalResult.ops) / originalResult.ops * 100).toFixed(2)}%`;
                    const isFastest = result.name === fastest ? ' ⭐' : '';
                    
                    markdown += `| ${result.name}${isFastest} | ${result.ops.toLocaleString()} | ${improvementText} |\n`;
                });
                
                markdown += `\n_Higher operations/sec is better. ⭐ indicates the fastest implementation._\n\n`;
            } else {
                markdown += `⚠️ No benchmark results available.\n\n`;
            }
            
            // Add the function implementations
            markdown += `## Function Implementations\n\n`;
            
            // Original function
            markdown += `### Original Function\n\n`;
            markdown += `\`\`\`javascript\n${original.code}\n\`\`\`\n\n`;
            
            // Alternative implementations
            alternatives.forEach((alt, index) => {
                markdown += `### ${alt.name}\n\n`;
                
                if (alt.description) {
                    markdown += `${alt.description}\n\n`;
                }
                
                markdown += `\`\`\`javascript\n${alt.code}\n\`\`\`\n\n`;
                
                // Add benchmark result if available
                const altResult = results.find((r: any) => r.name === alt.name);
                if (altResult) {
                    const originalResult = results.find((r: any) => r.name.toLowerCase().includes('original'));
                    if (originalResult) {
                        const improvement = ((altResult.ops - originalResult.ops) / originalResult.ops * 100).toFixed(2);
                        const comparisonText = parseFloat(improvement) >= 0 ? 
                            `${improvement}% faster than the original` : 
                            `${Math.abs(parseFloat(improvement)).toFixed(2)}% slower than the original`;
                        
                        markdown += `**Performance**: ${altResult.ops.toLocaleString()} ops/sec (${comparisonText})\n\n`;
                    } else {
                        markdown += `**Performance**: ${altResult.ops.toLocaleString()} ops/sec\n\n`;
                    }
                }
            });
            
            // Add recommendation
            if (results.length > 0 && fastest) {
                markdown += `## Recommendation\n\n`;
                
                if (fastest.toLowerCase().includes('original')) {
                    markdown += `The original implementation is already well-optimized for this use case. None of the alternatives provided a meaningful performance improvement.\n\n`;
                } else {
                    markdown += `Based on the benchmark results, the **${fastest}** implementation provides the best performance and is recommended for adoption.\n\n`;
                }
            }
            
            return markdown;
        } catch (error) {
            this.outputChannel.appendLine(`Error formatting markdown: ${error}`);
            return `# Error Formatting Results\n\nThere was an error formatting the benchmark results: ${error}`;
        }
    }
    
    /**
     * Displays the benchmark results in GitHub Copilot Chat.
     * 
     * @param results - The formatted markdown results
     * @returns Whether the results were successfully displayed
     */
    public async displayResults(results: string): Promise<boolean> {
        try {
            // Try to display using GitHub Copilot Chat
            // Get all chat commands
            const commands = await vscode.commands.getCommands();
            const chatCommands = commands.filter(cmd => 
                cmd.includes('chat') || 
                cmd.includes('copilot')
            );
            
            // Try different Copilot Chat focus commands in order of preference
            const focusCommands = [
                'github.copilot.chat.focus',
                'copilot-chat.focus',
                'workbench.action.chat.focus', 
                'workbench.panel.chat.view.copilot.focus',
                'workbench.action.chat.open'
            ];
            
            let chatFocused = false;
            for (const cmd of focusCommands) {
                if (chatCommands.includes(cmd)) {
                    try {
                        this.outputChannel.appendLine(`Trying to open chat with command: ${cmd}`);
                        await vscode.commands.executeCommand(cmd);
                        chatFocused = true;
                        this.outputChannel.appendLine(`Successfully opened chat with command: ${cmd}`);
                        break;
                    } catch (e) {
                        this.outputChannel.appendLine(`Failed to open chat with command: ${cmd}: ${e}`);
                    }
                }
            }
            
            if (!chatFocused) {
                throw new Error('Could not open Copilot Chat with any available command');
            }
            
            // Copy results to clipboard for easy access
            await vscode.env.clipboard.writeText(results);
            
            // Show a notification to the user
            await vscode.window.showInformationMessage(
                'Performance analysis complete! Results copied to clipboard. Please paste into GitHub Copilot Chat.',
                'Ok'
            );
            
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Error displaying results: ${error}`);
            
            // Try alternate method - create temporary file and open it
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }
                
                const resultFile = vscode.Uri.joinPath(workspaceFolder.uri, 'perfcopilot-results.md');
                await vscode.workspace.fs.writeFile(resultFile, Buffer.from(results));
                
                const doc = await vscode.workspace.openTextDocument(resultFile);
                await vscode.window.showTextDocument(doc);
                
                // Try to show markdown preview
                await vscode.commands.executeCommand('markdown.showPreview');
                
                return true;
            } catch (e) {
                this.outputChannel.appendLine(`Error creating results file: ${e}`);
                return false;
            }
        }
    }
    
    /**
     * Parses the response to extract alternative implementations.
     * 
     * @param originalCode - The original function code
     * @param response - The response from the chat
     * @returns A list of alternative implementations
     */
    private parseAlternativeImplementations(originalCode: string, response: string): FunctionImplementation[] {
        const alternatives: FunctionImplementation[] = [];
        
        // Extract code blocks from the response
        const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\s*((?:function|const|let|var|class)[\s\S]*?)```/g;
        const descriptionRegex = /(?:^|\n)(?:Alternative \d+:|Implementation \d+:|Option \d+:)([\s\S]*?)(?=\n```|$)/g;
        
        const codeBlocks: string[] = [];
        const descriptions: string[] = [];
        
        // Extract code blocks
        let match;
        while ((match = codeBlockRegex.exec(response)) !== null) {
            codeBlocks.push(match[1].trim());
        }
        
        // Extract descriptions
        while ((match = descriptionRegex.exec(response)) !== null) {
            descriptions.push(match[1].trim());
        }
        
        // Create alternative implementations
        for (let i = 0; i < codeBlocks.length; i++) {
            const code = codeBlocks[i];
            
            // Skip if it's the original code or empty
            if (!code || code === originalCode) {
                continue;
            }
            
            // Create a name and description
            const name = `Alternative ${alternatives.length + 1}`;
            const description = i < descriptions.length ? descriptions[i] : "";
            
            alternatives.push({
                name,
                code,
                description
            });
        }
        
        return alternatives;
    }
} 