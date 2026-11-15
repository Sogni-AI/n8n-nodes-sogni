/**
 * Credential auth tests: API-key option, and saved username/password credentials unchanged.
 *
 * Runs offline. `SogniClient.createInstance` is stubbed so the real SogniClientWrapper
 * connect path runs without touching the network.
 */
import { NodeHelpers, INodeParameters } from 'n8n-workflow';
import { SogniClient } from '@sogni-ai/sogni-client';
import { SogniClientWrapper } from '@sogni-ai/sogni-intelligence-client';
import { SogniApi } from '../credentials/SogniApi.credentials';
import { buildSogniCredentialAuthConfig } from '../nodes/Sogni/sogniCredentialAuth';

console.log('🧪 Starting credential auth tests...\n');

let testsPassed = 0;
let testsFailed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

/** What n8n core does to a stored credential before a node sees it (credentials-helper.ts). */
function applyN8nCredentialDefaults(stored: INodeParameters) {
  return NodeHelpers.getNodeParameters(
    new SogniApi().properties,
    stored,
    true,
    false,
    null,
    null,
  ) as Record<string, unknown>;
}

interface CreateInstanceCall {
  config: Record<string, unknown>;
  logins: unknown[][];
}

/** Run the real wrapper connect() with SogniClient.createInstance stubbed. */
async function connectWithStub(credentials: Record<string, unknown>): Promise<CreateInstanceCall> {
  const call: CreateInstanceCall = { config: {}, logins: [] };
  const original = SogniClient.createInstance;
  (SogniClient as unknown as { createInstance: unknown }).createInstance = async (
    config: Record<string, unknown>,
  ) => {
    call.config = config;
    return {
      account: {
        login: async (...args: unknown[]) => {
          call.logins.push(args);
          return {};
        },
      },
      projects: { waitForModels: async () => [], on: () => undefined },
      chat: { on: () => undefined },
    };
  };
  try {
    const wrapper = new SogniClientWrapper({
      ...buildSogniCredentialAuthConfig(credentials),
      appId: 'n8n-sogni-test',
      appSource: 'n8n-nodes-sogni',
      autoConnect: false,
      reconnect: false,
      debug: false,
    });
    await wrapper.connect();
  } finally {
    (SogniClient as unknown as { createInstance: unknown }).createInstance = original;
  }
  return call;
}

async function runTests() {
  // Saved before the Authentication field existed: no authType, no apiKey.
  const legacyStored: INodeParameters = { username: 'artist', password: 'secret', appId: '' };

  await test('Authentication defaults to username and password', () => {
    const prop = new SogniApi().properties.find((p) => p.name === 'authType');
    if (!prop) throw new Error('authType property not found');
    assertEqual(prop.default, 'usernamePassword', 'authType default');
    const values = ((prop.options as Array<{ value: string }>) || []).map((o) => o.value).sort();
    assertEqual(values, ['apiKey', 'usernamePassword'], 'authType options');
  });

  await test('API key field is a password field shown only for API key auth', () => {
    const prop = new SogniApi().properties.find((p) => p.name === 'apiKey');
    if (!prop) throw new Error('apiKey property not found');
    if (!prop.typeOptions?.password) throw new Error('apiKey should be a password field');
    if (!prop.required) throw new Error('apiKey should be required');
    assertEqual(prop.displayOptions?.show?.authType, ['apiKey'], 'apiKey displayOptions');
  });

  await test('Saved username/password credential keeps its values after n8n fills defaults', () => {
    const filled = applyN8nCredentialDefaults(legacyStored);
    assertEqual(filled.authType, 'usernamePassword', 'authType');
    assertEqual(filled.username, 'artist', 'username');
    assertEqual(filled.password, 'secret', 'password');
    if ('apiKey' in filled) throw new Error('apiKey must not appear for username/password credentials');
  });

  await test('Saved username/password credential builds the same client config as before', () => {
    // Before this change the node passed exactly { username, password }.
    assertEqual(
      buildSogniCredentialAuthConfig(applyN8nCredentialDefaults(legacyStored)),
      { username: 'artist', password: 'secret' },
      'filled legacy config',
    );
    assertEqual(
      buildSogniCredentialAuthConfig(legacyStored),
      { username: 'artist', password: 'secret' },
      'raw legacy config',
    );
  });

  await test('API key credential builds an API-key config without username/password', () => {
    const filled = applyN8nCredentialDefaults({ authType: 'apiKey', apiKey: 'key-123', appId: '' });
    if ('username' in filled || 'password' in filled) {
      throw new Error('username/password must not appear for API key credentials');
    }
    assertEqual(
      buildSogniCredentialAuthConfig(filled),
      { authType: 'apiKey', apiKey: 'key-123' },
      'api key config',
    );
  });

  await test('Username/password credential connects with login(username, password)', async () => {
    const call = await connectWithStub(applyN8nCredentialDefaults(legacyStored));
    assertEqual(call.config.authType, 'token', 'createInstance authType');
    assertEqual(call.config.apiKey, undefined, 'createInstance apiKey');
    assertEqual(call.logins, [['artist', 'secret']], 'login calls');
  });

  await test('API key credential connects with the API key and never calls login', async () => {
    const call = await connectWithStub(
      applyN8nCredentialDefaults({ authType: 'apiKey', apiKey: 'key-123', appId: '' }),
    );
    assertEqual(call.config.authType, 'apiKey', 'createInstance authType');
    assertEqual(call.config.apiKey, 'key-123', 'createInstance apiKey');
    assertEqual(call.logins, [], 'login calls');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`📊 ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(50));
  if (testsFailed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
