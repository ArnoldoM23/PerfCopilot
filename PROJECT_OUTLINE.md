# PerfCopilot Project Outline

## Project Goal

PerfCopilot is a VS Code extension that helps developers optimize their JavaScript/TypeScript functions for performance. It leverages GitHub Copilot Chat to analyze code, generate alternative implementations, and benchmark them against each other to identify the fastest version.

## Core Functionality

1. **Code Analysis**
   - Allow users to select a JavaScript/TypeScript function(s) in their editor
   - Send the function to GitHub Copilot Chat via its API
   - Receive alternative implementations optimized for performance

2. **Performance Benchmarking**
   - Generate benchmark code using Benny.js to compare the original function with alternatives
   - Run the benchmarks to determine which implementation is fastest
   - Present clear, actionable results to the user

3. **Streamlined User Experience**
   - All communication with GitHub Copilot Chat happens programmatically via API
   - No manual copying/pasting required
   - Results presented directly back through Copilot Chat interface

## Technical Requirements

1. **GitHub Copilot Chat Integration**
   - Use `copilotChatApi.requestChatResponse(prompt)` to communicate with Copilot Chat
   - Parse and process Copilot's responses programmatically
   - Handle cases where the API might fail or return unexpected results

2. **Benchmark Generation**
   - Create valid Benny.js benchmark code that accurately tests all implementations
   
   - Ensure benchmarks use appropriate test data for the function type

3. **Result Presentation**
   - Format results as markdown text for Copilot Chat interface
   - Show both code implementations and their performance metrics
   - Highlight the fastest implementation

## Implementation Approach

1. **Direct Copilot Chat API Approach**
   - Clean, modular code structure with a dedicated service for Copilot Chat interactions
   - Two-stage prompt process:
     - First prompt: Generate alternative implementations
     - Second prompt: Create benchmark code
   - Run benchmarks locally
   - Format results and send back through Copilot Chat interface

2. **Simplification Principles**
   - No custom webviews or HTML templates
   - No history tracking of previous analyses
   - Focus on core functionality using minimal dependencies

## Project Structure

1. **Core Services**
   - Copilot Chat Service: Handles all interactions with the GitHub Copilot Chat API
   - Benchmark Service: Runs performance benchmarks using generated code
   - Main extension entry point: Orchestrates the workflow and coordinates services

2. **Essential Utilities**
   - Helper functions for file operations, script execution, etc.
   - Type definitions for clear interfaces between components

## Success Criteria

1. User can select a function(s) and get optimized alternatives with a single command
2. Performance benchmarks run automatically
3. Results clearly show which implementation is fastest and by how much
4. Entire process happens without requiring manual steps from the user
5. Results display directly in the Copilot Chat interface 