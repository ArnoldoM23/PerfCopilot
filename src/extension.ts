import * as vscode from 'vscode';

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
            
            outputChannel.appendLine(`Analyzing function: ${selectedText.substring(0, 100)}...`);
            
            // Check for Copilot Chat extension
            const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat');
            if (!copilotChat) {
                vscode.window.showErrorMessage('GitHub Copilot Chat extension is required for PerfCopilot to work');
                return;
            }
            
            if (!copilotChat.isActive) {
                await copilotChat.activate();
            }
            
            // Create prompt for function analysis and alternatives
            const analysisPrompt = `
I need you to analyze this JavaScript function and provide two alternative implementations that should be more efficient:

\`\`\`javascript
${selectedText}
\`\`\`

Please:
1. Analyze the time and space complexity of the original function
2. Provide two alternative implementations with better algorithmic approaches 
3. Name the implementations "alternativeOne" and "alternativeTwo"
4. Explain why each alternative should perform better

Format your response with clear code blocks for each implementation.
`;
            
            // Open Copilot Chat and send the prompt
            await sendToCopilotChat(analysisPrompt);
            
            // Wait a bit for the user to review the alternatives, then offer to benchmark
            setTimeout(async () => {
                const shouldBenchmark = await vscode.window.showInformationMessage(
                    'Would you like to benchmark these implementations with Benny?', 
                    'Yes', 'No'
                );
                
                if (shouldBenchmark === 'Yes') {
                    // Create prompt for benchmarking
                    const benchmarkPrompt = `
Now I want you to create a benchmarking test using Benny.js to compare the original function with the two alternatives you just created.

Original function:
\`\`\`javascript
${selectedText}
\`\`\`

Please:
1. Create a complete benchmarking script using Benny.js that compares all three implementations
2. Make sure to include realistic test cases that work with all implementations
3. Analyze the benchmark results and explain which implementation is fastest and why
4. Present the benchmark results in a table format showing ops/sec

Run the benchmark and show me the complete results.
`;
                    
                    // Send the benchmark prompt to Copilot Chat
                    await sendToCopilotChat(benchmarkPrompt);
                }
            }, 5000);
            
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
 * Send a prompt to Copilot Chat
 */
async function sendToCopilotChat(prompt: string): Promise<void> {
    try {
        // Focus or open the Copilot Chat view
        await vscode.commands.executeCommand('github.copilot.chat.focus');
        
        // Start a new chat
        await vscode.commands.executeCommand('github.copilot.chat.newChat');
        
        // Copy the prompt to clipboard
        await vscode.env.clipboard.writeText(prompt);
        
        // Paste the prompt
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        
        // Submit the prompt
        await vscode.commands.executeCommand('github.copilot.chat.sendApiRequest');
        
        outputChannel.appendLine('Prompt sent to Copilot Chat');
    } catch (error: any) {
        outputChannel.appendLine(`Error sending to Copilot Chat: ${error.message}`);
        throw new Error(`Failed to communicate with Copilot Chat: ${error.message}`);
    }
}

export function deactivate() {
    outputChannel?.dispose();
} 