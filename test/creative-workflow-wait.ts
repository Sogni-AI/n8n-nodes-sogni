import {
  CreativeWorkflowWaitClient,
  WorkflowStreamFrame,
  waitForCreativeWorkflow,
} from '../nodes/Sogni/creativeWorkflowWait';

console.log('🧪 Starting creative workflow wait tests...\n');

let testsPassed = 0;
let testsFailed = 0;

async function test(name: string, fn: () => Promise<void>) {
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

async function* frames(list: WorkflowStreamFrame[]) {
  for (const frame of list) yield frame;
}

/** A fake client: each stream call returns the next scripted stream (or throws its error). */
function fakeClient(streams: Array<WorkflowStreamFrame[] | Error>, records: any[]) {
  const calls: string[] = [];
  const streamOptions: any[] = [];
  const client: CreativeWorkflowWaitClient = {
    async getCreativeWorkflow() {
      calls.push('get');
      const next = records.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async streamCreativeWorkflowEvents(_id, options) {
      calls.push('stream');
      streamOptions.push({ lastEventId: options?.lastEventId });
      const next = streams.shift();
      if (!next) return frames([]);
      if (next instanceof Error) throw next;
      return frames(next);
    },
  };
  return { client, calls, streamOptions };
}

const httpError = (status: number, retryAfter?: string) =>
  Object.assign(new Error(`HTTP ${status}`), { status, ...(retryAfter ? { retryAfter } : {}) });

async function main() {
  await test('follows the stream to a terminal event, then reads the workflow once', async () => {
    const { client, calls } = fakeClient(
      [[
        { id: '1', event: 'status', data: { status: 'running' } },
        { id: '2', event: 'status', data: { status: 'completed' } },
      ]],
      [{ status: 'completed', artifacts: [1] }],
    );
    const result = await waitForCreativeWorkflow(client, 'wf', { timeoutMs: 60_000, sleep: async () => {} });
    assertEqual(result.timedOut, false, 'timedOut');
    assertEqual(result.record.status, 'completed', 'status');
    assertEqual(calls, ['stream', 'get'], 'requests');
  });

  await test('a stream closed mid-run resumes after the last event, with no polling in between', async () => {
    const { client, calls, streamOptions } = fakeClient(
      [
        [{ id: '7', event: 'status', data: { status: 'running' } }],
        [{ id: '8', event: 'status', data: { status: 'failed' } }],
      ],
      [{ status: 'running' }, { status: 'failed' }],
    );
    const sleeps: number[] = [];
    const result = await waitForCreativeWorkflow(client, 'wf', {
      timeoutMs: 60_000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    assertEqual(result.record.status, 'failed', 'status');
    assertEqual(calls, ['stream', 'get', 'stream', 'get'], 'requests');
    assertEqual(streamOptions[1], { lastEventId: '7' }, 'resume point');
    assertEqual(sleeps, [], 'a healthy stream reconnects at once');
  });

  await test('stops at waiting_for_user (the node has no Resume operation)', async () => {
    const { client } = fakeClient(
      [[{ id: '1', event: 'status', data: { status: 'waiting_for_user' } }]],
      [{ status: 'waiting_for_user' }],
    );
    const result = await waitForCreativeWorkflow(client, 'wf', { timeoutMs: 60_000, sleep: async () => {} });
    assertEqual(result.record.status, 'waiting_for_user', 'status');
  });

  await test('a 429 waits for Retry-After; empty streams back off 2 s, 4 s', async () => {
    const { client } = fakeClient(
      [httpError(429, '45'), [], [], [{ id: '3', event: 'status', data: { status: 'completed' } }]],
      [{ status: 'running' }, { status: 'running' }, { status: 'running' }, { status: 'completed' }],
    );
    const sleeps: number[] = [];
    const result = await waitForCreativeWorkflow(client, 'wf', {
      timeoutMs: 10 * 60_000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    assertEqual(result.record.status, 'completed', 'status');
    assertEqual(sleeps, [45_000, 2_000, 4_000], 'waits');
  });

  await test('a permanent error (403) is thrown, not retried', async () => {
    const { client, calls } = fakeClient([httpError(403)], []);
    let threw = false;
    try {
      await waitForCreativeWorkflow(client, 'wf', { timeoutMs: 60_000, sleep: async () => {} });
    } catch (error) {
      threw = (error as any).status === 403;
    }
    assertEqual(threw, true, 'threw 403');
    assertEqual(calls, ['stream'], 'requests');
  });

  await test('times out with the latest record when the workflow never finishes', async () => {
    let clock = 0;
    const { client } = fakeClient(
      [[], [], []],
      [{ status: 'running' }, { status: 'running' }, { status: 'running' }],
    );
    const result = await waitForCreativeWorkflow(client, 'wf', {
      timeoutMs: 5_000,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    assertEqual(result.timedOut, true, 'timedOut');
    assertEqual(result.record.status, 'running', 'status');
  });

  console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
}

main();
