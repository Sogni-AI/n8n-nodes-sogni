# Video Generation Tests

This directory contains test scripts for video generation using the Sogni AI wrapper.

## Setup

1. Create a `.env` file in the project root with your Sogni credentials:
```bash
SOGNI_USERNAME=your_username
SOGNI_PASSWORD=your_password
```

2. Ensure you have sufficient tokens:
   - **Spark tokens**: ~500 for a 5-second video (cheaper)
   - **SOGNI tokens**: More expensive but same result

## Available Tests

### Check Video Models (Run First!)
```bash
npm run test:check-models
```
- Lists all available video models
- Shows worker counts and availability
- Helps identify which models to use
- No video generation, just checks availability

### Minimal Video Test (Most Reliable)
```bash
npm run test:video:minimal
```
- Simplest test with detailed logging
- No progress tracking (avoids NaN% issue)
- Shows step-by-step what's happening
- Best for debugging connection issues

### Quick Video Test
```bash
npm run test:video
```
- Generates a simple 5-second video
- Uses the fastest model settings (4 steps)
- Minimum resolution (480x480)
- Shows progress when available

### Detailed Video Test
```bash
npm run test:video:detailed
```
- More comprehensive test with detailed logging
- Downloads the video locally
- Shows metadata and cost information
- Checks model availability

### Node Validation Test
```bash
npm run test:validation
```
- Validates the n8n node structure
- Checks all parameters are properly configured

## Video Generation Parameters

Based on the Sogni SDK script, here are the key parameters for video generation:

### Models
- **Speed Model**: `wan_v2.2-14b-fp8_t2v_lightx2v` (fastest, 4-8 steps)
- **Quality Model**: `wan_v2.2-14b-fp8_t2v` (slower, 20-40 steps, 2.5x cost)

### Constraints
- **Minimum Resolution**: 480x480 pixels (Wan 2.2 requirement)
- **Frames Range**: 17-161 frames
- **FPS Options**: 16 or 32 fps
- **Duration**: Calculate as `(frames - 1) / fps` seconds

### Recommended Settings for Testing

**Fast 5-second test:**
```javascript
{
  modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  frames: 81,      // 5 seconds at 16fps
  fps: 16,
  steps: 4,        // Minimum for speed model
  width: 480,      // Minimum allowed
  height: 480,
  network: 'fast',
  tokenType: 'spark'
}
```

**Quality 10-second test:**
```javascript
{
  modelId: 'wan_v2.2-14b-fp8_t2v',
  frames: 161,     // 10 seconds at 16fps
  fps: 16,
  steps: 25,       // Good quality
  width: 640,
  height: 640,
  network: 'fast',
  tokenType: 'spark'
}
```

## Troubleshooting

### Progress Shows NaN%
This happens when the progress callback doesn't receive valid data. Solutions:
1. Use `npm run test:video:minimal` which doesn't rely on progress
2. Wait - the job is still running even if progress isn't updating
3. Increase timeout to allow more time

### Video Generation Stuck
If the test seems stuck:
1. Video generation can take 1-3 minutes even with fast settings
2. Check your balance - insufficient tokens will cause issues
3. Run `npm run test:check-models` to verify models are available
4. Try `npm run test:video:minimal` for better error messages

### Model Not Found
If the video model is not available, the test will:
1. List all available video models
2. Try to use an alternative if found
3. Show model IDs you can use

### Insufficient Tokens
The test will warn if your balance is low but will still attempt generation.
Check your balance at https://app.sogni.ai

### Timeout Issues
- Fast network: Default 2 minutes timeout
- Relaxed network: Consider 10-20 minutes for video
- Adjust timeout in the config if needed

## Cost Estimates

Based on the SDK's cost estimation:
- **5-second video (speed)**: ~500 Spark tokens
- **5-second video (quality)**: ~1250 Spark tokens (2.5x)
- **10-second video**: Proportionally more

## Notes

- Video generation requires the 'fast' network
- The first frame generation takes the longest
- Progress is shown via ETA and completion percentage
- Videos are saved as MP4 by default