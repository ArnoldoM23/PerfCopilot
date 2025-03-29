# Function Performance Analyzer

A VS Code extension that analyzes and compares function performance using Benny.js and OpenAI's GPT-4.

## Features

- Select any JavaScript function in your code
- Get an alternative implementation using GPT-4
- Compare performance between original and alternative implementations
- View detailed performance metrics and explanations
- Beautiful webview interface showing results

## Requirements

- VS Code 1.85.0 or higher
- Node.js and npm
- OpenAI API key

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Set your OpenAI API key as an environment variable:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```
4. Press F5 to start debugging the extension

## Usage

1. Open any JavaScript file in VS Code
2. Select a function you want to analyze
3. Right-click and select "Analyze Function Performance" from the context menu
4. View the performance comparison in the new webview panel

## How it Works

1. The extension captures the selected function
2. Uses GPT-4 to generate an alternative implementation
3. Uses Benny.js to benchmark both implementations
4. Displays results with detailed performance metrics and explanations

## Extension Settings

This extension contributes the following commands:

* `function-performance-analyzer.analyzeFunction`: Analyze the selected function's performance

## Known Issues

- Currently only supports JavaScript functions
- Requires an active internet connection for GPT-4 integration
- Performance results may vary based on system load and resources

## Release Notes

### 0.0.1

Initial release of Function Performance Analyzer 