// Basic VS Code types
export class Uri {
    static file(path: string): Uri {
        return {
            fsPath: path,
            scheme: 'file',
            path,
            with: jest.fn(),
            toString: jest.fn(),
            toJSON: jest.fn()
        } as any;
    }
}

export class Range {
    constructor(
        public readonly start: Position,
        public readonly end: Position
    ) {}
}

export class Position {
    constructor(
        public readonly line: number,
        public readonly character: number
    ) {}
}

export class Selection extends Range {
    constructor(
        public readonly anchor: Position,
        public readonly active: Position
    ) {
        super(anchor, active);
    }
}

export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
    Three = 3
}

export interface ExtensionContext {
    subscriptions: { dispose(): any }[];
    extensionPath: string;
    extensionUri: Uri;
    globalState: Memento;
    workspaceState: Memento;
}

export interface Memento {
    get<T>(key: string): T | undefined;
    update(key: string, value: any): Thenable<void>;
    keys(): readonly string[];
    setKeysForSync?(keys: readonly string[]): void;
}

// Export everything as a namespace
export default {
    Uri,
    Range,
    Position,
    Selection,
    ViewColumn
}; 