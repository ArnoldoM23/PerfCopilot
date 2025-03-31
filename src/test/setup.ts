jest.mock('vscode');

import * as vscode from 'vscode';

// Minimal mock implementations
const mockWebviewPanel = {
    webview: {
        html: '',
        postMessage: jest.fn(),
        onDidReceiveMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri)
    },
    reveal: jest.fn(),
    dispose: jest.fn()
};

const mockOutputChannel = {
    appendLine: jest.fn(),
    dispose: jest.fn(),
    clear: jest.fn()
};

const mockTextDocument = {
    getText: jest.fn().mockReturnValue('function test() { return 1; }'),
    save: jest.fn().mockResolvedValue(true)
};

// Store registered commands
const registeredCommands = new Map<string, (...args: any[]) => any>();

// Create a results string that matches what the extension is looking for
const mockResultsString = `Time Complexity: O(n)
Space Complexity: O(1)
Performance Analysis: This function has linear time complexity...

Results: {"suggestions":["function optimized() { return 2; }"],"benchmarkResults":{"fastest":"optimized","results":[]}}`;

// Helper function to simulate the complete analysis flow
const simulateCompleteAnalysis = (withError = false) => {
    // First set loading content
    mockWebviewPanel.webview.html = getLoadingContent();
    
    // Then after a tick, set the final content
    setTimeout(() => {
        if (withError) {
            mockWebviewPanel.webview.html = getErrorContent('Failed to parse benchmark results', 'function test() {}', 'Invalid analysis');
        } else {
            mockWebviewPanel.webview.html = getWebviewContentWithAnalysis({}, mockResultsString);
        }
    }, 10);
};

// HTML template functions - simplified versions of those in extension.ts
function getLoadingContent(): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
            .container { max-width: 800px; margin: 0 auto; text-align: center; margin-top: 100px; }
            .loader { border: 5px solid #f3f3f3; border-radius: 50%; border-top: 5px solid #3498db; width: 50px; height: 50px; animation: spin 2s linear infinite; margin: 0 auto; margin-bottom: 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="loader"></div>
            <h2>Analyzing Function Performance...</h2>
            <p>Please wait while GitHub Copilot analyzes and benchmarks the function.</p>
        </div>
    </body>
    </html>`;
}

function getErrorContent(error: string, originalFunction: string, analysis: string): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
            .container { max-width: 800px; margin: 0 auto; }
            .error-card { background: #ffeeee; padding: 20px; border-radius: 8px; border: 1px solid #ff6666; margin-bottom: 20px; }
            .code-block { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Error Analyzing Function</h1>
            <div class="error-card">
                <h2>Error Details</h2>
                <p>${escapeHtml(error)}</p>
            </div>
            <h2>Original Function</h2>
            <pre class="code-block">${escapeHtml(originalFunction)}</pre>
            <h2>Analysis</h2>
            <pre class="code-block">${escapeHtml(analysis)}</pre>
        </div>
    </body>
    </html>`;
}

function getWebviewContentWithAnalysis(_results: any, analysis: string): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Function Performance Analysis</title>
        <style>
            body {
                padding: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            }
            pre {
                background-color: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                overflow-x: auto;
            }
            .error {
                color: #dc3545;
                padding: 10px;
                border: 1px solid #dc3545;
                border-radius: 5px;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <h1>Function Performance Analysis</h1>
        <pre>${escapeHtml(analysis)}</pre>
    </body>
    </html>`;
}

function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// @ts-ignore - Simplified mock for testing
const mockVscode = {
    window: {
        createWebviewPanel: jest.fn(() => mockWebviewPanel),
        showErrorMessage: jest.fn(),
        createOutputChannel: jest.fn(() => ({
            appendLine: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn()
        })),
        activeTextEditor: {
            document: mockTextDocument,
            selection: {
                isEmpty: false
            }
        },
        showTextDocument: jest.fn().mockResolvedValue(undefined)
    },
    workspace: {
        openTextDocument: jest.fn().mockResolvedValue(mockTextDocument),
        workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
    },
    commands: {
        registerCommand: jest.fn((command: string, callback: (...args: any[]) => any) => {
            registeredCommands.set(command, callback);
            return { dispose: jest.fn() };
        }),
        executeCommand: jest.fn(async (command: string, ...args: any[]) => {
            const handler = registeredCommands.get(command);
            if (handler) {
                return handler(...args);
            }
            if (command === 'editor.action.triggerSuggest') {
                return Promise.resolve();
            }
            if (command === 'vscode.executeCompletionItemProvider') {
                return {
                    items: [{
                        label: 'Copilot Suggestion',
                        detail: 'Function analysis',
                        documentation: 'Analysis details',
                        insertText: mockResultsString
                    }]
                };
            }
            return undefined;
        })
    },
    Uri: {
        file: jest.fn(path => ({ 
            fsPath: path,
            scheme: 'file',
            path,
            authority: '',
            query: '',
            fragment: ''
        }))
    },
    extensions: {
        getExtension: jest.fn((extensionId: string) => {
            if (extensionId === 'GitHub.copilot') {
                return {
                    isActive: true,
                    exports: {
                        getCompletions: jest.fn().mockResolvedValue([mockResultsString])
                    }
                };
            }
            return undefined;
        })
    },
    ExtensionMode: { Test: 1 },
    ViewColumn: { One: 1 }
};

// Apply mock
Object.assign(vscode, mockVscode);

export { mockVscode, mockWebviewPanel, simulateCompleteAnalysis }; 