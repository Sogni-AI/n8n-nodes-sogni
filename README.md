# n8n-nodes-sogni

**Enhanced n8n Community Node for Sogni AI Image Generation**

Generate AI images using Sogni AI Supernet directly in your n8n workflows with **full ControlNet support** for guided image generation.

This node pulls from your personal Sogni account—[sign up for free](https://app.sogni.ai/create?code=n8n) to get 50 free Render credits per day. Under the hood, the project utilizes the [`@sogni-ai/sogni-client-wrapper`](https://www.npmjs.com/package/@sogni-ai/sogni-client-wrapper), which is built on top of the official [`@sogni-ai/sogni-client`](https://www.npmjs.com/package/@sogni-ai/sogni-client) SDK.

<img src="https://raw.githubusercontent.com/Sogni-Ai/n8n-nodes-sogni/main/img/sogni-n8n-example-workflow.png" alt="Example n8n workflow using the Sogni node" width="1152">

---

## 🆕 What's New

### 📥 Automatic Image Download
- Download generated images as binary data
- Prevents 24-hour URL expiry issues
- Proper MIME type handling
- **Enabled by default** for reliability

### 🔑 Enhanced AppId Management
- Auto-generates unique appId per execution
- Prevents WebSocket socket collisions
- Supports concurrent workflow runs
- Manual override still available

### ⚙️ Improved Defaults
- Default network: `fast` (quicker generation)
- **Timeout defaults by network** when not set: `fast = 60s`, `relaxed = 600s`
- Default token type: `spark`
- Download images: enabled by default

### ✨ Full ControlNet Support
- **15 ControlNet types** supported (canny, scribble, lineart, openpose, depth, and more)
- Guide image generation with control images
- Full parameter control (strength, mode, guidance timing)
- See [ControlNet Guide](./CONTROLNET_GUIDE.md) for details

---

## Features

### Resources & Operations

#### Image Resource
- **Generate**: Create AI images with optional ControlNet guidance

#### Model Resource
- **Get All**: List all available models
- **Get**: Get specific model details

#### Account Resource
- **Get Balance**: Check SOGNI and Spark token balance

---

## Installation

### Option 1: Community Nodes UI (Recommended)

1. In n8n, open **Settings ▸ Community Nodes**
2. Select **Install**
3. Enter `n8n-nodes-sogni`
4. Confirm the installation (restart n8n if prompted)

### Option 2: Manual Installation

```bash
# Run in your n8n installation directory
npm install n8n-nodes-sogni
# Restart your n8n instance after installation
```

---

## Configuration

### 1. Add Credentials

1. In n8n, go to **Credentials**
2. Click **Add Credential**
3. Search for "Sogni AI"
4. Enter your credentials:
   - **Username**: Your Sogni account username
   - **Password**: Your Sogni account password
   - **App ID**: (Optional) Leave empty for auto-generation

### 2. Add Node to Workflow

1. Create or open a workflow
2. Click **+** to add a node
3. Search for "Sogni AI"
4. Select the node and configure

---

## Basic Usage

### Simple Image Generation

```json
{
  "resource": "image",
  "operation": "generate",
  "modelId": "flux1-schnell-fp8",
  "positivePrompt": "A beautiful sunset over mountains",
  "network": "fast",
  "additionalFields": {
    "negativePrompt": "blurry, low quality",
    "steps": 20,
    "guidance": 7.5,
    "tokenType": "spark",
    "downloadImages": true
  }
}
```

### ControlNet-Guided Generation

```json
{
  "resource": "image",
  "operation": "generate",
  "modelId": "flux1-schnell-fp8",
  "positivePrompt": "A fantasy castle, magical, glowing",
  "network": "fast",
  "additionalFields": {
    "enableControlNet": true,
    "controlNetType": "canny",
    "controlNetImageProperty": "data",
    "controlNetStrength": 0.7,
    "controlNetMode": "balanced",
    "steps": 20,
    "downloadImages": true
  }
}
```

---

## ControlNet Types

All 15 ControlNet types are supported:

| Type | Description | Best For |
|------|-------------|----------|
| **canny** | Edge detection | Structure preservation |
| **scribble** | Hand-drawn sketches | Sketch to image |
| **lineart** | Line art extraction | Clean line drawings |
| **lineartanime** | Anime line art | Anime/manga style |
| **softedge** | Soft edge detection | Artistic control |
| **shuffle** | Composition transfer | Layout preservation |
| **tile** | Tiling patterns | Seamless textures |
| **inpaint** | Masked area filling | Object removal/editing |
| **instrp2p** | Instruction-based editing | Text-guided edits |
| **depth** | Depth map | 3D structure |
| **normalbae** | Normal map | Surface details |
| **openpose** | Pose detection | Human pose transfer |
| **segmentation** | Semantic segmentation | Layout control |
| **mlsd** | Line segment detection | Architecture |
| **instantid** | Identity preservation | Face consistency |

See [ControlNet Guide](./CONTROLNET_GUIDE.md) for detailed usage instructions.

---

## Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| **Model ID** | string | AI model to use (e.g., `flux1-schnell-fp8`) |
| **Positive Prompt** | string | What you want to generate |
| **Network** | options | `fast` (SOGNI tokens) or `relaxed` (Spark tokens) |

### Optional Parameters (Additional Fields)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **Negative Prompt** | string | "" | What to avoid |
| **Style Prompt** | string | "" | Style description |
| **Number of Images** | number | 1 | How many images (1-10) |
| **Steps** | number | 20 | Inference steps (1-100) |
| **Guidance** | number | 7.5 | Prompt adherence (0-30) |
| **Token Type** | options | spark | `spark` or `sogni` |
| **Output Format** | options | png | `png` or `jpg` |
| **Download Images** | boolean | true | Download as binary data |
| **Size Preset** | string | "" | Size preset ID |
| **Width** | number | 1024 | Custom width (256-2048) |
| **Height** | number | 1024 | Custom height (256-2048) |
| **Seed** | number | random | Reproducibility seed |
| **Timeout** | number | 600000 | Max wait time (ms) |

### ControlNet Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **Enable ControlNet** | boolean | false | Enable ControlNet |
| **ControlNet Type** | options | canny | Type of ControlNet |
| **Control Image Property** | string | data | Binary property name |
| **Strength** | number | 0.5 | Control strength (0-1) |
| **Mode** | options | balanced | balanced / prompt_priority / cn_priority |
| **Guidance Start** | number | 0 | When to start (0-1) |
| **Guidance End** | number | 1 | When to end (0-1) |

---

## Example Workflows

See the [examples](./examples/) directory for complete workflow JSON files:

1. **Basic Image Generation** - Simple text-to-image
2. **Batch Processing** - Generate multiple images
3. **Dynamic Model Selection** - Auto-select best model
4. **Scheduled Generation** - Daily automated images
5. **ControlNet Edge Detection** - Structure-guided generation
6. **ControlNet Pose Transfer** - Pose-guided generation

---

## Output

### JSON Output

```json
{
  "projectId": "ABC123...",
  "modelId": "flux1-schnell-fp8",
  "prompt": "A beautiful sunset...",
  "imageUrls": [
    "https://complete-images-production.s3-accelerate.amazonaws.com/..."
  ],
  "completed": true,
  "jobs": [
    {
      "id": "JOB123...",
      "status": "completed"
    }
  ]
}
```

### Binary Output (when downloadImages = true)

- **image**: First generated image
- **image_1**: Second image (if multiple)
- **image_2**: Third image (if multiple)
- etc.

Binary data includes:
- Proper MIME type (image/png or image/jpeg)
- Filename: `sogni_[projectId]_[index].[ext]`
- Full resolution image data

---

## Tips & Best Practices

### 1. Network Selection

- **Fast Network**:
  - Uses SOGNI tokens
  - Faster generation (seconds to minutes)
  - Higher cost
  - Best for: Time-sensitive applications

- **Relaxed Network**:
  - Uses Spark tokens
  - Slower generation (minutes to hours)
  - Lower cost
  - Best for: Batch processing, scheduled jobs

### 2. Model Selection

Popular models:
- `flux1-schnell-fp8`: Fast, high quality, 4 steps recommended
- `coreml-sogni_artist_v1_768`: Artistic style
- `chroma-v.46-flash_fp8`: Fast generation

Use "Get All Models" operation to see all available models.

### 3. Steps Configuration

- **Flux models**: 4-8 steps (optimized for speed)
- **SD models**: 15-30 steps (better quality)
- **ControlNet**: 20-30 steps (more control)

### 4. ControlNet Usage

- Start with strength 0.5 and adjust
- Use `balanced` mode for most cases
- Match ControlNet type to your control image
- See [ControlNet Guide](./CONTROLNET_GUIDE.md) for details

### 5. Image Download

- **Enable** `downloadImages` to prevent URL expiry
- URLs expire after 24 hours
- Binary data is permanent in n8n
- Recommended for production workflows

### 6. Timeout Configuration

- **Fast network**: 60,000ms (1 minute) usually enough
- **Relaxed network**: 600,000ms (10 minutes) recommended
- Adjust based on complexity and model

---

## Troubleshooting

### "Insufficient funds" Error

**Solution**: Add more Spark or SOGNI tokens to your account

### "Model not found" Error

**Solution**: Use "Get All Models" to see available models

### "No binary data found" (ControlNet)

**Solution**:
1. Ensure previous node outputs binary data
2. Check the binary property name
3. Use "View" in n8n to inspect data

### Workflow Times Out

**Solution**:
- Use relaxed network for slower but more reliable generation
- Increase timeout in Additional Fields
- Split large batches into smaller chunks

### Images Not Downloaded

**Solution**:
- Check `downloadImages` is enabled
- Verify network connectivity
- Check n8n logs for download errors

---

## Advanced Usage

### Combining with Other Nodes

#### Discord Integration
```
Sogni Generate → HTTP Request (Discord Webhook)
```

#### Google Drive Storage
```
Sogni Generate → Google Drive (Upload File)
```

#### Social Media Posting
```
Sogni Generate → Twitter/Instagram API
```

#### Image Processing Pipeline
```
Load Image → Sogni ControlNet → Post-Processing → Save
```

### Dynamic Prompts

Use expressions to generate dynamic prompts:

```javascript
{{ "A " + $json.style + " image of " + $json.subject }}
```

### Conditional ControlNet

Enable ControlNet based on conditions:

```javascript
{{ $json.hasControlImage ? true : false }}
```

---

## API Reference

### Wrapper Library

This node uses the `@sogni-ai/sogni-client-wrapper` library. For standalone Node.js usage:

```typescript
import { SogniClientWrapper } from '@sogni-ai/sogni-client-wrapper';

const client = new SogniClientWrapper({
  username: 'your-username',
  password: 'your-password',
  autoConnect: true,
});

const result = await client.createProject({
  modelId: 'flux1-schnell-fp8',
  positivePrompt: 'A beautiful sunset',
  network: 'fast',
  tokenType: 'spark',
  waitForCompletion: true,
});
```

See [@sogni-ai/sogni-client-wrapper](https://www.npmjs.com/package/@sogni-ai/sogni-client-wrapper) for full API documentation.

---

## Version History

### v1.1.9 (Current)
- 📝 Updated Sogni signup copy and highlighted ControlNet positioning

### v1.1.8
- 🆕 Refreshed installation instructions and Sogni account links
- 📚 Added references to Sogni platform, docs, and SDK packages

### v1.1.6
- ⚡ Changed default network from "relaxed" to "fast" for quicker generation
- 📝 Documentation updates

### v1.1.5
- 🔧 Minor bug fixes and improvements
- 📝 Documentation updates

### v1.1.0-1.1.4
- ✨ Added full ControlNet support (15 types)
- 📥 Added automatic image download
- 🔑 Enhanced appId auto-generation
- ⚙️ Improved default values
- 📚 Added ControlNet guide

### v1.0.0
- Initial release
- Basic image generation
- Model and account operations
- Size presets support

---

## Resources

- [ControlNet Guide](./CONTROLNET_GUIDE.md) - Complete ControlNet usage guide
- [Example Workflows](./examples/) - Ready-to-use workflow examples
- [Sogni AI](https://www.sogni.ai/) - Platform overview and product updates
- [Sogni SDK Docs](https://sdk-docs.sogni.ai/) - Official SDK documentation
- [Sogni Docs](https://docs.sogni.ai/) - Platform guides and API references
- [Integration Guide](../INTEGRATION_GUIDE.md) - Complete integration guide

---

## Support

For issues or questions:
1. Check this README
2. Review the [ControlNet Guide](./CONTROLNET_GUIDE.md)
3. Check [example workflows](./examples/)
4. Submit an issue on GitHub

---

## License

MIT License - See LICENSE file for details

---

## Credits

Built with:
- [@sogni-ai/sogni-client](https://www.npmjs.com/package/@sogni-ai/sogni-client) - Official Sogni SDK
- [@sogni-ai/sogni-client-wrapper](https://www.npmjs.com/package/@sogni-ai/sogni-client-wrapper) - Enhanced wrapper library
- [n8n](https://n8n.io/) - Workflow automation platform

---

**Ready to generate amazing AI images with ControlNet in your n8n workflows!** 🎨✨
