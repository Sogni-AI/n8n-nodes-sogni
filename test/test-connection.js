#!/usr/bin/env node

const { SogniClientWrapper } = require('@sogni-ai/sogni-client-wrapper');
require('dotenv').config();

async function testConnection() {
  console.log('Testing Sogni connection and image generation...\n');

  const username = process.env.SOGNI_USERNAME;
  const password = process.env.SOGNI_PASSWORD;

  if (!username || !password) {
    console.error('Please set SOGNI_USERNAME and SOGNI_PASSWORD environment variables');
    process.exit(1);
  }

  const client = new SogniClientWrapper({
    username,
    password,
    appId: `test-${Date.now()}`,
    autoConnect: true,
    debug: true,  // Enable debug logging
    timeout: 180000  // 3 minutes default
  });

  try {
    console.log('1. Testing connection...');
    await client.connect();
    console.log('   ✓ Connected successfully\n');

    console.log('2. Getting balance...');
    const balance = await client.getBalance();
    console.log(`   ✓ Balance: ${balance.spark} SPARK, ${balance.sogni} SOGNI\n`);

    console.log('3. Testing image generation with flux1-schnell...');
    console.log('   Using fast network with 3-minute timeout...');

    const startTime = Date.now();

    const result = await client.createImageProject({
      modelId: 'flux1-schnell-fp8',
      positivePrompt: 'A beautiful sunset over mountains, vibrant colors, photorealistic',
      network: 'fast',
      tokenType: 'spark',
      steps: 4,
      guidance: 3.5,
      numberOfImages: 1,
      waitForCompletion: true,
      timeout: 180000,  // 3 minutes
      onProgress: (progress) => {
        console.log(`   Progress: ${progress.percentage}%`);
      }
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`   ✓ Image generated successfully in ${elapsed} seconds`);

    if (result.imageUrls && result.imageUrls.length > 0) {
      console.log(`   Image URL: ${result.imageUrls[0]}`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    if (error.message.includes('timeout')) {
      console.log('\n💡 The operation timed out. Possible causes:');
      console.log('   - Server is under heavy load');
      console.log('   - Network connectivity issues');
      console.log('   - WebSocket connection blocked by firewall');
      console.log('   - Invalid credentials');
    }

    process.exit(1);
  } finally {
    console.log('\n4. Disconnecting...');
    await client.disconnect();
    console.log('   ✓ Disconnected\n');
  }

  console.log('✅ All tests passed!');
}

testConnection().catch(console.error);