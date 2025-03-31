import * as vscode from 'vscode';

export const mockEditor = {
    document: {
        getText: jest.fn(),
        uri: {
            fsPath: '/test/path',
            scheme: 'file',
            authority: '',
            path: '/test/path',
            query: '',
            fragment: '',
            with: jest.fn(),
            toString: jest.fn(),
            toJSON: jest.fn()
        }
    },
    selection: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        active: { line: 0, character: 0 },
        anchor: { line: 0, character: 0 },
        isEmpty: true
    }
};

export const mockWebviewPanel = {
    webview: {
        html: '',
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: () => Promise.resolve()
    },
    onDidDispose: () => ({ dispose: () => {} }),
    reveal: () => {},
    dispose: () => {}
};

export const mockVscode = {
    window: {
        showErrorMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        createWebviewPanel: jest.fn().mockReturnValue(mockWebviewPanel),
        createOutputChannel: jest.fn().mockReturnValue({
            appendLine: jest.fn(),
            append: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn()
        }),
        activeTextEditor: mockEditor
    },
    // ... existing code ...
}; 