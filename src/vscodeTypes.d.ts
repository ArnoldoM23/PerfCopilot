/**
 * Type declarations for VS Code extension API
 * 
 * This file adds type definitions needed for VS Code extension development
 */

declare module 'vscode' {
    // Add explicit declarations for VS Code types to resolve errors
    export interface ExtensionContext {
        subscriptions: { dispose(): any }[];
        workspaceState: Memento;
        globalState: Memento;
        extensionPath: string;
        storagePath?: string;
        globalStoragePath: string;
        asAbsolutePath(relativePath: string): string;
    }

    export interface Memento {
        get<T>(key: string): T | undefined;
        get<T>(key: string, defaultValue: T): T;
        update(key: string, value: any): Thenable<void>;
    }

    export interface OutputChannel {
        name: string;
        append(value: string): void;
        appendLine(value: string): void;
        clear(): void;
        show(preserveFocus?: boolean): void;
        hide(): void;
        dispose(): void;
    }

    export interface StatusBarItem {
        alignment: StatusBarAlignment;
        priority?: number;
        text: string;
        tooltip?: string;
        color?: string;
        command?: string;
        show(): void;
        hide(): void;
        dispose(): void;
    }

    export interface WebviewPanel {
        viewType: string;
        title: string;
        webview: Webview;
        reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
        dispose(): void;
        onDidDispose(callback: () => any, thisArg?: any, disposables?: Disposable[]): Disposable;
    }

    export interface Webview {
        html: string;
        onDidReceiveMessage(listener: (message: any) => void, thisArg?: any, disposables?: Disposable[]): Disposable;
        postMessage(message: any): Thenable<boolean>;
    }
    
    export type ViewColumn = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | -2 | -1;
    
    export enum StatusBarAlignment {
        Left = 1,
        Right = 2
    }
} 