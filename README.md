# PerfCopilot

PerfCopilot is a VS Code extension that helps you optimize JavaScript/TypeScript functions for better performance. It leverages GitHub Copilot Chat to analyze functions, generate alternative implementations, and benchmark them to identify the fastest version.

## Features

- **Generate Alternatives**: Select a function in your editor and get alternative implementations optimized for performance.
- **Automatic Benchmarking**: Compare the performance of the original function with the alternatives.
- **Clear Results**: View benchmark results directly in the GitHub Copilot Chat interface.

## How It Works

1. **Select a Function**: Highlight a JavaScript/TypeScript function in your editor.
2. **Run the Command**: Right-click and select "PerfCopilot: Analyze Function" or use the command palette.
3. **Review Alternatives**: PerfCopilot generates alternative implementations of your function.
4. **Check Benchmark Results**: View performance comparisons to see which implementation is fastest.

## Requirements

- Visual Studio Code 1.85.0 or higher
- GitHub Copilot Chat extension

## Usage

1. Open a JavaScript or TypeScript file
2. Select a function you want to optimize
3. Right-click and select "PerfCopilot: Analyze Function" from the context menu
4. Wait for the analysis to complete
5. Review the results in GitHub Copilot Chat

## Examples

### Example Function

```javascript
function findDuplicates(array) {
  const duplicates = [];
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] === array[j] && !duplicates.includes(array[i])) {
        duplicates.push(array[i]);
      }
    }
  }
  return duplicates;
}
```

### Alternative Implementation Example

```javascript
function findDuplicates(array) {
  const seen = new Set();
  const duplicates = new Set();
  
  for (const item of array) {
    if (seen.has(item)) {
      duplicates.add(item);
    } else {
      seen.add(item);
    }
  }
  
  return Array.from(duplicates);
}
```

### Benchmark Results Example

| Implementation | Operations/sec | Relative |
|----------------|---------------|----------|
| Alternative 1  | 1,234,567     | 100%     |
| Alternative 2  | 876,543       | 71%      |
| Original       | 98,765        | 8%       |

## How It's Built

PerfCopilot uses the GitHub Copilot Chat API to:
1. Generate alternative implementations of the selected function
2. Create benchmark code using the benny.js library
3. Run the benchmarks locally
4. Format and present the results

## License

MIT 