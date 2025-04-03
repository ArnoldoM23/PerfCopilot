/**
 * Type definitions for the extension
 */

/**
 * Represents a function implementation
 */
export interface FunctionImplementation {
    /**
     * Name of the implementation (e.g., "original", "alternative1")
     */
    name: string;
    
    /**
     * The function code
     */
    code: string;
    
    /**
     * Optional description of the implementation
     */
    description?: string;
}

/**
 * Represents a single benchmark result item
 */
export interface BenchmarkResultItem {
    /**
     * Name of the implementation
     */
    name: string;
    
    /**
     * Operations per second
     */
    ops: number;
    
    /**
     * Error margin (as a decimal, e.g., 0.01 for 1%)
     */
    margin: number;
}

/**
 * Represents the complete benchmark comparison results
 */
export interface BenchmarkComparison {
    /**
     * Name of the fastest implementation
     */
    fastest: string;
    
    /**
     * Array of benchmark result items
     */
    results: BenchmarkResultItem[];
}

/**
 * Represents the complete analysis result for a function
 */
export interface AnalysisResult {
    /**
     * The original function implementation
     */
    originalFunction: FunctionImplementation;
    
    /**
     * Alternative implementations generated for the function
     */
    alternativeImplementations: FunctionImplementation[];
    
    /**
     * Benchmark comparison results (if benchmarking was performed)
     */
    benchmarkComparison?: BenchmarkComparison;
}

/**
 * Configuration options for the extension
 */
export interface PerfCopilotConfig {
    /** Number of alternative implementations to generate */
    alternativeCount: number;
    
    /** Number of benchmark iterations to run */
    benchmarkIterations: number;
    
    /** Whether to save results to history */
    saveToHistory: boolean;
}

/**
 * Represents a message sent from the webview to the extension
 */
export interface WebviewMessage {
    /** The command to execute */
    command: string;
    
    /** Optional ID parameter */
    id?: string;
    
    /** Optional data parameter */
    data?: any;
} 
