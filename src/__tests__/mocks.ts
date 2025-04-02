/**
 * Mock implementations for tests
 */

// Mock Output Channel for testing
export class MockOutputChannel {
    private lines: string[] = [];
    
    constructor(name: string) {
        // Store channel name if needed
        this.name = name;
    }
    
    name: string;
    
    appendLine(value: string): void {
        this.lines.push(value);
    }
    
    append(value: string): void {
        if (this.lines.length === 0) {
            this.lines.push(value);
        } else {
            this.lines[this.lines.length - 1] += value;
        }
    }
    
    clear(): void {
        this.lines = [];
    }
    
    show(): void {
        // Mock implementation - doesn't need to do anything
    }
    
    hide(): void {
        // Mock implementation - doesn't need to do anything
    }
    
    dispose(): void {
        // Mock implementation - doesn't need to do anything
    }
    
    // Helper method for tests to get the output
    getOutput(): string[] {
        return [...this.lines];
    }
} 