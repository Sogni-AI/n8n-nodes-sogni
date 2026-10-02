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

  // Test 21b: LLM resource operations
  await test('Should have llm resource with operations', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const llmResource = resourceProp.options.find((o: any) => o.value === 'llm');
    if (!llmResource) throw new Error('LLM resource not found');
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

  // Test 33: LLM operation includes generate
  await test('Should have generate operation for llm resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const llmOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('llm')
    );
    if (!llmOperationProp || !llmOperationProp.options) {
      throw new Error('LLM operation property not found');
    }
    const generateOperation = llmOperationProp.options.find((o: any) => o.value === 'generate');
    if (!generateOperation) {
      throw new Error('generate operation not found for llm resource');
    }
  })();

  // Test 34: LLM Model ID parameter
  await test('Should have llmModelId parameter for llm generate', () => {
    const node = new Sogni();
    const modelIdProp = node.description.properties.find(
      p => p.name === 'llmModelId' && p.displayOptions?.show?.resource?.includes('llm')
    );
    if (!modelIdProp) throw new Error('llmModelId parameter not found for llm generation');
    if (!modelIdProp.required) throw new Error('llmModelId should be required');
  })();

  // Test 35: LLM prompt parameter
  await test('Should have llmPrompt parameter for llm generate', () => {
    const node = new Sogni();
    const promptProp = node.description.properties.find(
      p => p.name === 'llmPrompt' && p.displayOptions?.show?.resource?.includes('llm')
    );
    if (!promptProp) throw new Error('llmPrompt parameter not found for llm generation');
    if (!promptProp.required) throw new Error('llmPrompt should be required');
  })();

  // Test 36: Audio resource exists
  await test('Should have audio resource', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const audioResource = resourceProp.options.find((o: any) => o.value === 'audio');
    if (!audioResource) throw new Error('Audio resource not found');
  })();

  // Test 37: Audio operation block exposes generate and estimateCost
  await test('Should have generate + estimateCost operations for audio resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const audioOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('audio')
    );
    if (!audioOperationProp || !audioOperationProp.options) {
      throw new Error('Audio operation property not found');
    }
    const generateOp = audioOperationProp.options.find((o: any) => o.value === 'generate');
    if (!generateOp) throw new Error('generate operation not found for audio resource');
    const estimateCostOp = audioOperationProp.options.find((o: any) => o.value === 'estimateCost');
    if (!estimateCostOp) throw new Error('estimateCost operation not found for audio resource');
  })();

  // Test 38: Audio model picker
  await test('Should have audioModelId parameter for audio generate', () => {
    const node = new Sogni();
    const modelIdProp = node.description.properties.find(
      p => p.name === 'audioModelId' && p.displayOptions?.show?.resource?.includes('audio')
    );
    if (!modelIdProp) throw new Error('audioModelId parameter not found for audio resource');
    if (!modelIdProp.required) throw new Error('audioModelId should be required');
    const loadOptionsMethod = (modelIdProp as any).typeOptions?.loadOptionsMethod;
    if (loadOptionsMethod !== 'getAudioModelOptions') {
      throw new Error(
        `audioModelId should use getAudioModelOptions loadOptions, got ${loadOptionsMethod}`
      );
    }
    if (modelIdProp.default !== 'minimax_music3') {
      throw new Error(
        `audioModelId should default to MiniMax Music 3 (minimax_music3), got ${String(modelIdProp.default)}`
      );
    }
  })();

  // Test 39: Audio positive prompt
  await test('Should have audioPositivePrompt parameter for audio generate', () => {
    const node = new Sogni();
    const promptProp = node.description.properties.find(
      p =>
        p.name === 'audioPositivePrompt' &&
        p.displayOptions?.show?.operation?.includes('generate'),
    );
    if (!promptProp) throw new Error('audioPositivePrompt parameter not found');
    if (!promptProp.required) throw new Error('audioPositivePrompt should be required');
  })();

  // Test 40: Audio duration top-level parameter
  await test('Should have audioDuration parameter for audio generate', () => {
    const node = new Sogni();
    const durationProp = node.description.properties.find(
      p =>
        p.name === 'audioDuration' &&
        p.displayOptions?.show?.operation?.includes('generate'),
    );
    if (!durationProp) throw new Error('audioDuration parameter not found');
    if (durationProp.type !== 'number') throw new Error('audioDuration should be a number');
  })();

  // Test 41: Audio estimate-cost params
  await test('Should have audio estimateCost params (duration, steps, numberOfMedia, tokenType)', () => {
    const node = new Sogni();
    const wanted = [
      'audioEstimateDuration',
      'audioEstimateSteps',
      'audioEstimateNumberOfMedia',
      'audioEstimateTokenType',
    ];
    for (const name of wanted) {
      const prop = node.description.properties.find(
        p => p.name === name && p.displayOptions?.show?.operation?.includes('estimateCost'),
      );
      if (!prop) throw new Error(`${name} parameter not found for audio estimateCost`);
    }
  })();

  // Test 42: Audio additional fields collection exposes the expected groups
  await test('Should expose musicAndLyrics, generationSettings, output, advanced groups in audioAdditionalFields', () => {
    const node = new Sogni();
    const audioAdditional = node.description.properties.find(
      p => p.name === 'audioAdditionalFields',
    );
    if (!audioAdditional || !(audioAdditional as any).options) {
      throw new Error('audioAdditionalFields not found');
    }
    const groupNames = ((audioAdditional as any).options as any[]).map(g => g.name);
    for (const expected of ['musicAndLyrics', 'generationSettings', 'output', 'advanced']) {
      if (!groupNames.includes(expected)) {
        throw new Error(`audioAdditionalFields missing group: ${expected}`);
      }
    }
  })();

  // Test 43: Hosted-tools toggle exists on LLM additional fields
  await test('Should have useSogniHostedTools toggle in llmAdditionalFields', () => {
    const node = new Sogni();
    const llmAdditional = node.description.properties.find(
      p => p.name === 'llmAdditionalFields',
    );
    if (!llmAdditional || !(llmAdditional as any).options) {
      throw new Error('llmAdditionalFields not found');
    }
    const toggle = ((llmAdditional as any).options as any[]).find(
      (o: any) => o.name === 'useSogniHostedTools',
    );
    if (!toggle) throw new Error('useSogniHostedTools toggle not found');
    if (toggle.type !== 'boolean') throw new Error('useSogniHostedTools should be a boolean');
    if (toggle.default !== false) {
      throw new Error('useSogniHostedTools should default to false to avoid surprise tool injection');
    }
  })();

  // Test 44: Audio loadOptions method registered
  await test('Should expose getAudioModelOptions loadOptions method', () => {
    const node = new Sogni();
    const loadOptions = (node as any).methods?.loadOptions;
    if (!loadOptions || typeof loadOptions.getAudioModelOptions !== 'function') {
      throw new Error('getAudioModelOptions loadOptions method not registered');
    }
  })();

  // Test 45: Creative Workflow resource exists
  await test('Should have creativeWorkflow resource', () => {
    const node = new Sogni();
    const resourceProp = node.description.properties.find(p => p.name === 'resource');
    if (!resourceProp || !resourceProp.options) {
      throw new Error('Resource options not found');
    }
    const cwResource = resourceProp.options.find((o: any) => o.value === 'creativeWorkflow');
    if (!cwResource) throw new Error('creativeWorkflow resource not found');
  })();

  // Test 46: Creative Workflow operations cover start/get/list/events/cancel
  await test('Should expose start/get/list/events/cancel operations for creativeWorkflow', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const cwOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('creativeWorkflow'),
    );
    if (!cwOperationProp || !cwOperationProp.options) {
      throw new Error('creativeWorkflow operation property not found');
    }
    const values = (cwOperationProp.options as any[]).map(o => o.value);
    for (const expected of ['start', 'get', 'list', 'events', 'cancel']) {
      if (!values.includes(expected)) {
        throw new Error(`creativeWorkflow missing operation: ${expected}`);
      }
    }
  })();

  // Test 47: Start mode toggle exists with template + inline values
  await test('Should expose cwStartMode with template and inline values', () => {
    const node = new Sogni();
    const startModeProp = node.description.properties.find(
      p => p.name === 'cwStartMode' && p.displayOptions?.show?.operation?.includes('start'),
    );
    if (!startModeProp) throw new Error('cwStartMode not found');
    if (startModeProp.type !== 'options') throw new Error('cwStartMode should be options type');
    const values = ((startModeProp as any).options as any[]).map(o => o.value);
    if (!values.includes('template') || !values.includes('inline')) {
      throw new Error('cwStartMode should expose template and inline values');
    }
  })();

  // Test 48: Template ID is required when mode is template
  await test('Should require cwTemplateId when cwStartMode = template', () => {
    const node = new Sogni();
    const tpl = node.description.properties.find(
      p =>
        p.name === 'cwTemplateId' &&
        (p.displayOptions?.show as any)?.cwStartMode?.includes('template'),
    );
    if (!tpl) throw new Error('cwTemplateId not found with template mode display option');
    if (!tpl.required) throw new Error('cwTemplateId should be required');
  })();

  // Test 49: Inline workflow JSON required when mode is inline
  await test('Should require cwInputJson when cwStartMode = inline', () => {
    const node = new Sogni();
    const inline = node.description.properties.find(
      p =>
        p.name === 'cwInputJson' &&
        (p.displayOptions?.show as any)?.cwStartMode?.includes('inline'),
    );
    if (!inline) throw new Error('cwInputJson not found with inline mode display option');
    if (!inline.required) throw new Error('cwInputJson should be required');
  })();

  // Test 50: Wait toggle defaults to false (so existing workflows don't suddenly block)
  await test('Should expose cwWait toggle defaulting to false', () => {
    const node = new Sogni();
    const wait = node.description.properties.find(
      p => p.name === 'cwWait' && p.displayOptions?.show?.operation?.includes('start'),
    );
    if (!wait) throw new Error('cwWait toggle not found');
    if (wait.type !== 'boolean') throw new Error('cwWait should be boolean');
    if (wait.default !== false) {
      throw new Error('cwWait should default to false to avoid blocking by default');
    }
  })();

  // Test 51: Workflow ID required for get/events/cancel
  await test('Should require cwWorkflowId for get/events/cancel operations', () => {
    const node = new Sogni();
    const idProp = node.description.properties.find(
      p =>
        p.name === 'cwWorkflowId' &&
        ['get', 'events', 'cancel'].every(op =>
          p.displayOptions?.show?.operation?.includes(op),
        ),
    );
    if (!idProp) {
      throw new Error('cwWorkflowId not found shared across get/events/cancel');
    }
    if (!idProp.required) throw new Error('cwWorkflowId should be required');
  })();

  // Test 52: List operation exposes limit + offset
  await test('Should expose cwListLimit and cwListOffset for list operation', () => {
    const node = new Sogni();
    for (const name of ['cwListLimit', 'cwListOffset']) {
      const prop = node.description.properties.find(
        p => p.name === name && p.displayOptions?.show?.operation?.includes('list'),
      );
      if (!prop) throw new Error(`${name} not found for list operation`);
      if (prop.type !== 'number') throw new Error(`${name} should be number`);
    }
  })();

  // Test 53: LLM Estimate Cost operation exists
  await test('Should expose estimateCost operation for llm resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const llmOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('llm'),
    );
    if (!llmOperationProp || !llmOperationProp.options) {
      throw new Error('LLM operation property not found');
    }
    const estimateOp = (llmOperationProp.options as any[]).find(o => o.value === 'estimateCost');
    if (!estimateOp) throw new Error('estimateCost operation not found for llm resource');
  })();

  // Test 54: LLM shared fields visible for both generate and estimateCost
  await test('Should show llmModelId/llmPrompt for both generate and estimateCost', () => {
    const node = new Sogni();
    for (const name of ['llmModelId', 'llmPrompt']) {
      const prop = node.description.properties.find(p => p.name === name);
      if (!prop) throw new Error(`${name} not found`);
      const ops = prop.displayOptions?.show?.operation;
      if (!ops || !ops.includes('generate') || !ops.includes('estimateCost')) {
        throw new Error(`${name} should be visible for generate and estimateCost`);
      }
    }
  })();

  // Test 55: Top-level imageSizePreset uses getImageSizePresets loadOptions
  await test('Should expose imageSizePreset with getImageSizePresets loadOptions', () => {
    const node = new Sogni();
    const prop = node.description.properties.find(
      p => p.name === 'imageSizePreset' && p.displayOptions?.show?.resource?.includes('image'),
    );
    if (!prop) throw new Error('imageSizePreset not found');
    const lo = (prop as any).typeOptions?.loadOptionsMethod;
    if (lo !== 'getImageSizePresets') {
      throw new Error(`imageSizePreset should use getImageSizePresets, got ${lo}`);
    }
    const deps = (prop as any).typeOptions?.loadOptionsDependsOn ?? [];
    for (const dep of ['modelId', 'network']) {
      if (!deps.includes(dep)) {
        throw new Error(`imageSizePreset loadOptionsDependsOn should include ${dep}`);
      }
    }
  })();

  // Test 56: getImageSizePresets loadOptions method registered
  await test('Should register getImageSizePresets loadOptions method', () => {
    const node = new Sogni();
    const loadOptions = (node as any).methods?.loadOptions;
    if (!loadOptions || typeof loadOptions.getImageSizePresets !== 'function') {
      throw new Error('getImageSizePresets loadOptions method not registered');
    }
  })();

  // Test 57: Model resource exposes getPopular operation
  await test('Should expose getPopular operation for model resource', () => {
    const node = new Sogni();
    const operationProps = node.description.properties.filter(p => p.name === 'operation');
    const modelOperationProp = operationProps.find(p =>
      p.displayOptions?.show?.resource?.includes('model'),
    );
    if (!modelOperationProp || !modelOperationProp.options) {
      throw new Error('Model operation property not found');
    }
    const popularOp = (modelOperationProp.options as any[]).find(o => o.value === 'getPopular');
    if (!popularOp) throw new Error('getPopular operation not found for model resource');
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
