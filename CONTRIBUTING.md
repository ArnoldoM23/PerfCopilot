# Contributing to PerfCopilot

Thank you for your interest in contributing to PerfCopilot! We appreciate your help.

## Reporting Issues

If you encounter a bug or have a suggestion for a new feature, please check the [existing issues](https://github.com/ArnoldoM23/PerfCopilot/issues) first to see if it has already been reported. If not, please [open a new issue](https://github.com/ArnoldoM23/PerfCopilot/issues/new/choose).

When reporting a bug, please include:

*   A clear and descriptive title.
*   Steps to reproduce the bug.
*   The expected behavior.
*   The actual behavior (including any error messages or logs from the "PerfCopilot" output channel).
*   Your VS Code version, PerfCopilot version, and operating system.

## Suggesting Features

For feature suggestions:

*   Provide a clear description of the feature and why it would be valuable.
*   Explain the use case or problem it solves.
*   If possible, suggest how the feature might work.

## Development Setup

1.  **Fork the repository:** Click the "Fork" button on the [main repository page](https://github.com/ArnoldoM23/PerfCopilot).
2.  **Clone your fork:** `git clone https://github.com/YOUR_USERNAME/PerfCopilot.git`
3.  **Navigate to the directory:** `cd PerfCopilot`
4.  **Install dependencies:** `npm install`
5.  **Open in VS Code:** `code .`
6.  **Start the compiler in watch mode:** Run the `npm run watch` task (or press `Cmd+Shift+B` or `Ctrl+Shift+B` and select `tsc: watch - tsconfig.json`).
7.  **Start the debugger:** Press `F5` to open a new VS Code window with the extension loaded (Extension Development Host).

## Making Changes

1.  Create a new branch for your changes: `git checkout -b my-feature-branch`
2.  Make your code changes. Ensure you follow the existing code style.
3.  Run the linter: `npm run lint`
4.  Run the tests: `npm test` (Make sure all tests pass!)
5.  Commit your changes with a clear commit message: `git commit -m "feat: Add new feature X"` (See [Conventional Commits](https://www.conventionalcommits.org/) for guidelines).
6.  Push your branch to your fork: `git push origin my-feature-branch`

## Submitting a Pull Request

1.  Go to the original [PerfCopilot repository](https://github.com/ArnoldoM23/PerfCopilot).
2.  Click on the "Pull requests" tab and then the "New pull request" button.
3.  Choose your fork and the branch containing your changes.
4.  Provide a clear title and description for your pull request, explaining the changes you made.
5.  Link any relevant issues (e.g., "Closes #123").
6.  Submit the pull request.

Project maintainers will review your pull request and provide feedback. Thank you for your contribution! 