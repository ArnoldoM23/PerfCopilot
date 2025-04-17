# PerfCopilot for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
<!-- Add other badges if applicable, e.g., Marketplace version -->
<!-- Consider adding your logo/icon here -->
<!-- ![PerfCopilot Logo](assets/logo.png) -->

**Analyze and optimize JavaScript/TypeScript functions for performance directly within Visual Studio Code using the power of AI.**

PerfCopilot leverages GitHub Copilot (or compatible AI models) to:
*   **Accelerate Your Code:** Identify performance bottlenecks and discover optimized function alternatives using advanced AI.
*   **Quantify Improvements:** Automatically benchmark your original code against verified AI-generated suggestions using `benny.js` to measure real-world speed gains (ops/sec).
*   **Save Development Time:** Automate the complex tasks of generating, functionally verifying, and benchmarking potential performance improvements.
*   **Gain Actionable Insights:** Receive clear, AI-driven explanations alongside benchmark results directly in the VS Code Chat view, explaining *why* an alternative is faster.

## Features

*   🚀 **AI-Powered Optimization:** Get intelligent suggestions for function performance improvements.
*   📊 **Automatic Benchmarking:** Compare the speed (ops/sec) of different function versions without manual setup.
*   🤖 **Integrated Chat Experience:** Interact with PerfCopilot using the `@PerfCopilot` mention in the VS Code Chat.
*   🖱️ **Editor Context Menu:** Analyze functions directly by selecting code and using the right-click menu.
*   💡 **Clear Explanations:** Understand *why* a particular implementation performs better with AI-generated analysis.

<!-- ## Demo (Optional) -->
<!-- Consider adding an animated GIF here showing the workflow -->
<!-- ![PerfCopilot Demo GIF](path/to/demo.gif) -->

## Requirements

*   **Visual Studio Code:** Version 1.85.0 or higher.
*   **GitHub Copilot Chat Extension:** PerfCopilot relies on the AI models provided by Copilot Chat (or a compatible `vscode.lm` provider). Ensure it is installed and enabled.
*   **Node.js:** Required for running the local `benny.js` benchmarks (the extension handles installing `benny` temporarily).

## Installation

1.  Open **Visual Studio Code**.
2.  Go to the **Extensions** view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3.  Search for `PerfCopilot`.
4.  Click **Install**.
    *(Alternatively, install from the VS Code Marketplace website or by installing the `.vsix` file if obtained directly).*

## Usage

There are two main ways to use PerfCopilot:

**1. Using the Chat (`@PerfCopilot`)**

   *   Open the VS Code Chat view (`Ctrl+Shift+P` or `Cmd+Shift+P`, then type `Chat: Focus on Chat View`).
   *   Type `@PerfCopilot` followed by the JavaScript/TypeScript function you want to analyze. You can paste the code directly or enclose it in a Markdown code block (\`\`\`js ... \`\`\`). Do not include export keywords in the functions.
   *   Press Enter.

   **Example Chat Query:**

   ```
   @PerfCopilot
   function calculateFactorial(n) {
     if (n < 0) return undefined;
     if (n === 0) return 1;
     let result = 1;
     for (let i = n; i > 1; i--) {
       result *= i;
     }
     return result;
   }
   ```
   *or*
   ```
   @PerfCopilot
   ```js
   const calculateFactorial = (n) => {
     if (n < 0) return undefined;
     if (n === 0) return 1;
     let result = 1;
     for (let i = n; i > 1; i--) {
       result *= i;
     }
     return result;
   };
   ```

   **Example: Analyzing a Function with Dependencies**

   If the function you want to analyze (`processNumbers` below) calls other functions *you've defined* (`naiveFactorial` below), include those dependent functions as well. This allows PerfCopilot to analyze the complete execution path and suggest optimizations that might involve either function.

   ```javascript
   // Inefficient helper function
   const naiveFactorial = (n) => {
     if (n < 0) throw new Error('Cannot compute factorial of negative numbers.');
     if (n === 0 || n === 1) return 1;

     let result = 1;
     for (let i = 2; i <= n; i++) {
       // Instead of a straightforward "result *= i",
       // we use a loop to multiply one number at a time (inefficiently).
       let intermediate = 0;
       for (let j = 0; j < i; j++) {
         intermediate += result; // Repeated addition
       }
       result = intermediate;
     }

     return result;
   }

   /**
   * Main function that processes an array of numbers by
   * computing their factorial via a non-optimal approach.
   *
   * @param {number[]} numbers - Array of non-negative integers.
   * @returns {Object[]} Array of objects with original and factorial values.
   */
   function processNumbers(numbers) {
     const results = [];

     for (const num of numbers) {
       const fact = naiveFactorial(num); // Calls the helper
       results.push({
         original: num,
         factorial: fact,
       });
     }

     return results;
   }
   ```

   **Example Chat Query (Including Dependency):**

   ```
   @PerfCopilot
   // Helper function (dependency)
   const naiveFactorial = (n) => {
     if (n < 0) throw new Error('Cannot compute factorial of negative numbers.');
     if (n === 0 || n === 1) return 1;
     let result = 1;
     for (let i = 2; i <= n; i++) {
       let intermediate = 0;
       for (let j = 0; j < i; j++) {
         intermediate += result;
       }
       result = intermediate;
     }
     return result;
   }

   // Main function to analyze
   function processNumbers(numbers) {
     const results = [];
     for (const num of numbers) {
       const fact = naiveFactorial(num);
       results.push({
         original: num,
         factorial: fact,
       });
     }
     return results;
   }
   ```

   *(Note: Provide all relevant functions together in the same prompt. PerfCopilot will typically identify the last function as the main one to analyze, but including dependencies ensures a complete analysis and enables more effective optimization suggestions.)*

   *   PerfCopilot will respond in the chat with the analysis, including generated alternatives, benchmark results, and explanations.

**2. Using the Editor Context Menu**

   *   Open a JavaScript or TypeScript file (`.js`, `.ts`, `.jsx`, `.tsx`).
   *   **Select the entire function code** you want to analyze in the editor.
   *   **Right-click** on the selected code.
   *   Choose **"PerfCopilot: Analyze Function"** from the context menu.
   *   The analysis results will appear in the VS Code Chat view, similar to using the `@PerfCopilot` command.

## Example Analysis Output (in Chat)

*(The exact format might vary slightly)*

## Troubleshooting / Tips

*   **Understanding Verification Failures:** PerfCopilot employs a sophisticated **AI-driven Correctness Check** (detailed in "How It Works") to guarantee functional equivalence between your original code and the generated optimizations. This involves automatically generating test cases and executing all function versions. If the analysis reports "0 alternatives passed verification," it signifies that the AI-generated suggestions, while potentially faster, did not produce identical outputs to the original function in this instance.
*   **What to do:**
    *   **Retry Analysis:** AI generation has inherent variability. Re-running the analysis often yields correctly verified alternatives.
    *   **Select a Different AI Model:** If available (via Copilot Chat settings or other providers), switching the underlying AI model can influence generation and verification success for complex functions.

## How It Works (High-Level)

1.  **Function Extraction:** PerfCopilot identifies the target function from your chat input or editor selection.
2.  **AI-Powered Optimization:** Leverages the selected large language model (`vscode.lm`) to generate performance-enhanced code variants.
3.  **AI-Driven Equivalence Testing:** Performs an automated functional correctness check. The **AI generates relevant test inputs** tailored to your function, and PerfCopilot executes the original and alternative functions against these inputs, ensuring outputs match exactly before proceeding. This critical step guarantees the validity of proposed optimizations.
4.  **AI-Powered Benchmark Generation:** Instructs the **AI to intelligently construct** a `benny.js` benchmark suite, including appropriate test data, for the original function and all *verified* alternatives.
5.  **Seamless Local Execution:** Executes the benchmark suite using Node.js in an isolated temporary environment, handling dependencies automatically.
6.  **AI-Enhanced Result Interpretation:** Feeds the raw performance data (ops/sec) back to the AI for insightful analysis, comparison, and explanation generation.
7.  **Integrated Chat Display:** Streams the comprehensive performance report directly into the VS Code Chat view.

<!-- ## Contributing (Optional) -->
<!-- If you plan to accept contributions, add guidelines here -->
<!-- Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change. -->
<!-- Please make sure to update tests as appropriate. -->

## License

[MIT](LICENSE) 