#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting extension packaging process...${NC}"

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo -e "${RED}vsce is not installed. Installing...${NC}"
    npm install -g @vscode/vsce
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf out
rm -f *.vsix

# Install dependencies
echo "Installing dependencies..."
npm install

# Compile TypeScript
echo "Compiling TypeScript..."
npm run compile

# Package the extension
echo "Packaging extension..."
npm run package

# Check if packaging was successful
if [ -f "function-performance-analyzer-0.0.1.vsix" ]; then
    echo -e "${GREEN}Extension packaged successfully!${NC}"
    echo -e "${GREEN}You can find the .vsix file in the root directory${NC}"
    echo -e "${GREEN}To install locally, run: code --install-extension function-performance-analyzer-0.0.1.vsix${NC}"
else
    echo -e "${RED}Failed to package extension${NC}"
    exit 1
fi 