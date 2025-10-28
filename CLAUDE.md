# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
**n8n-nodes-sogni** - A community n8n node for integrating Sogni AI image generation into n8n workflows. Supports text-to-image generation with ControlNet guidance capabilities.

## Development Commands

### Build & Development
```bash
npm run build       # Compile TypeScript and copy assets to dist/
npm run dev         # Build and watch for changes
npm run watch       # Continuous TypeScript compilation
```

### Code Quality
```bash
npm run lint        # Check code style
npm run lintfix     # Auto-fix ESLint issues
```

### Testing
```bash
npx ts-node test/node-validation.ts  # Run validation tests (25 test cases)
```

### Publishing
```bash
npm run prepublishOnly  # Validates build and lint before publish
```

## Architecture Overview

### Core Structure
- **Main Node**: `nodes/Sogni/Sogni.node.ts` - Implements all Sogni API operations (image generation, model listing, account balance)
- **Credentials**: `credentials/SogniApi.credentials.ts` - Defines authentication (username, password, optional appId)
- **Client Integration**: Uses local `sogni-client-wrapper` package (../sogni-client-wrapper) for WebSocket-based API communication
- **Output**: Compiled to `dist/` directory with TypeScript transpilation

### Key Patterns
1. **AppId Generation**: Each execution creates unique `n8n-{timestamp}-{random}` appId to prevent WebSocket collisions
2. **Binary Data**: Handles both image downloads (as binary data) and ControlNet control images (from binary input)
3. **Error Handling**: Respects n8n's `continueOnFail()` setting, graceful fallback for download failures
4. **Resource Pattern**: Three resources (image, model, account) with distinct operations per resource

### Resources & Operations

**Image Resource**:
- `generate`: Create AI images with optional ControlNet
- Required: modelId, positivePrompt, network (fast/relaxed)
- Supports 15 ControlNet types (canny, depth, openpose, etc.)

**Model Resource**:
- `getAll`: List available models with filtering
- `get`: Get specific model details

**Account Resource**:
- `getBalance`: Check Sogni/Spark token balance

### ControlNet Integration
When `enableControlNet` is true:
- Requires control image from binary input property
- Supports 15 types (canny, scribble, depth, openpose, etc.)
- Parameters: strength (0-1), mode (balanced/prompt_priority/cn_priority), guidance start/end

### Image Output Handling
- Downloads images by default to prevent 24-hour URL expiry
- Binary properties: `image` for first, `image_1`, `image_2` for additional
- Fallback: Returns imageUrls if download fails

## Testing Approach
Tests in `test/node-validation.ts` validate:
- Node structure and metadata
- Property definitions for each resource/operation
- Credential configuration
- Parameter types, ranges, and requirements

## Local Development Setup
1. Install dependencies: `npm install`
2. Link local sogni-client-wrapper if needed
3. Run `npm run dev` for watch mode
4. Test in n8n: Copy built files from `dist/` to `~/.n8n/custom/n8n-nodes-sogni/`

## Important Implementation Details
- **Timeout**: Default 10 minutes (600000ms) for image generation
- **Token Types**: Spark (relaxed, cheaper) vs SOGNI (fast, costlier)
- **Batch Processing**: Supports multiple items in single execution
- **WebSocket Cleanup**: Always disconnects client in finally block
- **Size Constraints**: Width/height 256-2048px, steps 1-100, guidance 0-30