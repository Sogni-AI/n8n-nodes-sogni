#!/usr/bin/env node
/**
 * Quick video generation test - minimal setup
 * Run: node test-video-simple.js
 */

const { SogniClientWrapper } = require('@sogni-ai/sogni-client-wrapper');
require('dotenv').config();

async function quickVideoTest() {
  console.log('🎬 Quick Video Test (5-second video)\n');

  // Check credentials
  if (!process.env.SOGNI_USERNAME || !process.env.SOGNI_PASSWORD) {
    console.error('Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file');
    process.exit(1);
  }

  const client = new SogniClientWrapper({
    username: process.env.SOGNI_USERNAME,
    password: process.env.SOGNI_PASSWORD,
    appId: `quick-video-test-${Date.now()}`,
    autoConnect: true
  });

  try {
    console.log('Connecting...');
    await client.connect();

    console.log('Generating 5-second video...');
    console.log('Note: Video generation may take 1-3 minutes\n');

    let progressShown = false;
    const result = await client.createVideoProject({
      // Try the speed model first
      modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
      positivePrompt: 'A spinning colorful cube, simple animation',
      // 5 seconds = 81 frames at 16fps
      frames: 81,
      fps: 16,
      steps: 4,  // Fastest for speed model
      width: 480,  // Minimum for Wan 2.2
      height: 480,
      numberOfMedia: 1,
      network: 'fast',
      tokenType: 'spark',
      outputFormat: 'mp4',
      waitForCompletion: true,
      timeout: 180000,  // 3 minutes
      onProgress: (p) => {
        if (p && typeof p.percentage === 'number' && !isNaN(p.percentage)) {
          progressShown = true;
          process.stdout.write(`\rProgress: ${p.percentage.toFixed(0)}% - ${p.completedJobs || 0}/${p.totalJobs || 1} jobs`);
        } else if (!progressShown) {
          process.stdout.write(`\rWaiting for job to start...`);
        }
      },
      onJobCompleted: (job) => {
        if (!progressShown) {
          console.log('\nJob completed:', job.id || 'video generation');
        }
      },
      onJobFailed: (job) => {
        console.error('\nJob failed:', job.error || job.message || 'Unknown error');
      }
    });

    console.log('\n\n✅ Video generated!');
    if (result.videoUrls?.[0]) {
      console.log('Video URL:', result.videoUrls[0]);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    // If model not found, list available video models
    if (error.message.includes('model') || error.message.includes('not found')) {
      console.log('\nChecking available video models...');

      const models = await client.getAvailableModels();
      const videoModels = models.filter(m => {
        const name = (m.name || m.id || '').toLowerCase();
        return name.includes('video') || name.includes('t2v') ||
               name.includes('wan') || name.includes('animation');
      });

      if (videoModels.length > 0) {
        console.log('Available video models:');
        videoModels.forEach(m => {
          console.log(`  - ${m.id} (${m.workerCount || 0} workers)`);
        });
        console.log('\nTry again with one of these model IDs');
      } else {
        console.log('No video models currently available');
      }
    }
  } finally {
    await client.disconnect();
  }
}

quickVideoTest();