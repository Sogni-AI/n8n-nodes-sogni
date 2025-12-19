# Troubleshooting Guide for n8n-nodes-sogni

## Timeout Errors

### Problem: "Operation timed out after 60000ms"

If you're getting timeout errors when generating images, especially with the message "Operation timed out after 60000ms", this was caused by a bug in the alpha version of the Sogni SDK where `waitForCompletion()` would hang.

### Solution: Update to Latest Version

This issue has been fixed in version 1.2.3 of n8n-nodes-sogni, which uses the fixed sogni-client-wrapper@1.2.1.

```bash
npm install n8n-nodes-sogni@latest
```

### Alternative Solution: Increase n8n Execution Timeout

If you're still experiencing timeouts with complex generations, you may need to increase n8n's execution timeout:

**For Self-Hosted n8n:**

1. Set the environment variable:
   ```bash
   export EXECUTIONS_TIMEOUT=300  # 5 minutes
   ```

2. Or in your `.env` file:
   ```
   EXECUTIONS_TIMEOUT=300
   ```

3. Or in your docker-compose.yml:
   ```yaml
   environment:
     - EXECUTIONS_TIMEOUT=300
   ```

4. Restart n8n after making changes

**For n8n Cloud:**
- Go to Settings → Execution Settings
- Increase the "Max execution time" to at least 300 seconds

### Solution 2: Use Relaxed Network

The relaxed network is more reliable for complex generations:

```json
{
  "parameters": {
    "resource": "image",
    "operation": "generate",
    "modelId": "flux1-schnell-fp8",
    "positivePrompt": "your prompt here",
    "network": "relaxed",
    "additionalFields": {
      "advanced": {
        "timeout": 600000
      }
    }
  }
}
```

### Solution 3: Enable Debug Logging

To see what's happening during the generation:

1. Check n8n logs when running the workflow
2. Look for messages starting with `[Sogni]`
3. The debug output will show connection status and timeout values

### Testing Your Connection

Use the included test script to verify your Sogni connection outside of n8n:

```bash
cd /path/to/n8n-nodes-sogni
npm install
node test/test-connection.js
```

This will help identify if the issue is with:
- Your Sogni credentials
- Network connectivity
- The Sogni service itself
- n8n's execution environment

## Common Issues

### WebSocket Connection Blocked

**Symptoms:**
- Timeout occurs immediately or very quickly
- No progress updates received

**Solutions:**
- Check firewall settings allow WebSocket connections
- Verify proxy settings if behind corporate firewall
- Try using a different network

### Insufficient Balance

**Symptoms:**
- Connection succeeds but generation fails
- Error mentions balance or tokens

**Solutions:**
- Check your balance at https://app.sogni.ai
- Switch to using SPARK tokens (cheaper)
- Reduce number of images or steps

### Model Not Available

**Symptoms:**
- Error mentions model not found
- Works with some models but not others

**Solutions:**
- Use the "Get All Models" operation to list available models
- Check model health and worker count
- Try a different model with more workers

## Performance Tips

1. **Flux models are fast**: flux1-schnell should generate in 5-10 seconds
2. **Use appropriate timeouts**:
   - Fast network + simple prompt: 180000ms (3 minutes)
   - Relaxed network or complex prompt: 600000ms (10 minutes)
3. **Monitor worker counts**: Models with more workers generate faster
4. **Batch wisely**: Process multiple items but don't overload

## Getting Help

If you continue to experience issues:

1. Run the test script and include the output
2. Check n8n logs for error details
3. Report issues at: https://github.com/Sogni-AI/n8n-nodes-sogni/issues

Include:
- n8n version
- Node version (n8n-nodes-sogni version)
- Error message and stack trace
- Workflow JSON (without credentials)