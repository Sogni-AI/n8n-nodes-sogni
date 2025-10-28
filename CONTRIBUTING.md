# Contributing to n8n-nodes-sogni

Thank you for your interest in contributing to the n8n-nodes-sogni project! This document provides guidelines and instructions for contributing.

## Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/Sogni-AI/n8n-nodes-sogni.git
   cd n8n-nodes-sogni
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Watch for changes during development:
   ```bash
   npm run dev
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the source files:
   - Node implementation: `nodes/Sogni/Sogni.node.ts`
   - Credentials: `credentials/SogniApi.credentials.ts`
   - Types and interfaces: Check existing TypeScript files

3. Build and test your changes:
   ```bash
   npm run build
   npm run lint
   npx ts-node test/node-validation.ts
   ```

### Testing in n8n

To test your changes in n8n:

1. Build the project:
   ```bash
   npm run build
   ```

2. Copy the built files to your n8n custom nodes directory:
   ```bash
   cp -r dist/* ~/.n8n/custom/n8n-nodes-sogni/
   ```

3. Restart n8n to load the updated node

## Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Ensure all code passes the linter:
  ```bash
  npm run lint
  ```

## Testing

Run the validation tests to ensure your changes don't break existing functionality:

```bash
npx ts-node test/node-validation.ts
```

All 25 tests should pass before submitting a PR.

## Pull Request Process

1. Ensure your code builds without errors:
   ```bash
   npm run build
   ```

2. Run and pass all tests:
   ```bash
   npx ts-node test/node-validation.ts
   ```

3. Fix any linting issues:
   ```bash
   npm run lintfix
   ```

4. Update the README.md if you've added new features or changed behavior

5. Update the version in package.json following semantic versioning:
   - PATCH version for bug fixes
   - MINOR version for new features
   - MAJOR version for breaking changes

6. Create a Pull Request with:
   - Clear title describing the change
   - Description of what was changed and why
   - Any relevant issue numbers

## Reporting Issues

When reporting issues, please include:

- Node version (`node --version`)
- n8n version
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Any error messages or logs

## Feature Requests

Feature requests are welcome! Please open an issue describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternative solutions you've considered

## Questions?

If you have questions about contributing, please open an issue with the "question" label.

Thank you for contributing to n8n-nodes-sogni!