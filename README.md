# PerfCopilot 🚀

<div align="center">
  <img src="https://raw.githubusercontent.com/ArnoldoM23/PerfCopilot/main/assets/logo.png" alt="PerfCopilot Logo" width="200" style="border-radius: 10px;">

  <p><strong>AI-powered JavaScript Function Performance Analyzer for VS Code</strong></p>
  
  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a> •
    <a href="#examples">Examples</a> •
    <a href="#troubleshooting">Troubleshooting</a> •
    <a href="#license">License</a>
  </p>
</div>

## Features

- 📊 Compare the performance of different JavaScript function implementations
- 🧠 Get intelligent alternative implementations for your functions
- 📈 View detailed performance metrics and comparisons
- 🎯 Find the most efficient implementation for your specific use case
- 💡 Learn optimization techniques through practical examples

## Installation

### From VSIX File

1. Download the `.vsix` file from the [latest release](https://github.com/ArnoldoM23/PerfCopilot/releases)
2. In VS Code, go to the Extensions view (Ctrl+Shift+X)
3. Click the "..." menu in the top-right of the Extensions view
4. Select "Install from VSIX..."
5. Select the downloaded `.vsix` file

### From Source

```bash
# Clone the repository
git clone https://github.com/ArnoldoM23/PerfCopilot.git

# Navigate to the directory
cd PerfCopilot

# Install dependencies
npm install

# Package the extension
npm run package

# Install the extension
code --install-extension perfcopilot-0.0.1.vsix
```

## Usage

### 1. Select a Function

For best results, select a **complete function declaration** including:
- The `function` keyword
- The function name
- Parameters
- The entire function body with curly braces

✅ **Correct selection:**

```javascript
function sumArray(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum;
}
```

❌ **Incorrect selection:**
```javascript
let sum = 0;
for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
}
return sum;
```

### 2. Analyze the Function

1. Right-click on the selected function
2. Choose "Analyze Function Performance" from the context menu
3. Either:
   - Enter an alternative implementation when prompted, or
   - Press Enter to let PerfCopilot generate an alternative

### 3. View Results

A webview will open showing:
- Both function implementations
- Performance metrics for each function
- Which implementation is faster and by how much
- Possible reasons for the performance difference

## Examples

Here are some examples of functions you can analyze:

### Array Sum Example

```javascript
// Select this entire function
function sumArray(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum;
}

// PerfCopilot will suggest using reduce:
function alternativeSumArray(arr) {
    return arr.reduce((sum, item) => sum + item, 0);
}
```

### Find Non-repeating Character Example

```javascript
// Select this entire function
function findFirstNonRepeating(str) {
    const charCount = {};
    
    // Count occurrences of each character
    for (let char of str) {
        charCount[char] = (charCount[char] || 0) + 1;
    }
    
    // Find first character with count of 1
    for (let char of str) {
        if (charCount[char] === 1) {
            return char;
        }
    }
    
    return null;
}
```

## Troubleshooting

### Error: "Unexpected token 'const'"

This error occurs when your function contains modern JavaScript syntax that can't be evaluated.

**Solutions:**
1. Make sure you're selecting a complete function declaration (including the `function` keyword and all brackets)
2. Try using `var` instead of `const` or `let` inside your function
3. Check the "PerfCopilot: Show Logs" output channel for detailed information

### Function Not Being Evaluated Correctly

**Solutions:**
1. Make sure your function is self-contained (doesn't rely on external variables)
2. Add test arguments inside the function if it requires specific inputs
3. Simplify complex functions for testing

### View Detailed Logs

If you encounter any issues:
1. Open the Command Palette (Ctrl+Shift+P)
2. Type and select "PerfCopilot: Show Logs"
3. Review the detailed logs to understand what went wrong

## License

Released under the [MIT License](LICENSE). 