#!/usr/bin/env node
/**
 * Check available video models
 * Run: node check-video-models.js
 */

const { SogniClientWrapper } = require('@sogni-ai/sogni-client-wrapper');
require('dotenv').config();

async function checkVideoModels() {
  console.log('🔍 Checking Available Video Models\n');

  // Check credentials
  if (!process.env.SOGNI_USERNAME || !process.env.SOGNI_PASSWORD) {
    console.error('❌ Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file');
    process.exit(1);
  }

  const client = new SogniClientWrapper({
    username: process.env.SOGNI_USERNAME,
    password: process.env.SOGNI_PASSWORD,
    appId: `check-models-${Date.now()}`,
    autoConnect: true
  });

  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected ✅\n');

    console.log('Fetching all models...');
    const models = await client.getAvailableModels();
    console.log(`Total models available: ${models.length}\n`);

    // Look for video models
    const videoKeywords = ['video', 'vid', 't2v', 'text2video', 'wan', 'animation', 'motion', 'animate'];

    console.log('Searching for video models...');
    console.log('Keywords:', videoKeywords.join(', '), '\n');

    const videoModels = models.filter(m => {
      const id = (m.id || '').toLowerCase();
      const name = (m.name || '').toLowerCase();

      return videoKeywords.some(keyword =>
        id.includes(keyword) || name.includes(keyword)
      );
    });

    if (videoModels.length > 0) {
      console.log(`✅ Found ${videoModels.length} potential video model(s):\n`);

      // Sort by worker count
      videoModels.sort((a, b) => (b.workerCount || 0) - (a.workerCount || 0));

      videoModels.forEach((model, index) => {
        console.log(`${index + 1}. Model ID: ${model.id}`);
        console.log(`   Name: ${model.name || 'N/A'}`);
        console.log(`   Workers: ${model.workerCount || 0}`);
        console.log(`   Available: ${model.isAvailable ? 'Yes' : 'No'}`);

        if (model.recommendedSettings) {
          console.log('   Recommended Settings:');
          if (model.recommendedSettings.steps) {
            console.log(`     - Steps: ${model.recommendedSettings.steps}`);
          }
          if (model.recommendedSettings.frames) {
            console.log(`     - Frames: ${model.recommendedSettings.frames}`);
          }
          if (model.recommendedSettings.fps) {
            console.log(`     - FPS: ${model.recommendedSettings.fps}`);
          }
        }
        console.log();
      });

      // Check for the specific models we're looking for
      const speedModel = videoModels.find(m => m.id === 'wan_v2.2-14b-fp8_t2v_lightx2v');
      const qualityModel = videoModels.find(m => m.id === 'wan_v2.2-14b-fp8_t2v');

      console.log('📊 Target Models Status:');
      console.log(`   Speed Model (wan_v2.2-14b-fp8_t2v_lightx2v): ${speedModel ? '✅ Available' : '❌ Not found'}`);
      if (speedModel) {
        console.log(`     Workers: ${speedModel.workerCount || 0}`);
      }

      console.log(`   Quality Model (wan_v2.2-14b-fp8_t2v): ${qualityModel ? '✅ Available' : '❌ Not found'}`);
      if (qualityModel) {
        console.log(`     Workers: ${qualityModel.workerCount || 0}`);
      }

      // Suggest best model to use
      if (videoModels.length > 0) {
        const bestModel = videoModels[0];  // Already sorted by worker count
        console.log('\n💡 Recommended model to use:');
        console.log(`   ${bestModel.id} (${bestModel.workerCount || 0} workers)`);
      }

    } else {
      console.log('❌ No video models found\n');
      console.log('This could mean:');
      console.log('  1. Video models are not yet available on the platform');
      console.log('  2. Video models are named differently than expected');
      console.log('  3. You may need different credentials or access level\n');

      // Show first few models as reference
      console.log('First 5 available models (for reference):');
      models.slice(0, 5).forEach(m => {
        console.log(`  - ${m.id} (${m.name || 'N/A'})`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
  } finally {
    console.log('\nDisconnecting...');
    await client.disconnect();
    console.log('Disconnected ✅');
  }
}

checkVideoModels().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});