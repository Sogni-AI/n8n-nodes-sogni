/**
 * Validation tests for n8n-nodes-sogni
 * These tests validate the node structure and configuration
 */

import { Sogni } from '../nodes/Sogni/Sogni.node';
import { SogniApi } from '../credentials/SogniApi.credentials';

console.log('🧪 Starting n8n-nodes-sogni validation tests...\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      testsPassed++;
    } catch (error) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      testsFailed++;
    }
  };
}

async function runTests() {
  // Test 1: Node class exists
  await test('Should export Sogni node class', () => {
    if (!Sogni) throw new Error('Sogni class not exported');
  })();

  // Test 2: Credential class exists
  await test('Should export SogniApi credential class', () => {
    if (!SogniApi) throw new Error('SogniApi class not exported');
  })();

  // Test 3: Node has description
  await test('Should have node description', () => {
    const node = new Sogni();
    if (!node.description) throw new Error('Node description missing');
  })();

  // Test 4: Node display name
  await test('Should have correct display name', () => {
    const node = new Sogni();
    if (node.description.displayName !== 'Sogni AI') {
      throw new Error(`Expected 'Sogni AI', got '${node.description.displayName}'`);
    }
  })();

  // Test 5: Node name
  await test('Should have correct node name', () => {
    const node = new Sogni();
    if (node.description.name !== 'sogni') {
      throw new Error(`Expected 'sogni', got '${node.description.name}'`);
    }
  })();

  // Test 6: Node has properties
  await test('Should have node properties', () => {
    const node = new Sogni();
    if (!node.description.properties || node.description.properties.length === 0) {
      throw new Error('Node properties missing');
    }
  })();

  // Test 7: Resource property exists
  await test('Should have resource property', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp) throw new Error('Resource property not found');
    if (resourceProp.type !== 'options') {
      throw new Error('Resource should be options type');
    }
  })();

  // Test 8: Operation property exists
  await test('Should have operation property', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    if (operationProps.length === 0) {
      throw new Error('Operation property not found');
    }
  })();

  // Test 9: Credentials configuration
  await test('Should require sogniApi credentials', () => {
    const node = new Sogni();
    if (!node.description.credentials || node.description.credentials.length === 0) {
      throw new Error('Credentials not configured');
    }
    const sogniCred = node.description.credentials.find(c => c.name === 'sogniApi');
    if (!sogniCred) throw new Error('sogniApi credential not found');
    if (!sogniCred.required) throw new Error('Credential should be required');
  })();

  // Test 10: Execute method exists
  await test('Should have execute method', () => {
    const node = new Sogni();
    if (typeof node.execute !== 'function') {
      throw new Error('Execute method not found');
    }
  })();

  // Test 11: Credential properties
  await test('Should have credential properties', () => {
    const cred = new SogniApi();
    if (!cred.properties || cred.properties.length === 0) {
      throw new Error('Credential properties missing');
    }
  })();

  // Test 12: Username credential field
  await test('Should have username credential field', () => {
    const cred = new SogniApi();
    const usernameProp = cred.properties.find(p => p.name === 'username');
    if (!usernameProp) throw new Error('Username property not found');
    if (!usernameProp.required) throw new Error('Username should be required');
  })();

  // Test 13: Password credential field
  await test('Should have password credential field', () => {
    const cred = new SogniApi();
    const passwordProp = cred.properties.find(p => p.name === 'password');
    if (!passwordProp) throw new Error('Password property not found');
    if (!passwordProp.required) throw new Error('Password should be required');
    if (!passwordProp.typeOptions?.password) {
      throw new Error('Password should have password typeOption');
    }
  })();

  // Test 14: AppId credential field
  await test('Should have appId credential field', () => {
    const cred = new SogniApi();
    const appIdProp = cred.properties.find(p => p.name === 'appId');
    if (!appIdProp) throw new Error('AppId property not found');
  })();

  // Test 15: Credential name
  await test('Should have correct credential name', () => {
    const cred = new SogniApi();
    if (cred.name !== 'sogniApi') {
      throw new Error(`Expected 'sogniApi', got '${cred.name}'`);
    }
  })();

  // Test 16: Credential display name
  await test('Should have correct credential display name', () => {
    const cred = new SogniApi();
    if (cred.displayName !== 'Sogni AI API') {
      throw new Error(`Expected 'Sogni AI API', got '${cred.displayName}'`);
    }
  })();

  // Test 17: Node has inputs
  await test('Should have node inputs configured', () => {
    const node = new Sogni();
    if (!node.description.inputs || node.description.inputs.length === 0) {
      throw new Error('Node inputs not configured');
    }
  })();

  // Test 18: Node has outputs
  await test('Should have node outputs configured', () => {
    const node = new Sogni();
    if (!node.description.outputs || node.description.outputs.length === 0) {
      throw new Error('Node outputs not configured');
    }
  })();

  // Test 19: Image resource operations
  await test('Should have image resource with generate operation', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const imageResource = resourceProp.options.find((o: any) => o.value === 'image');
    if (!imageResource) throw new Error('Image resource not found');
  })();

  // Test 20: Model resource operations
  await test('Should have model resource with operations', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const modelResource = resourceProp.options.find((o: any) => o.value === 'model');
    if (!modelResource) throw new Error('Model resource not found');
  })();

  // Test 21: Account resource operations
  await test('Should have account resource with operations', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const accountResource = resourceProp.options.find((o: any) => o.value === 'account');
    if (!accountResource) throw new Error('Account resource not found');
  })();

  // Test 22: Model ID parameter for image generation
  await test('Should have modelId parameter for image generation', () => {
    const node = new Sogni();
    const modelIdProp = node.description.properties.find(
      p => p.name === 'modelId' && p.displayOptions?.show?.resource?.includes('image')
    );
    if (!modelIdProp) throw new Error('ModelId parameter not found for image generation');
    if (!modelIdProp.required) throw new Error('ModelId should be required');
  })();

  // Test 23: Positive prompt parameter
  await test('Should have positivePrompt parameter', () => {
    const node = new Sogni();
    const promptProp = node.description.properties.find(p => p.name === 'positivePrompt');
    if (!promptProp) throw new Error('PositivePrompt parameter not found');
    if (!promptProp.required) throw new Error('PositivePrompt should be required');
  })();

  // Test 24: Additional fields collection
  await test('Should have additionalFields fixedCollection', () => {
    const node = new Sogni();
    const additionalProp = node.description.properties.find(p => p.name === 'additionalFields');
    if (!additionalProp) throw new Error('AdditionalFields not found');
    if (additionalProp.type !== 'fixedCollection') {
      throw new Error('AdditionalFields should be fixedCollection type');
    }
  })();

  // Test 25: Network parameter
  await test('Should have network parameter', () => {
    const node = new Sogni();
    const networkProp = node.description.properties.find(p => p.name === 'network');
    if (!networkProp) throw new Error('Network parameter not found');
    if (networkProp.type !== 'options') {
      throw new Error('Network should be options type');
    }
  })();

  // Test 26: Image Edit operation exists
  await test('Should have edit operation for image resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const imageOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('image')
    );
    if (!imageOperationProp || !imageOperationProp.options) {
      throw new Error('Image operation property not found');
    }
    const editOperation = imageOperationProp.options.find((o: any) => o.value === 'edit');
    if (!editOperation) throw new Error('Edit operation not found for image resource');
  })();

  // Test 27: Image Edit Model ID parameter
  await test('Should have imageEditModelId parameter for image edit', () => {
    const node = new Sogni();
    const modelIdProp = node.description.properties.find(
      p => p.name === 'imageEditModelId' && p.displayOptions?.show?.operation?.includes('edit')
    );
    if (!modelIdProp) throw new Error('imageEditModelId parameter not found for image edit');
    if (!modelIdProp.required) throw new Error('imageEditModelId should be required');
  })();

  // Test 28: Context Image 1 parameter is required
  await test('Should have contextImage1Property parameter for image edit', () => {
    const node = new Sogni();
    const contextProp = node.description.properties.find(
      p => p.name === 'contextImage1Property' && p.displayOptions?.show?.operation?.includes('edit')
    );
    if (!contextProp) throw new Error('contextImage1Property parameter not found for image edit');
    if (!contextProp.required) throw new Error('contextImage1Property should be required');
  })();

  // Test 29: Image Edit Prompt parameter
  await test('Should have imageEditPrompt parameter for image edit', () => {
    const node = new Sogni();
    const promptProp = node.description.properties.find(
      p => p.name === 'imageEditPrompt' && p.displayOptions?.show?.operation?.includes('edit')
    );
    if (!promptProp) throw new Error('imageEditPrompt parameter not found for image edit');
    if (!promptProp.required) throw new Error('imageEditPrompt should be required');
  })();

  // Test 30: Image Edit Additional Fields
  await test('Should have imageEditAdditionalFields collection', () => {
    const node = new Sogni();
    const additionalProp = node.description.properties.find(
      p => p.name === 'imageEditAdditionalFields'
    );
    if (!additionalProp) throw new Error('imageEditAdditionalFields not found');
    if (additionalProp.type !== 'fixedCollection') {
      throw new Error('imageEditAdditionalFields should be fixedCollection type');
    }
  })();

  // Test 31: Video Additional Fields groups for advanced workflows
  await test('Should expose video inputs and workflow controls groups', () => {
    const node = new Sogni();
    const videoAdditional = node.description.properties.find(
      p => p.name === 'videoAdditionalFields'
    );
    if (!videoAdditional || !videoAdditional.options) {
      throw new Error('videoAdditionalFields not found');
    }

    const hasInputs = videoAdditional.options.some((o: any) => o.name === 'inputs');
    const hasWorkflowControls = videoAdditional.options.some(
      (o: any) => o.name === 'workflowControls'
    );

    if (!hasInputs) throw new Error('videoAdditionalFields.inputs group not found');
    if (!hasWorkflowControls) {
      throw new Error('videoAdditionalFields.workflowControls group not found');
    }
  })();

  // Test 32: Video operation includes estimateCost
  await test('Should have estimateCost operation for video resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const videoOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('video')
    );
    if (!videoOperationProp || !videoOperationProp.options) {
      throw new Error('Video operation property not found');
    }
    const estimateCostOperation = videoOperationProp.options.find((o: any) => o.value === 'estimateCost');
    if (!estimateCostOperation) {
      throw new Error('estimateCost operation not found for video resource');
    }
  })();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Tests passed: ${testsPassed}`);
  console.log(`❌ Tests failed: ${testsFailed}`);
  console.log(`📊 Total tests: ${testsPassed + testsFailed}`);
  console.log('='.repeat(50));

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
