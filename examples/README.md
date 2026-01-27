# Sogni AI n8n Workflow Examples

This directory contains example workflows demonstrating various use cases for the Sogni AI n8n node.

## 📋 Available Examples

### 1. Basic Image Generation
**File**: `1-basic-image-generation.json`

A simple workflow that generates a single image with Sogni AI.

**Features:**
- Manual trigger
- Single image generation
- Basic parameters (prompt, negative prompt, steps, guidance)
- Uses Spark tokens

**Use Case**: Quick image generation for testing or one-off creations

---

### 2. Batch Image Generation
**File**: `2-batch-image-generation.json`

Generate multiple images from a list of prompts in a single workflow run.

**Features:**
- Multiple prompts in an array
- Split into individual items
- Generate image for each prompt
- Aggregate results
- Random seed for variety

**Use Case**: Creating multiple variations, batch processing, content creation

---

### 3. Dynamic Model Selection
**File**: `3-dynamic-model-selection.json`

Automatically select the best available model based on worker count.

**Features:**
- Fetch all available models
- Sort by worker count
- Select model with most workers
- Use recommended settings
- Generate with optimal configuration

**Use Case**: Ensuring fastest generation times, automatic optimization

---

### 4. Scheduled Daily Images
**File**: `4-scheduled-daily-images.json`

Generate an image automatically every day at 9 AM.

**Features:**
- Schedule trigger (cron)
- Token balance check
- Conditional execution
- Random prompt selection
- Formatted output

**Use Case**: Daily inspiration, automated content creation, social media posting

---

### 5. Video Generation
**File**: `5-video-generation.json`

Generate AI videos with customizable parameters.

**Features:**
- Video model selection
- Configurable frames and FPS
- Multiple output formats (MP4, WebM, GIF)
- Resolution control
- Automatic video download

**Use Case**: Animation creation, social media content, video effects

---

### 6. Image Edit with Qwen
**File**: `6-image-edit-qwen.json`

Edit existing images using Sogni's Qwen AI model to modify backgrounds, subjects, or add elements.

**Features:**
- Read local image file as context
- Qwen Image Edit model for intelligent edits
- Configurable negative prompts
- Guidance scale control
- Automatic image download

**Use Case**: Background replacement, image retouching, creative edits

---

### 7. Emotional Slothi - Telegram Price Bot
**File**: `7-emotional-slothi-telegram.json`

Post AI-edited images to Telegram with dynamic text and emotional expressions based on real-time cryptocurrency price data.

**Features:**
- Fetches live SOGNI token price from CoinMarketCap
- Qwen Image Edit to update text on reference image
- Dynamic emotional expressions based on 24h price change
- Scheduled hourly execution
- Telegram integration for automatic posting

**Emotion Mapping:**
- ≥3%: Ecstatic (jumping with joy)
- ≥2%: Extremely Happy
- ≥1%: Very Happy
- \>0%: Slightly Happy
- \>-1%: Slightly Unhappy
- \>-3%: Very Unhappy
- ≤-3%: Crying

**Use Case**: Crypto price bots, social media automation, dynamic content creation

---

## 🚀 How to Use These Examples

### Method 1: Import via n8n UI

1. Open your n8n instance
2. Click on **Workflows** in the sidebar
3. Click **Import from File**
4. Select one of the JSON files from this directory
5. Configure your Sogni AI credentials
6. Click **Execute Workflow** to test

### Method 2: Import via CLI

```bash
# Copy example to n8n workflows directory
cp examples/1-basic-image-generation.json ~/.n8n/workflows/

# Restart n8n
n8n restart
```

### Method 3: Copy-Paste

1. Open the JSON file in a text editor
2. Copy the entire contents
3. In n8n, click **Import from URL or String**
4. Paste the JSON
5. Click **Import**

---

## ⚙️ Configuration Required

Before running these workflows, you need to:

### 1. Set Up Sogni AI Credentials

1. In n8n, go to **Credentials**
2. Click **Add Credential**
3. Search for "Sogni AI"
4. Enter your credentials:
   - **Username**: Your Sogni account username
   - **Password**: Your Sogni account password
   - **App ID**: (Optional) Auto-generated if not provided

### 2. Adjust Parameters

Each workflow can be customized by modifying:

- **Model ID**: Choose from 377+ available models
- **Prompts**: Change the text prompts
- **Steps**: Adjust quality (more steps = better quality, slower)
- **Guidance**: Control adherence to prompt (higher = more strict)
- **Network**: Choose `fast` (SOGNI tokens) or `relaxed` (Spark tokens)
- **Token Type**: Choose `sogni` or `spark`

---

## 💡 Tips and Best Practices

### Choosing the Right Network

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

### Token Management

Always check your token balance before generating images:

```javascript
// In a Code node
const balance = $input.first().json;
if (balance.spark < 100) {
  throw new Error('Insufficient Spark tokens');
}
```

### Error Handling

Enable "Continue on Fail" in node settings to handle errors gracefully:

1. Click on the Sogni node
2. Go to **Settings** tab
3. Enable **Continue on Fail**
4. Add an IF node to check for errors

### Rate Limiting

Add delays between requests to avoid rate limiting:

```javascript
// In a Code node
await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
return $input.all();
```

---

## 🎨 Advanced Use Cases

### Combining with Other Nodes

#### Send Generated Images to Discord

```
Sogni Generate → HTTP Request (Discord Webhook) → Done
```

#### Save Images to Google Drive

```
Sogni Generate → Google Drive (Upload File) → Done
```

#### Post to Social Media

```
Sogni Generate → Twitter/Instagram API → Done
```

#### Create Image Variations

```
Loop → Sogni Generate (different seeds) → Aggregate → Done
```

---

## 📊 Example Output

When a workflow completes, you'll receive:

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

---

## 🐛 Troubleshooting

### "Insufficient funds" Error

**Solution**: Add more Spark or SOGNI tokens to your account

### "Model not found" Error

**Solution**: Use the "Get All Models" operation to see available models

### "Rate limit exceeded" Error

**Solution**: Add delays between requests or use the relaxed network

### Workflow Times Out

**Solution**: 
- Use the relaxed network for slower but more reliable generation
- Increase n8n's execution timeout in settings
- Split large batches into smaller chunks

---

## 📚 Additional Resources

- [Sogni AI Documentation](https://sdk-docs.sogni.ai/)
- [n8n Documentation](https://docs.n8n.io/)
- [Sogni Client Wrapper README](../../sogni-client-wrapper/README.md)
- [Integration Guide](../../INTEGRATION_GUIDE.md)

---

## 🤝 Contributing

Have a cool workflow example? Submit a pull request!

1. Create your workflow in n8n
2. Export as JSON
3. Add to this directory with a descriptive name
4. Update this README with a description
5. Submit PR

---

## 📝 License

These examples are provided as-is under the MIT License. Feel free to modify and use them in your projects.

