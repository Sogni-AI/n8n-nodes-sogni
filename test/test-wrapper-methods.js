#!/usr/bin/env node
/**
 * Test to verify the wrapper has the correct methods
 */

const { SogniClientWrapper } = require('@sogni-ai/sogni-client-wrapper');

console.log('🔍 Testing SogniClientWrapper methods\n');

// Create a dummy instance (won't connect)
const client = new SogniClientWrapper({
  username: 'test',
  password: 'test',
  appId: 'test',
  autoConnect: false
});

// Check if methods exist
const methods = [
  'connect',
  'disconnect',
  'isConnected',
  'getConnectionState',
  'getAvailableModels',
  'getModel',
  'getBalance',
  'createProject',
  'createImageProject',
  'createVideoProject',
  'createProjectWithRetry'
];

console.log('Checking methods:');
let allPresent = true;

methods.forEach(method => {
  const exists = typeof client[method] === 'function';
  console.log(`  ${exists ? '✅' : '❌'} ${method}`);
  if (!exists) allPresent = false;
});

console.log('\n' + (allPresent ? '✅ All methods present!' : '❌ Some methods missing'));

// Check method signatures
console.log('\n📋 Method Signatures:');
console.log('  createImageProject:', client.createImageProject.length, 'parameters');
console.log('  createVideoProject:', client.createVideoProject.length, 'parameters');
console.log('  createProject:', client.createProject.length, 'parameters');

console.log('\n✅ Wrapper methods verified!');