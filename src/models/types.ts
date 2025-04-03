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
