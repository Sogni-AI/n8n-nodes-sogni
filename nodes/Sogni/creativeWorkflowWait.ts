/**
 * Waiting for a creative workflow to finish without polling it.
 *
 * The API streams a workflow's events (server-sent events), so the node follows
 * that stream instead of re-reading the workflow every couple of seconds: one
 * long request instead of up to 240 a minute from the n8n host's IP. When the
 * stream ends (a terminal event, or a proxy closing an idle connection) one read
 * of the workflow decides whether it is done; if not, the stream is resumed
 * after the last event it delivered.
 */

/**
 * Statuses the node stops waiting at. waiting_for_user is included because this
 * node has no Resume operation, so waiting past it would only run out the clock.
 */
export const WORKFLOW_TERMINAL_STATUSES = new Set([
  'completed',
  'partial_failure',
  'failed',
  'cancelled',
  'canceled',
  'waiting_for_user',
]);

export interface WorkflowStreamFrame {
  id?: string;
  event: string;
  data: unknown;
}

export interface CreativeWorkflowWaitClient {
  getCreativeWorkflow(workflowId: string): Promise<any>;
  streamCreativeWorkflowEvents(
    workflowId: string,
    options?: { lastEventId?: string | number; signal?: AbortSignal },
  ): Promise<AsyncIterable<WorkflowStreamFrame>>;
}

export interface CreativeWorkflowWaitOptions {
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const RATE_LIMIT_DEFAULT_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function statusOf(value: unknown): string {
  const status = (value as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'string' ? status : '';
}

/** Milliseconds a 429 asks us to wait (Retry-After seconds), or a default. */
export function retryAfterMs(error: unknown): number {
  const raw = (error as { retryAfter?: unknown } | null | undefined)?.retryAfter;
  const seconds = typeof raw === 'string' ? Number(raw) : raw;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, 10 * 60_000)
    : RATE_LIMIT_DEFAULT_MS;
}

function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** A 4xx other than 408/429 will not get better by asking again. */
function isPermanent(error: unknown): boolean {
  const status = httpStatus(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Follow a workflow's event stream until it reaches a terminal status or the
 * timeout passes. Returns the last workflow record read and whether it timed out.
 */
export async function waitForCreativeWorkflow(
  client: CreativeWorkflowWaitClient,
  workflowId: string,
  { timeoutMs, sleep = defaultSleep, now = Date.now }: CreativeWorkflowWaitOptions,
): Promise<{ record: any; timedOut: boolean }> {
  const deadline = now() + Math.max(1000, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let lastEventId: string | undefined;
  let reconnectMs = RECONNECT_MIN_MS;
  let record: any;
  try {
    for (;;) {
      let waitMs = 0;
      try {
        const stream = await client.streamCreativeWorkflowEvents(workflowId, {
          ...(lastEventId !== undefined ? { lastEventId } : {}),
          signal: controller.signal,
        });
        let delivered = false;
        for await (const frame of stream) {
          delivered = true;
          if (frame.id !== undefined) lastEventId = frame.id;
          if (WORKFLOW_TERMINAL_STATUSES.has(statusOf(frame.data))) break;
        }
        // A stream that delivered events was healthy; one that closed at once is
        // retried with a growing pause rather than in a tight loop.
        if (delivered) reconnectMs = RECONNECT_MIN_MS;
        else {
          waitMs = reconnectMs;
          reconnectMs = Math.min(RECONNECT_MAX_MS, reconnectMs * 2);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          if (isPermanent(error)) throw error;
          if (httpStatus(error) === 429) waitMs = retryAfterMs(error);
          else {
            waitMs = reconnectMs;
            reconnectMs = Math.min(RECONNECT_MAX_MS, reconnectMs * 2);
          }
        }
      }

      record = await readWorkflow(client, workflowId, { deadline, sleep, now });
      if (WORKFLOW_TERMINAL_STATUSES.has(statusOf(record))) return { record, timedOut: false };
      const remaining = deadline - now();
      if (controller.signal.aborted || remaining <= 0) return { record, timedOut: true };
      if (waitMs > 0) await sleep(Math.min(waitMs, remaining));
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** One read of the workflow, waiting out a 429 (Retry-After) while time remains. */
async function readWorkflow(
  client: CreativeWorkflowWaitClient,
  workflowId: string,
  { deadline, sleep, now }: { deadline: number; sleep: (ms: number) => Promise<void>; now: () => number },
): Promise<any> {
  for (;;) {
    try {
      return await client.getCreativeWorkflow(workflowId);
    } catch (error) {
      const remaining = deadline - now();
      if (httpStatus(error) !== 429 || remaining <= 0) throw error;
      await sleep(Math.min(retryAfterMs(error), remaining));
    }
  }
}
