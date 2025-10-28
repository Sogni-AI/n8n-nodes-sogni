# ControlNet Guide for Sogni AI n8n Node

Complete guide to using ControlNet for guided image generation in n8n workflows.

---

## What is ControlNet?

ControlNet allows you to guide AI image generation using a **control image**. Instead of generating from text alone, you can provide a reference image that controls specific aspects like:

- **Edges** (Canny)
- **Pose** (OpenPose)
- **Depth** (Depth Map)
- **Scribbles** (Scribble)
- **Line Art** (LineArt)
- And 10 more types!

---

## Supported ControlNet Types

### 1. **Canny** (Edge Detection)
**Best for**: Preserving structure and edges

Detects edges in your control image and uses them to guide generation.

**Example Use Case**:
- Upload a photo of a building
- Generate in different styles while keeping the structure

### 2. **Scribble**
**Best for**: Hand-drawn sketches

Use rough sketches or scribbles to guide the composition.

**Example Use Case**:
- Draw a simple sketch
- AI fills in details based on your prompt

### 3. **Line Art**
**Best for**: Clean line drawings

Extracts or uses line art to control the image structure.

**Example Use Case**:
- Provide a line drawing
- Generate colored, detailed artwork

### 4. **Line Art Anime**
**Best for**: Anime-style line art

Specialized for anime/manga style line art extraction and generation.

**Example Use Case**:
- Provide anime line art
- Generate fully colored anime artwork

### 5. **Soft Edge**
**Best for**: Soft, subtle edge guidance

Gentler edge detection for more artistic control.

**Example Use Case**:
- Softer composition control
- More artistic freedom than Canny

### 6. **Shuffle**
**Best for**: Color and composition transfer

Shuffles the control image while preserving overall composition.

**Example Use Case**:
- Transfer composition from one image to another
- Maintain layout while changing content

### 7. **Tile**
**Best for**: Seamless patterns and textures

Creates tileable patterns and textures.

**Example Use Case**:
- Generate seamless textures
- Create repeating patterns

### 8. **Inpaint**
**Best for**: Filling masked areas

Fill in or modify specific parts of an image.

**Example Use Case**:
- Remove objects
- Fill in missing parts
- Modify specific areas

### 9. **InstructPix2Pix** (instrp2p)
**Best for**: Instruction-based editing

Edit images based on text instructions.

**Example Use Case**:
- "Make the sky sunset"
- "Add snow to the ground"
- "Change to nighttime"

### 10. **Depth**
**Best for**: 3D structure preservation

Uses depth information to maintain 3D structure.

**Example Use Case**:
- Preserve spatial relationships
- Maintain foreground/background separation

### 11. **Normal Map** (normalbae)
**Best for**: Surface detail control

Uses surface normal information for detailed control.

**Example Use Case**:
- Preserve surface details
- Control lighting and shading

### 12. **OpenPose**
**Best for**: Human pose control

Detects and uses human poses to guide generation.

**Example Use Case**:
- Transfer poses between people
- Generate people in specific poses

### 13. **Segmentation**
**Best for**: Semantic layout control

Uses semantic segmentation to control different regions.

**Example Use Case**:
- Maintain layout of sky, ground, objects
- Control different semantic regions

### 14. **MLSD** (Line Segment Detection)
**Best for**: Architectural and geometric structures

Mobile Line Segment Detection for straight lines and structures.

**Example Use Case**:
- Architectural drawings
- Geometric compositions

### 15. **InstantID**
**Best for**: Identity preservation

Preserves identity/face while changing other aspects.

**Example Use Case**:
- Keep same person in different scenes
- Change style while preserving identity

---

## How to Use ControlNet in n8n

### Basic Workflow Structure

```
1. Load Control Image → 2. Sogni Generate with ControlNet → 3. Output
```

### Step-by-Step Example

#### 1. Load Your Control Image

Use any node that provides binary data:
- **HTTP Request** - Download from URL
- **Read Binary File** - Load from disk
- **Previous Node** - Use output from image processing

#### 2. Configure Sogni Node

**Basic Settings**:
- Resource: `Image`
- Operation: `Generate`
- Model ID: `flux1-schnell-fp8`
- Positive Prompt: Your text description
- Network: `relaxed` or `fast`

**ControlNet Settings** (in Additional Fields):
- ✅ Enable ControlNet: `true`
- ControlNet Type: Choose from 15 types
- ControlNet Image Property: `data` (or your binary property name)
- ControlNet Strength: `0.5` (0-1, adjust as needed)
- ControlNet Mode: `balanced`
- Guidance Start: `0`
- Guidance End: `1`

#### 3. Receive Output

The node outputs:
- **JSON**: Project info, URLs
- **Binary**: Downloaded images (if enabled)

---

## Complete Workflow Examples

### Example 1: Edge-Guided Generation (Canny)

```json
{
  "nodes": [
    {
      "name": "Load Image",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://example.com/building.jpg",
        "responseFormat": "file"
      }
    },
    {
      "name": "Generate with Canny",
      "type": "n8n-nodes-sogni.sogni",
      "parameters": {
        "resource": "image",
        "operation": "generate",
        "modelId": "flux1-schnell-fp8",
        "positivePrompt": "A fantasy castle, magical, glowing, night scene",
        "network": "relaxed",
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
    }
  ]
}
```

**Result**: Generates a fantasy castle that follows the structure/edges of the building photo.

---

### Example 2: Pose Transfer (OpenPose)

```json
{
  "nodes": [
    {
      "name": "Load Pose Image",
      "type": "n8n-nodes-base.readBinaryFile",
      "parameters": {
        "filePath": "/path/to/person-pose.jpg"
      }
    },
    {
      "name": "Generate with Pose",
      "type": "n8n-nodes-sogni.sogni",
      "parameters": {
        "resource": "image",
        "operation": "generate",
        "modelId": "flux1-schnell-fp8",
        "positivePrompt": "A superhero in dynamic action pose, comic book style",
        "network": "relaxed",
        "additionalFields": {
          "enableControlNet": true,
          "controlNetType": "openpose",
          "controlNetImageProperty": "data",
          "controlNetStrength": 0.8,
          "controlNetMode": "cn_priority",
          "steps": 20
        }
      }
    }
  ]
}
```

**Result**: Generates a superhero in the same pose as the control image.

---

### Example 3: Sketch to Image (Scribble)

```json
{
  "nodes": [
    {
      "name": "Load Sketch",
      "type": "n8n-nodes-base.readBinaryFile",
      "parameters": {
        "filePath": "/path/to/sketch.png"
      }
    },
    {
      "name": "Generate from Sketch",
      "type": "n8n-nodes-sogni.sogni",
      "parameters": {
        "resource": "image",
        "operation": "generate",
        "modelId": "flux1-schnell-fp8",
        "positivePrompt": "A beautiful landscape, mountains, lake, sunset, photorealistic",
        "network": "relaxed",
        "additionalFields": {
          "enableControlNet": true,
          "controlNetType": "scribble",
          "controlNetImageProperty": "data",
          "controlNetStrength": 0.6,
          "controlNetMode": "balanced",
          "steps": 20
        }
      }
    }
  ]
}
```

**Result**: Converts your sketch into a detailed, photorealistic landscape.

---

## Parameter Guide

### ControlNet Strength (0-1)

Controls the balance between your prompt and the control image.

- **0.0**: Ignore control image, follow prompt only
- **0.3**: Slight guidance from control image
- **0.5**: Balanced (recommended starting point)
- **0.7**: Strong guidance from control image
- **1.0**: Maximum control from image

**Recommendation**: Start with 0.5 and adjust based on results.

---

### ControlNet Mode

Controls how prompt and control image are weighted.

#### Balanced
- Equal weight to prompt and control
- **Use when**: You want both to influence equally
- **Best for**: Most use cases

#### Prompt Priority
- Prompt has more impact
- **Use when**: You want more creative freedom
- **Best for**: When control image is just a rough guide

#### ControlNet Priority
- Control image has more impact
- **Use when**: You want to strictly follow the structure
- **Best for**: Precise structure preservation

---

### Guidance Start/End (0-1)

Controls **when** during generation ControlNet is applied.

- **Start**: 0 = first step, 1 = last step
- **End**: 0 = first step, 1 = last step

**Common Patterns**:

```
Start: 0, End: 1    → Apply throughout (default)
Start: 0, End: 0.5  → Apply early, let AI finish freely
Start: 0.3, End: 1  → Let AI start freely, control later
Start: 0.2, End: 0.8 → Apply only in middle steps
```

**Recommendation**: Use default (0, 1) unless you have specific needs.

---

## Tips & Best Practices

### 1. Choose the Right ControlNet Type

Match the type to your control image:
- **Photo with clear edges** → Canny
- **Sketch/drawing** → Scribble or LineArt
- **Person/pose** → OpenPose
- **Depth information** → Depth
- **Editing instructions** → InstructPix2Pix

### 2. Adjust Strength Based on Desired Control

- **High strength (0.7-1.0)**: Strict adherence to control
- **Medium strength (0.4-0.6)**: Balanced guidance
- **Low strength (0.1-0.3)**: Subtle influence

### 3. Use Appropriate Steps

- **Canny, Scribble, LineArt**: 15-25 steps
- **OpenPose, Depth**: 20-30 steps
- **InstructPix2Pix**: 10-20 steps
- **Flux models**: 4-8 steps (they're optimized for fewer steps)

### 4. Control Image Quality

- **Resolution**: Match or exceed desired output resolution
- **Clarity**: Clear, well-defined features work best
- **Format**: PNG or JPG both work fine

### 5. Prompt Engineering with ControlNet

Your prompt still matters! Be specific:

**Good Prompts**:
- "A medieval knight in armor, photorealistic, detailed"
- "Anime character, vibrant colors, studio ghibli style"
- "Architectural rendering, modern design, glass and steel"

**Poor Prompts**:
- "A person" (too vague)
- "Something cool" (no direction)

### 6. Combine with Other Parameters

ControlNet works well with:
- **Negative Prompt**: Avoid unwanted elements
- **Seed**: Reproducible results
- **Guidance**: Fine-tune prompt adherence

---

## Troubleshooting

### Issue: "No binary data found"

**Cause**: Control image not in specified property

**Solution**:
1. Check the binary property name (usually `data`)
2. Ensure previous node outputs binary data
3. Use "View" in n8n to inspect binary properties

---

### Issue: Generated image ignores control

**Cause**: Strength too low or wrong ControlNet type

**Solution**:
1. Increase `controlNetStrength` to 0.7-0.8
2. Change mode to `cn_priority`
3. Verify you're using the right ControlNet type

---

### Issue: Generated image too similar to control

**Cause**: Strength too high

**Solution**:
1. Decrease `controlNetStrength` to 0.3-0.5
2. Change mode to `prompt_priority`
3. Adjust guidance start/end to apply control selectively

---

### Issue: Poor quality results

**Cause**: Low steps or incompatible model

**Solution**:
1. Increase steps to 20-30
2. Use a model compatible with ControlNet
3. Ensure control image is high quality

---

## Advanced Techniques

### Multi-Stage ControlNet

Use multiple ControlNet passes for complex results:

```
1. Canny (structure) → 2. Depth (3D) → 3. OpenPose (pose) → Final
```

### Conditional ControlNet

Enable ControlNet only when certain conditions are met:

```javascript
// In a Code node before Sogni
const enableCN = $json.hasControlImage === true;
return {
  ...
  enableControlNet: enableCN
};
```

### Batch Processing with Different Types

Process multiple images with different ControlNet types:

```
Loop → Select ControlNet Type → Sogni Generate → Aggregate
```

---

## ControlNet Type Selection Guide

| Your Goal | Recommended Type | Strength | Mode |
|-----------|-----------------|----------|------|
| Preserve structure | Canny | 0.7 | Balanced |
| Sketch to image | Scribble | 0.6 | Balanced |
| Pose transfer | OpenPose | 0.8 | CN Priority |
| Maintain depth | Depth | 0.7 | Balanced |
| Line art coloring | LineArt | 0.8 | CN Priority |
| Anime coloring | LineArtAnime | 0.8 | CN Priority |
| Texture creation | Tile | 0.6 | Balanced |
| Object removal | Inpaint | 0.7 | Balanced |
| Style transfer | Shuffle | 0.5 | Balanced |
| Instruction editing | InstructPix2Pix | 0.6 | Prompt Priority |
| Soft composition | SoftEdge | 0.5 | Balanced |
| Identity preservation | InstantID | 0.9 | CN Priority |
| Semantic layout | Segmentation | 0.7 | Balanced |
| Architecture | MLSD | 0.8 | CN Priority |
| Surface details | NormalMap | 0.7 | Balanced |

---

## Example Prompts by ControlNet Type

### Canny (Edge Detection)
```
"A futuristic cyberpunk city, neon lights, rain, blade runner style, highly detailed"
```

### Scribble
```
"A fantasy landscape, mountains, castle, magical atmosphere, concept art"
```

### OpenPose
```
"A ballet dancer in elegant pose, flowing dress, stage lighting, professional photography"
```

### LineArt
```
"Detailed illustration, vibrant colors, fantasy character, digital art"
```

### Depth
```
"Photorealistic scene, proper depth of field, cinematic lighting, 8k quality"
```

### InstructPix2Pix
```
"Change the time to sunset, add warm orange glow, dramatic clouds"
```

---

## Resources

- [Sogni AI Documentation](https://sdk-docs.sogni.ai/)
- [ControlNet Paper](https://arxiv.org/abs/2302.05543)
- [Example Workflows](./examples/)

---

## Support

For issues or questions:
1. Check this guide
2. Review example workflows
3. Check the main README
4. Submit an issue on GitHub

---

**Happy generating with ControlNet!** 🎨

