#!/usr/bin/env node
/**
 * Minimal video generation test without progress tracking
 * Run: node test-video-minimal.js
 */

const { SogniClientWrapper } = require('@sogni-ai/sogni-client-wrapper');
require('dotenv').config();

async function minimalVideoTest() {
  console.log('🎬 Minimal Video Test\n');

  // Check credentials
  if (!process.env.SOGNI_USERNAME || !process.env.SOGNI_PASSWORD) {
    console.error('❌ Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file');
    process.exit(1);
  }

  const client = new SogniClientWrapper({
    username: process.env.SOGNI_USERNAME,
    password: process.env.SOGNI_PASSWORD,
    appId: `minimal-video-${Date.now()}`,
    autoConnect: true,
    debug: true  // Enable debug logging
  });

  try {
    console.log('1. Connecting to Sogni...');
    await client.connect();
    console.log('   ✅ Connected\n');

    // Check balance first
    console.log('2. Checking balance...');
    try {
      const balance = await client.getBalance();
      console.log(`   Spark: ${balance.spark || 0}`);
      console.log(`   SOGNI: ${balance.sogni || 0}\n`);

      if ((balance.spark || 0) < 100) {
        console.warn('   ⚠️  Low balance warning - may not have enough tokens\n');
      }
    } catch (balanceError) {
      console.log('   Could not check balance:', balanceError.message, '\n');
    }

    // Check if video model exists
    console.log('3. Checking for video models...');
    try {
      const models = await client.getAvailableModels();
      const videoModels = models.filter(m => {
        const id = (m.id || '').toLowerCase();
        const name = (m.name || '').toLowerCase();
        return id.includes('wan') || id.includes('t2v') ||
               name.includes('video') || name.includes('animation');
      });

      if (videoModels.length > 0) {
        console.log(`   Found ${videoModels.length} video model(s):`);
        videoModels.slice(0, 3).forEach(m => {
          console.log(`   - ${m.id} (${m.workerCount || 0} workers)`);
        });
        console.log();
      } else {
        console.log('   ⚠️  No video models found\n');
        console.log('   Attempting with default model anyway...\n');
      }
    } catch (modelError) {
      console.log('   Could not list models:', modelError.message, '\n');
    }

    // Try to generate video with minimal config
    console.log('4. Starting video generation...');
    console.log('   Model: wan_v2.2-14b-fp8_t2v_lightx2v (speed variant)');
    console.log('   Duration: 5 seconds (81 frames at 16fps)');
    console.log('   Resolution: 480x480 (minimum)');
    console.log('   Steps: 4 (fastest)');
    console.log('   This may take 1-3 minutes...\n');

    const startTime = Date.now();

    const config = {
      modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
      positivePrompt: 'A colorful spinning cube',
      negativePrompt: '',
      frames: 81,
      fps: 16,
      steps: 4,
      width: 480,
      height: 480,
      numberOfMedia: 1,
      network: 'fast',
      tokenType: 'spark',
      outputFormat: 'mp4',
      waitForCompletion: true,
      timeout: 240000  // 4 minutes
    };

    console.log('   Submitting job...');
    const result = await client.createVideoProject(config);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Completed in ${elapsed} seconds\n`);

    // Show results
    console.log('5. Results:');
    if (result.videoUrls && result.videoUrls.length > 0) {
      console.log('   ✅ Video URL:', result.videoUrls[0]);
    } else {
      console.log('   ❌ No video URL returned');
    }

    if (result.project) {
      console.log('   Project ID:', result.project.id || 'N/A');
    }

    if (result.completed) {
      console.log('   Status: Completed');
    } else {
      console.log('   Status: Not completed');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message || error);

    // More detailed error info
    if (error.code) {
      console.error('   Code:', error.code);
    }
    if (error.statusCode) {
      console.error('   Status:', error.statusCode);
    }
    if (error.details) {
      console.error('   Details:', JSON.stringify(error.details, null, 2));
    }

    // Try to help with common errors
    if (error.message && error.message.includes('model')) {
      console.log('\n💡 Tip: The video model may not be available. Try:');
      console.log('   1. Check available models with client.getAvailableModels()');
      console.log('   2. Use a different model ID');
      console.log('   3. Try again later when models are available');
    } else if (error.message && error.message.includes('balance')) {
      console.log('\n💡 Tip: You may not have enough tokens.');
      console.log('   Check your balance at https://app.sogni.ai');
    } else if (error.message && error.message.includes('timeout')) {
      console.log('\n💡 Tip: Video generation timed out.');
      console.log('   Try increasing the timeout or using a smaller video');
    }

    process.exit(1);
  } finally {
    console.log('\n6. Disconnecting...');
    try {
      await client.disconnect();
      console.log('   ✅ Disconnected');
    } catch (disconnectError) {
      console.log('   Could not disconnect:', disconnectError.message);
    }
  }
}

// Run the test
minimalVideoTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});