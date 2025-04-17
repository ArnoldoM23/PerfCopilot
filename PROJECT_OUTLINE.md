# PerfCopilot Project Outline

## Project Goal

PerfCopilot is a VS Code extension that helps developers optimize their JavaScript/TypeScript functions for performance. It leverages GitHub Copilot Chat to analyze code, generate alternative implementations, and benchmark them against each other to identify the fastest version.

## Core Functionality

1. **Code Analysis & Optimization**
   - Allow users to select a JavaScript/TypeScript function(s) in their editor or provide via chat.
   - Send the function to GitHub Copilot Chat via its API (`vscode.lm`).
   - Receive alternative implementations optimized for performance.
   - Leverage the selected Large Language Model (LLM) via `vscode.lm` API to generate performance-optimized alternatives.

2. **Correctness Verification (NEW)**
   - **Crucial Step:** Before benchmarking, verify the functional equivalence of AI-generated alternatives against the original function.
   - Utilize the LLM to generate relevant test inputs for the function's signature.
   - Execute the original and each alternative with the generated inputs in isolated environments (`vm`).
   - Only alternatives producing identical outputs to the original proceed to benchmarking.

3. **Performance Benchmarking**
   - Utilize the LLM to generate appropriate test data for the benchmark based on the function signature.
   - Dynamically create a benchmarking module containing the original function and *verified* alternatives.
   - Execute the benchmark using a dedicated Node.js runner script (`benchmarkRunner.ts`) leveraging `benny.js`.
   - Parse structured results (ops/sec) from the runner's output.

4. **AI-Powered Result Interpretation & Presentation**
   - Send raw benchmark results back to the LLM.
   - Receive clear, actionable analysis, explanations, and the fastest implementation.
   - Present the formatted report directly within the VS Code Chat view.

5. **Streamlined User Experience**
   - Seamless integration with VS Code Chat (`@PerfCopilot` participant) and editor context menu.
   - Automated workflow requiring minimal user intervention.

## Technical Requirements

1. **GitHub Copilot Chat Integration (`vscode.lm`)**
   - Utilize the `vscode.lm` API (e.g., `sendChatRequest`) for all LLM interactions (alternative generation, test input generation, benchmark data generation, result analysis).
   - Parse and process LLM responses programmatically (expecting JSON where specified).
   - Implement retry logic and error handling for LLM requests.

2. **Equivalence Testing**
   - Isolate function execution using Node.js `vm` module.
   - Compare outputs reliably (handling different data types).

3. **Benchmarking Implementation**
   - Use `benny` library for performance measurement (ops/sec).
   - Employ a dedicated Node.js child process (`benchmarkRunner.ts`) for running benchmarks in isolation.
   - Ensure accurate measurement by pre-compiling functions (`vm`) and pre-determining arguments outside the timed loop within the runner.
   - Establish a clear contract (specific stdout format like `cycle: ...`, `complete: ...`, `BENCHMARK_ERROR: ...`) between the service and the runner script for result/error communication.

4. **Result Presentation**
   - Format final analysis as Markdown text suitable for the VS Code Chat view.

## Implementation Approach

1. **Direct Copilot Chat API Approach**
   - Clean, modular code structure with dedicated services for LLM interactions, benchmarking, and correctness verification.
   - **Multi-Stage LLM Interaction:**
     - Prompt 1: Generate Alternatives.
     - Prompt 2: Generate Test Inputs (for Correctness Check).
     - Prompt 3: Generate Benchmark Test Data.
     - Prompt 4: Analyze Benchmark Results.
   - Local execution for correctness checks (`vm`) and benchmarking (Node.js child process).

2. **Simplification Principles**
   - No custom webviews or HTML templates.
   - No history tracking of previous analyses.
   - Focus on core functionality using minimal dependencies.

## Project Structure

1. **Core Services**
   - `LanguageModelService`: Handles all interactions with the `vscode.lm` API (sending requests, processing streams).
   - `BenchmarkService`: Runs performance benchmarks using generated code, invokes the `benchmarkRunner`, and parses its output.
   - `CorrectnessVerifier`: Performs functional equivalence testing using generated inputs and `vm`.
   - Main extension entry point (`extension.ts`): Activates the extension, registers commands and the chat participant.
   - `PerfCopilotParticipant`: Implements the `vscode.chat.ChatParticipant` interface, handles `@PerfCopilot` requests, orchestrates the workflow, and interacts with services.

2. **Essential Utilities**
   - `benchmarkRunner.ts`: Standalone Node.js script executed by `BenchmarkService` to run `benny` benchmarks in an isolated process. Includes critical logic for accurate measurement (pre-compilation, argument determination).
   - General Utilities (`src/utils`): Helper functions for file operations (temp files), script execution (Node.js child process), text parsing, etc.
   - Type definitions (`src/models/types.ts`) for clear interfaces between components.

## Success Criteria

1. **Intuitive Initiation:** Users can effortlessly trigger performance analysis for JavaScript/TypeScript code via standard VS Code interactions (e.g., editor context menu, `@PerfCopilot` chat command).
2. **Verified Optimizations:** The system reliably generates AI-powered code alternatives focused on performance and *automatically verifies* their functional equivalence against the original code before benchmarking.
3. **Automated Benchmarking:** Performance comparisons between the original and verified alternatives are executed automatically using statistically sound methods (`benny`), requiring no manual setup.
4. **Actionable Insights:** Deliver clear, quantitative results (ops/sec, relative speed) and qualitative, AI-driven explanations directly within the VS Code Chat interface, enabling informed optimization decisions.
5. **Seamless Workflow:** Provide a fully automated, end-to-end experience from function input to results presentation, minimizing developer context switching and effort. 