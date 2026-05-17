#!/usr/bin/env node
/**
 * Simple video generation test for sogni-intelligence-client
 * Tests the wrapper's video generation capability with a fast 5-second video
 */

import { SogniClientWrapper } from '@sogni-ai/sogni-intelligence-client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Video generation configuration for fast 5-second test
const VIDEO_CONFIG = {
  // Speed model for fastest generation (LightX2V variant)
  modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  // Simple test prompt
  positivePrompt: 'A colorful spinning cube, smooth rotation, simple animation',
  negativePrompt: 'blurry, static, glitchy',
  // 5 seconds at 16fps = 81 frames (minimum is 17 frames)
  frames: 81,
  fps: 16,
  // Speed variant uses 4-8 steps, 4 is fastest
  steps: 4,
  // Minimum resolution for Wan 2.2 models
  width: 480,
  height: 480,
  // Use single video for speed
  numberOfMedia: 1,
  // Use fast network
  network: 'fast' as const,
  // Use cheaper tokens
  tokenType: 'spark' as const,
  // MP4 format
  outputFormat: 'mp4' as const,
  // 2 minute timeout for fast network
  timeout: 120000,
  // Wait for completion
  waitForCompletion: true,
  // Fixed seed for reproducibility
  seed: 12345
};

async function testVideoGeneration() {
  console.log('🎬 Sogni Video Generation Test');
  console.log('================================\n');

  // Get credentials from environment
  const username = process.env.SOGNI_USERNAME;
  const password = process.env.SOGNI_PASSWORD;

  if (!username || !password) {
    console.error('❌ Error: SOGNI_USERNAME and SOGNI_PASSWORD must be set in environment');
    console.error('   Create a .env file with your credentials:');
    console.error('   SOGNI_USERNAME=your_username');
    console.error('   SOGNI_PASSWORD=your_password');
    process.exit(1);
  }

  // Create output directory
  const outputDir = './test-videos';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Initialize client
  const client = new SogniClientWrapper({
    username,
    password,
    appId: `video-test-${Date.now()}`,
    network: 'fast',
    autoConnect: true,
    debug: false,
    timeout: VIDEO_CONFIG.timeout
  });

  try {
    console.log('🔌 Connecting to Sogni...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Check balance
    console.log('💰 Checking balance...');
    const balance = await client.getBalance();
    console.log(`   Spark tokens: ${balance.spark}`);
    console.log(`   SOGNI tokens: ${balance.sogni}\n`);

    // Check if we have enough tokens (rough estimate: ~500 spark for a 5s video)
    if (balance.spark < 500) {
      console.warn('⚠️  Warning: Low Spark balance. Video generation might fail.');
      console.warn('   Estimated cost: ~500 Spark tokens for a 5-second video\n');
    }

    // Get available models to verify video model exists
    console.log('🔍 Checking for video model availability...');
    const models = await client.getAvailableModels({
      minWorkers: 0
    });

    // Look for the speed model
    const videoModel = models.find(m => m.id === VIDEO_CONFIG.modelId);

    if (!videoModel) {
      console.error(`❌ Video model "${VIDEO_CONFIG.modelId}" not found`);
      console.log('\n📋 Available video models:');

      const videoModels = models.filter(m => {
        const name = (m.name || m.id || '').toLowerCase();
        return name.includes('video') ||
               name.includes('t2v') ||
               name.includes('wan') ||
               name.includes('animation');
      });

      if (videoModels.length > 0) {
        videoModels.forEach(m => {
          console.log(`   - ${m.id} (${m.workerCount || 0} workers)`);
        });

        // Try to use the first available video model
        if (videoModels[0]) {
          VIDEO_CONFIG.modelId = videoModels[0].id;
          console.log(`\n🔄 Using alternative model: ${VIDEO_CONFIG.modelId}`);
        } else {
          throw new Error('No video models available');
        }
      } else {
        console.log('   No video models found. Video generation might not be available yet.');
        throw new Error('No video models available');
      }
    } else {
      console.log(`✅ Video model available: ${videoModel.name || videoModel.id}`);
      console.log(`   Workers: ${videoModel.workerCount || 0}\n`);
    }

    // Display test configuration
    console.log('📹 Video Configuration:');
    console.log(`   Model: ${VIDEO_CONFIG.modelId}`);
    console.log(`   Resolution: ${VIDEO_CONFIG.width}x${VIDEO_CONFIG.height}`);
    console.log(`   Duration: 5 seconds (${VIDEO_CONFIG.frames} frames at ${VIDEO_CONFIG.fps} fps)`);
    console.log(`   Steps: ${VIDEO_CONFIG.steps} (speed mode)`);
    console.log(`   Network: ${VIDEO_CONFIG.network}`);
    console.log(`   Token type: ${VIDEO_CONFIG.tokenType}\n`);

    console.log('📝 Prompt:');
    console.log(`   "${VIDEO_CONFIG.positivePrompt}"\n`);

    // Generate video
    console.log('🚀 Starting video generation...');
    console.log('⏳ This may take 1-3 minutes...\n');

    const startTime = Date.now();
    let lastProgress = 0;

    const result = await client.createVideoProject({
      ...VIDEO_CONFIG,
      onProgress: (progress) => {
        if (progress.percentage > lastProgress + 10) {
          lastProgress = progress.percentage;
          console.log(`   Progress: ${progress.percentage}% - ${progress.completedJobs}/${progress.totalJobs} jobs`);
        }
      },
      onJobCompleted: (job) => {
        console.log(`   ✅ Job completed: ${job.id}`);
      },
      onJobFailed: (job) => {
        console.log(`   ❌ Job failed: ${job.id} - ${job.error || 'Unknown error'}`);
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Video generation completed in ${elapsed} seconds`);

    // Check results
    if (result.videoUrls && result.videoUrls.length > 0) {
      console.log('\n📹 Generated video:');
      console.log(`   URL: ${result.videoUrls[0]}`);
      console.log(`   Project ID: ${result.project?.id || 'N/A'}`);

      // Download video
      console.log('\n📥 Downloading video...');
      const videoUrl = result.videoUrls[0];
      const response = await fetch(videoUrl);

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const filename = `test_video_${Date.now()}.mp4`;
        const filepath = path.join(outputDir, filename);

        fs.writeFileSync(filepath, Buffer.from(buffer));
        console.log(`✅ Video saved to: ${filepath}`);
        console.log(`   Size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
      } else {
        console.error('❌ Failed to download video:', response.statusText);
      }
    } else {
      console.error('❌ No video URLs in result');
      console.log('   Result:', JSON.stringify(result, null, 2));
    }

    // Show metadata if available
    if (result.project) {
      console.log('\n📊 Generation metadata:');
      const project = result.project as any;
      if (project.cost || project.costInSpark || project.costInUSD) {
        console.log(`   Cost: ${project.costInSpark || project.cost || 'N/A'} Spark`);
      }
      if (project.worker || project.workerId) {
        console.log(`   Worker: ${project.workerName || project.workerId || 'N/A'}`);
      }
      if (project.queuePosition !== undefined) {
        console.log(`   Queue position: ${project.queuePosition}`);
      }
    }

    console.log('\n🎉 Video generation test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      if ((error as any).code) {
        console.error('   Code:', (error as any).code);
      }
      if ((error as any).statusCode) {
        console.error('   Status:', (error as any).statusCode);
      }
    }
    process.exit(1);
  } finally {
    console.log('\n🔌 Disconnecting...');
    await client.disconnect();
    console.log('👋 Disconnected');
  }
}

// Run test
testVideoGeneration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });