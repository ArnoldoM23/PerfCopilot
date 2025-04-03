# PerfCopilot for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
<!-- Add other badges if applicable, e.g., Marketplace version -->
<!-- Consider adding your logo/icon here -->
<!-- ![PerfCopilot Logo](assets/logo.png) -->

**Analyze and optimize JavaScript/TypeScript functions for performance directly within Visual Studio Code using the power of AI.**

PerfCopilot leverages GitHub Copilot (or compatible AI models) to:
*   Generate performance-optimized alternatives for your functions.
*   Automatically benchmark the original and alternative implementations using `benny.js`.
*   Present clear performance comparisons and explanations directly in the VS Code Chat view.

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
   *   Type `@PerfCopilot` followed by the JavaScript/TypeScript function you want to analyze. You can paste the code directly or enclose it in a Markdown code block (\`\`\`js ... \`\`\`).
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

   *   PerfCopilot will respond in the chat with the analysis, including generated alternatives, benchmark results, and explanations.

**2. Using the Editor Context Menu**

   *   Open a JavaScript or TypeScript file (`.js`, `.ts`, `.jsx`, `.tsx`).
   *   **Select the entire function code** you want to analyze in the editor.
   *   **Right-click** on the selected code.
   *   Choose **"PerfCopilot: Analyze Function"** from the context menu.
   *   The analysis results will appear in the VS Code Chat view, similar to using the `@PerfCopilot` command.

## Example Analysis Output (in Chat)

*(The exact format might vary slightly)*

```markdown
✅ Function `calculateFactorial` identified. Analyzing...
✅ Generated 2 alternative implementations.
✅ AI generated benchmark code.
✅ Benchmarks completed.

# Performance Analysis: calculateFactorial

## Summary
**Alternative 1** is the fastest, approximately **15.2%** faster than the Original implementation.

## Benchmark Results
| Implementation | Ops/sec  |
| -------------- | -------- |
| Alternative 1 ⭐ | 987,654  |
| Original       | 857,123  |
| Alternative 2  | 845,999  |

## Explanation
Alternative 1 utilizes memoization (caching results for previously computed factorials), significantly reducing redundant calculations for repeated calls with the same input within the benchmark loop. The original function recalculates the factorial every time. Alternative 2 (e.g., using recursion without memoization) might be slightly slower due to function call overhead.

## Fastest Implementation (Alternative 1)
```javascript
// Example memoized version provided by the AI
const factorialCache = {};
const calculateFactorial = (n) => {
  if (n < 0) return undefined;
  if (n === 0) return 1;
  if (factorialCache[n]) return factorialCache[n];
  let result = 1;
  for (let i = n; i > 1; i--) {
    result *= i;
  }
  factorialCache[n] = result;
  return result;
};
```
```

## How It Works (Simplified)

1.  **Function Extraction:** PerfCopilot identifies the target function from your chat input or editor selection.
2.  **Alternative Generation:** It prompts the selected AI model (via `vscode.lm`) to create performance-focused alternatives.
3.  **Benchmark Code Generation:** It asks the AI model to generate a `benny.js` benchmarking script comparing the original and alternatives.
4.  **Local Benchmarking:** The generated script is run locally using Node.js in a temporary directory (the extension handles installing `benny` temporarily).
5.  **Result Analysis:** The raw benchmark results (ops/sec) are sent back to the AI model for analysis, explanation, and formatting.
6.  **Display:** The final formatted analysis is streamed to the VS Code Chat view.

<!-- ## Contributing (Optional) -->
<!-- If you plan to accept contributions, add guidelines here -->
<!-- Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change. -->
<!-- Please make sure to update tests as appropriate. -->

## License

[MIT](LICENSE) 