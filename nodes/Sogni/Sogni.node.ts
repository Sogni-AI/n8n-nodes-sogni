import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
  ILoadOptionsFunctions,
  INodePropertyOptions,
} from 'n8n-workflow';

import { randomUUID } from 'crypto';

import {
  SogniClientWrapper,
  ControlNetName,
  VideoControlNetName,
} from '@sogni-ai/sogni-intelligence-client';
import { SOGNI_HOSTED_TOOLS_MANIFEST } from '@sogni-ai/sogni-intelligence-client/openai-tools';
import {
  isVideoModelCandidate,
  normalizeRequestedVideoFrames,
} from './videoModelUtils';
import { waitForCreativeWorkflow } from './creativeWorkflowWait';

/**
 * Enable optional AppId debug logging by setting:
 *
 *   SOGNI_N8N_DEBUG_APPID=true
 *
 * Examples:
 *   docker-compose.yml:
 *     environment:
 *       - SOGNI_N8N_DEBUG_APPID=true
 *
 *   shell:
 *     export SOGNI_N8N_DEBUG_APPID=true
 */
function isAppIdDebugEnabled(): boolean {
  const raw = (process.env.SOGNI_N8N_DEBUG_APPID || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function debugLogAppId(message: string): void {
  if (!isAppIdDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[Sogni] ${message}`);
}

const CHAT_MODEL_LOAD_OPTIONS_TIMEOUT_MS = 30000;
const CHAT_MODEL_EXECUTION_TIMEOUT_MS = 45000;
const SOGNI_N8N_APP_SOURCE = 'n8n-nodes-sogni';

type HostedToolManifestEntry = {
  function?: {
    name?: unknown;
  };
};

function getHostedTools(): HostedToolManifestEntry[] {
  const manifest = SOGNI_HOSTED_TOOLS_MANIFEST as { tools?: unknown };
  return Array.isArray(manifest.tools)
    ? (manifest.tools as HostedToolManifestEntry[])
    : [];
}

const SOGNI_HOSTED_TOOL_NAMES = getHostedTools()
  .map((tool) => tool.function?.name)
  .filter((name): name is string => typeof name === 'string' && name.length > 0);

/**
 * Promise helper: ensures we don't hang forever during disconnect/cleanup.
 */
async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Best-effort disconnect that guarantees we don't leak WebSocket connections.
 *
 * Why:
 * - In n8n, nodes can run many times in the same process (worker/main).
 * - If a websocket isn't closed in every run (including error paths),
 *   connections accumulate and can eventually degrade/kill the worker.
 */
async function safeDisconnect(
  client: any,
  context: { label: string; appId?: string; timeoutMs?: number },
): Promise<void> {
  if (!client) return;

  const label = context.label;
  const appId = context.appId;
  const timeoutMs = typeof context.timeoutMs === 'number' && context.timeoutMs > 0 ? context.timeoutMs : 5000;
  const tag = `${label}${appId ? ` appId=${appId}` : ''}`;

  // 1) Try wrapper disconnect (graceful) but do not allow it to hang forever.
  try {
    if (typeof client.disconnect === 'function') {
      debugLogAppId(`disconnect:start (${tag})`);
      await promiseWithTimeout(Promise.resolve(client.disconnect()), timeoutMs, `disconnect (${tag})`);
      debugLogAppId(`disconnect:done (${tag})`);
    }
  } catch (err) {
    debugLogAppId(
      `disconnect:error (${tag}) ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2) Hard-close underlying socket if the wrapper didn't (or if it left it half-open).
  // We don't depend on any one field name — we probe common ones.
  try {
    const ws =
      client.socket ??
      client.ws ??
      client.websocket ??
      client._socket ??
      client._ws ??
      client._websocket ??
      client.client?.socket ??
      client.client?.ws ??
      client.client?.websocket;

    if (!ws) return;

    // Some implementations expose readyState (0 connecting, 1 open, 2 closing, 3 closed)
    const readyState: number | undefined = typeof ws.readyState === 'number' ? ws.readyState : undefined;
    const isClosed = readyState === 3;

    if (!isClosed) {
      try {
        if (typeof ws.close === 'function') {
          // Try graceful close first
          ws.close();
        }
      } catch {
        // ignore
      }

      try {
        // If ws is from the `ws` package, terminate is the most reliable "hard stop"
        if (typeof ws.terminate === 'function') {
          ws.terminate();
        }
      } catch {
        // ignore
      }
    }

    // Prevent listener accumulation if anything holds references
    try {
      if (typeof ws.removeAllListeners === 'function') {
        ws.removeAllListeners();
      }
    } catch {
      // ignore
    }

    debugLogAppId(`disconnect:hard-close attempted (${tag})`);
  } catch (err) {
    debugLogAppId(
      `disconnect:hard-close error (${tag}) ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Normalize user-provided appId (credentials field).
 * Treat empty/whitespace as "unset".
 */
function normalizeAppId(appId?: string): string | undefined {
  if (typeof appId !== 'string') return undefined;
  const trimmed = appId.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Generate a unique appId for a single client instance.
 *
 * IMPORTANT:
 * Sogni allows only ONE active WebSocket connection per appId. Re-using the same appId across
 * concurrent n8n executions or editor loadOptions calls can silently close the "other" socket,
 * resulting in missing jobState/jobProgress/jobResult events.
 *
 * Strategy used here:
 * - execute(): generate ONE appId per node execution (unless the user explicitly provided one)
 * - loadOptions(): ALWAYS use a dedicated random appId so the editor UI cannot interfere with executions
 */
function generateUniqueAppId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function createSogniClient(
  credentials: { username?: unknown; password?: unknown },
  appId: string,
): SogniClientWrapper {
  return new SogniClientWrapper({
    username: credentials.username as string,
    password: credentials.password as string,
    appId,
    appSource: SOGNI_N8N_APP_SOURCE,
    autoConnect: true,
    debug: false,
  });
}

/**
 * Simple MIME sniff for common image types (fallback when server doesn't send content-type)
 */
function sniffMimeType(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 4) return undefined;

  // JPEG (at least 3 bytes needed, already ensured by <4 guard)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG (must have at least 8 bytes for the full signature)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF (needs first 6 bytes)
  if (buffer.length >= 6) {
    const sig = buffer.slice(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }

  return undefined;
}

function extensionFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

function parseContentDispositionFilename(header?: string): string | undefined {
  if (!header) return undefined;
  // Try RFC 5987 then basic filename=
  const starMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) return decodeURIComponent(starMatch[1]);
  const basicMatch = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i);
  if (basicMatch?.[1]) return basicMatch[1].replace(/["]/g, '').trim();
  return undefined;
}

function parseJsonParameter<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON: ${message}`);
  }
}

export class Sogni implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sogni AI',
    name: 'sogni',
    icon: 'file:sogni.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Generate AI images, videos, and LLM responses using Sogni AI Supernet',
    defaults: {
      name: 'Sogni AI',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'sogniApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Image', value: 'image' },
          { name: 'Video', value: 'video' },
          { name: 'Audio', value: 'audio' },
          { name: 'LLM', value: 'llm' },
          { name: 'Creative Workflow', value: 'creativeWorkflow' },
          { name: 'Model', value: 'model' },
          { name: 'Account', value: 'account' },
        ],
        default: 'image',
      },

      // Image Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['image'] },
        },
        options: [
          {
            name: 'Generate',
            value: 'generate',
            description: 'Generate AI images',
            action: 'Generate Sogni image',
          },
          {
            name: 'Edit',
            value: 'edit',
            description: 'Edit images using Qwen Image Edit models with context images',
            action: 'Edit image with Qwen',
          },
        ],
        default: 'generate',
      },

      // LLM Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['llm'] },
        },
        options: [
          {
            name: 'Generate',
            value: 'generate',
            description: 'Generate a text response with a Sogni LLM model',
            action: 'Generate LLM response',
          },
          {
            name: 'Estimate Cost',
            value: 'estimateCost',
            description: 'Estimate token and USD cost for a chat completion request',
            action: 'Estimate LLM cost',
          },
          {
            name: 'Get All',
            value: 'getAll',
            description: 'Get all available Sogni LLM models',
            action: 'Get all LLM models',
          },
        ],
        default: 'generate',
      },

      // Video Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['video'] },
        },
        options: [
          {
            name: 'Generate',
            value: 'generate',
            description: 'Generate AI videos',
            action: 'Generate Sogni video',
          },
          {
            name: 'Estimate Cost',
            value: 'estimateCost',
            description: 'Estimate token and USD cost for a video request',
            action: 'Estimate video cost',
          },
        ],
        default: 'generate',
      },

      // Model Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['model'] },
        },
        options: [
          {
            name: 'Get All',
            value: 'getAll',
            description: 'Get all available models',
            action: 'Get all models',
          },
          {
            name: 'Get',
            value: 'get',
            description: 'Get a specific model',
            action: 'Get a model',
          },
          {
            name: 'Get Most Popular',
            value: 'getPopular',
            description: 'Get the model with the most active workers (fastest pickup)',
            action: 'Get most popular model',
          },
        ],
        default: 'getAll',
      },

      // Account Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['account'] } },
        options: [
          {
            name: 'Get Balance',
            value: 'getBalance',
            description: 'Get account token balance',
            action: 'Get account balance',
          },
        ],
        default: 'getBalance',
      },

      // Audio Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['audio'] },
        },
        options: [
          {
            name: 'Generate',
            value: 'generate',
            description: 'Generate AI music or audio (e.g., ACE-Step)',
            action: 'Generate Sogni audio',
          },
          {
            name: 'Estimate Cost',
            value: 'estimateCost',
            description: 'Estimate token and USD cost for an audio request',
            action: 'Estimate audio cost',
          },
        ],
        default: 'generate',
      },

      // Creative Workflow Operations
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['creativeWorkflow'] },
        },
        options: [
          {
            name: 'Start',
            value: 'start',
            description: 'Start a hosted creative workflow from a saved template or an inline plan',
            action: 'Start a creative workflow',
          },
          {
            name: 'Get',
            value: 'get',
            description: 'Get a workflow record by ID',
            action: 'Get a creative workflow',
          },
          {
            name: 'List',
            value: 'list',
            description: 'List creative workflows',
            action: 'List creative workflows',
          },
          {
            name: 'Get Events',
            value: 'events',
            description: 'Get the event history for a workflow',
            action: 'Get creative workflow events',
          },
          {
            name: 'Cancel',
            value: 'cancel',
            description: 'Cancel an in-flight workflow',
            action: 'Cancel a creative workflow',
          },
        ],
        default: 'start',
      },

      // ===== Image Generation Parameters =====

      // Model picker with search (loadOptions) - Image
      {
        displayName: 'Model Search',
        name: 'modelSearch',
        type: 'string',
        placeholder: 'e.g., flux, sd, anime, portrait',
        default: '',
        description:
          'Type to filter models by name/tag. The dropdown below refreshes when you edit this field.',
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
      },
      {
        displayName: 'Model',
        name: 'modelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getModelOptions',
          loadOptionsDependsOn: ['modelSearch'],
        },
        default: 'flux1-schnell-fp8',
        description:
          'Choose a model from the list (recommended), or paste a known model ID into this field.',
      },

      {
        displayName: 'Positive Prompt',
        name: 'positivePrompt',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
        default: '',
        typeOptions: { rows: 4 },
        description: 'Text description of what you want to generate',
        placeholder: 'A beautiful sunset over mountains, vibrant colors, photorealistic',
      },
      {
        displayName: 'Network',
        name: 'network',
        type: 'options',
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
        options: [
          {
            name: 'Fast',
            value: 'fast',
            description: 'Faster generation, uses SOGNI/Spark tokens',
          },
          {
            name: 'Relaxed',
            value: 'relaxed',
            description: 'Slower but cheaper, uses SOGNI/Spark tokens',
          },
        ],
        default: 'fast',
        description:
          'Network type to use. If timeout is left empty, this will imply 60s (fast) or 600s (relaxed).',
      },
      {
        displayName: 'Size Preset (Server-Validated)',
        name: 'imageSizePreset',
        type: 'options',
        default: '',
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getImageSizePresets',
          loadOptionsDependsOn: ['modelId', 'network'],
        },
        description:
          'Pick a server-validated size preset for the chosen Model + Network. Takes precedence over the (legacy) Size Preset in Additional Fields. Choose "Custom" to use Width/Height in Additional Fields instead.',
      },

      // ===== Image Edit Parameters =====

      // Model picker with search (loadOptions) - Image Edit
      {
        displayName: 'Model Search',
        name: 'imageEditModelSearch',
        type: 'string',
        placeholder: 'e.g., qwen, edit',
        default: '',
        description:
          'Type to filter Qwen Image Edit models by name. The dropdown below refreshes when you edit this field.',
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
      },
      {
        displayName: 'Model',
        name: 'imageEditModelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getImageEditModelOptions',
          loadOptionsDependsOn: ['imageEditModelSearch'],
        },
        default: '',
        description:
          'Choose a Qwen Image Edit model. Standard model works best near 20 steps / guidance 4.0, Lightning near 4 steps / guidance 1.0.',
      },
      {
        displayName: 'Edit Prompt',
        name: 'imageEditPrompt',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        default: '',
        typeOptions: { rows: 4 },
        description: 'Text description of the edit you want to apply to the context images',
        placeholder: 'Change the background to a beach sunset, make the sky orange',
      },
      {
        displayName: 'Context Image 1 (Binary Property)',
        name: 'contextImage1Property',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        default: 'data',
        description: 'Name of the binary property containing the first context image (required)',
        placeholder: 'data',
      },
      {
        displayName: 'Context Image 2 (Binary Property)',
        name: 'contextImage2Property',
        type: 'string',
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        default: '',
        description: 'Name of the binary property containing the second context image (optional)',
        placeholder: 'image2',
      },
      {
        displayName: 'Context Image 3 (Binary Property)',
        name: 'contextImage3Property',
        type: 'string',
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        default: '',
        description: 'Name of the binary property containing the third context image (optional)',
        placeholder: 'image3',
      },
      {
        displayName: 'Network',
        name: 'imageEditNetwork',
        type: 'options',
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        options: [
          {
            name: 'Fast',
            value: 'fast',
            description: 'Faster generation, uses SOGNI/Spark tokens',
          },
          {
            name: 'Relaxed',
            value: 'relaxed',
            description: 'Slower but cheaper, uses SOGNI/Spark tokens',
          },
        ],
        default: 'fast',
        description:
          'Network type to use. If timeout is left empty, this will imply 60s (fast) or 600s (relaxed).',
      },

      // Image Edit Additional Fields
      {
        displayName: 'Additional Fields',
        name: 'imageEditAdditionalFields',
        type: 'fixedCollection',
        placeholder: 'Add Field Group',
        default: {},
        displayOptions: {
          show: { resource: ['image'], operation: ['edit'] },
        },
        options: [
          {
            displayName: 'Generation Settings',
            name: 'generationSettings',
            values: [
              {
                displayName: 'Negative Prompt',
                name: 'negativePrompt',
                type: 'string',
                default: '',
                typeOptions: { rows: 2 },
                description: "Text description of what you don't want to see in the result",
                placeholder: 'blurry, low quality, distorted',
              },
              {
                displayName: 'Style Prompt',
                name: 'stylePrompt',
                type: 'string',
                default: '',
                description: 'Style description for the edited image',
                placeholder: 'photorealistic, cinematic lighting',
              },
              {
                displayName: 'Number of Images',
                name: 'numberOfMedia',
                type: 'number',
                default: 1,
                description: 'Number of edited images to generate (1-10)',
                typeOptions: { minValue: 1, maxValue: 10 },
              },
              {
                displayName: 'Steps',
                name: 'steps',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Number of inference steps. Leave empty for auto-detection (20 for standard model, 4 for lightning model).',
                typeOptions: { minValue: 1, maxValue: 100 },
              },
              {
                displayName: 'Guidance',
                name: 'guidance',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'How closely to follow the prompt. Leave empty for model defaults (4.0 standard, 1.0 lightning).',
                typeOptions: { minValue: 0, maxValue: 30, numberPrecision: 1 },
              },
              {
                displayName: 'Seed',
                name: 'seed',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Random seed for reproducibility. Leave empty for random.',
                placeholder: '12345',
              },
            ],
          },
          {
            displayName: 'Output',
            name: 'output',
            values: [
              {
                displayName: 'Download Images',
                name: 'downloadImages',
                type: 'boolean',
                default: true,
                description:
                  'Whether to download images as binary data (recommended to avoid 48h URL expiry)',
              },
              {
                displayName: 'Output Format',
                name: 'outputFormat',
                type: 'options',
                options: [
                  { name: 'PNG', value: 'png' },
                  { name: 'JPG', value: 'jpg' },
                ],
                default: 'png',
                description: 'Output image format',
              },
              {
                displayName: 'Size Preset',
                name: 'sizePreset',
                type: 'string',
                default: '',
                description:
                  'Size preset ID (e.g., "square_hd", "portrait_4_7"). Leave empty for default.',
                placeholder: 'square_hd',
              },
              {
                displayName: 'Custom Width',
                name: 'width',
                type: 'number',
                default: 1024,
                description:
                  'Custom width in pixels (256-2048). Only used if Size Preset is "custom".',
                typeOptions: { minValue: 256, maxValue: 2048 },
              },
              {
                displayName: 'Custom Height',
                name: 'height',
                type: 'number',
                default: 1024,
                description:
                  'Custom height in pixels (256-2048). Only used if Size Preset is "custom".',
                typeOptions: { minValue: 256, maxValue: 2048 },
              },
            ],
          },
          {
            displayName: 'Advanced',
            name: 'advanced',
            values: [
              {
                displayName: 'Token Type',
                name: 'tokenType',
                type: 'options',
                options: [
                  { name: 'Spark', value: 'spark' },
                  { name: 'SOGNI', value: 'sogni' },
                ],
                default: 'spark',
                description: 'Token type to use for payment',
              },
              {
                displayName: 'Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Maximum time to wait for image edit in milliseconds. If left empty, defaults to 60,000 for fast or 600,000 for relaxed network.',
                typeOptions: { minValue: 30000 },
              },
            ],
          },
        ],
      },

      // ===== Video Generation Parameters =====

      // Model picker with search (loadOptions) - Video
      {
        displayName: 'Model Search',
        name: 'videoModelSearch',
        type: 'string',
        placeholder: 'e.g., flux, video, animation',
        default: '',
        description:
          'Type to filter video models by name/tag. The dropdown below refreshes when you edit this field.',
        displayOptions: {
          show: { resource: ['video'], operation: ['generate', 'estimateCost'] },
        },
      },
      {
        displayName: 'Model',
        name: 'videoModelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['video'], operation: ['generate', 'estimateCost'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getVideoModelOptions',
          loadOptionsDependsOn: ['videoModelSearch'],
        },
        default: '',
        description:
          'Choose a video model from the list (recommended), or paste a known model ID into this field.',
      },

      {
        displayName: 'Positive Prompt',
        name: 'videoPositivePrompt',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['video'], operation: ['generate'] },
        },
        default: '',
        typeOptions: { rows: 4 },
        description: 'Text description of the video you want to generate',
        placeholder: 'A cat playing with a ball, smooth motion, cinematic',
      },
      {
        displayName: 'Network',
        name: 'videoNetwork',
        type: 'options',
        displayOptions: {
          show: { resource: ['video'], operation: ['generate'] },
        },
        options: [
          {
            name: 'Fast',
            value: 'fast',
            description: 'Faster generation, uses SOGNI/Spark tokens',
          },
          {
            name: 'Relaxed',
            value: 'relaxed',
            description: 'Slower but cheaper, uses SOGNI/Spark tokens',
          },
        ],
        default: 'fast',
        description:
          'Network type to use. If timeout is left empty, this will imply 120s (fast) or 1200s (relaxed) for video.',
      },

      // ===== Video Cost Estimate Parameters =====
      {
        displayName: 'Width',
        name: 'videoEstimateWidth',
        type: 'number',
        default: 512,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Estimated output width in pixels (video engines typically require multiples of 16)',
        typeOptions: { minValue: 480, maxValue: 1536 },
      },
      {
        displayName: 'Height',
        name: 'videoEstimateHeight',
        type: 'number',
        default: 512,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Estimated output height in pixels (video engines typically require multiples of 16)',
        typeOptions: { minValue: 480, maxValue: 1536 },
      },
      {
        displayName: 'FPS',
        name: 'videoEstimateFps',
        type: 'number',
        default: 16,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Frames per second used for estimation',
        typeOptions: { minValue: 1, maxValue: 60 },
      },
      {
        displayName: 'Steps',
        name: 'videoEstimateSteps',
        type: 'number',
        default: 4,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Inference steps used for estimation',
        typeOptions: { minValue: 1, maxValue: 100 },
      },
      {
        displayName: 'Duration (seconds)',
        name: 'videoEstimateDuration',
        type: 'number',
        default: 5,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Estimated duration in seconds',
        typeOptions: { minValue: 1, maxValue: 10 },
      },
      {
        displayName: 'Frames (Optional)',
        name: 'videoEstimateFrames',
        type: 'number',
        default: undefined as unknown as number,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'Optional explicit frame count; if set, this is sent along with duration',
        typeOptions: { minValue: 1, maxValue: 300 },
      },
      {
        displayName: 'Number of Videos',
        name: 'videoEstimateNumberOfMedia',
        type: 'number',
        default: 1,
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        description: 'How many videos to estimate',
        typeOptions: { minValue: 1, maxValue: 10 },
      },
      {
        displayName: 'Token Type',
        name: 'videoEstimateTokenType',
        type: 'options',
        default: 'spark',
        displayOptions: {
          show: { resource: ['video'], operation: ['estimateCost'] },
        },
        options: [
          { name: 'Spark', value: 'spark' },
          { name: 'SOGNI', value: 'sogni' },
        ],
        description: 'Token type for the estimate',
      },

      // ===== Regrouped Additional Fields - with backward compatibility =====
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'fixedCollection',
        placeholder: 'Add Field Group',
        default: {},
        displayOptions: {
          show: { resource: ['image'], operation: ['generate'] },
        },
        options: [
          {
            displayName: 'Generation Settings',
            name: 'generationSettings',
            values: [
              {
                displayName: 'Negative Prompt',
                name: 'negativePrompt',
                type: 'string',
                default: '',
                typeOptions: { rows: 2 },
                description: "Text description of what you don't want to see",
                placeholder: 'blurry, low quality, distorted',
              },
              {
                displayName: 'Style Prompt',
                name: 'stylePrompt',
                type: 'string',
                default: '',
                description: 'Style description for the image',
                placeholder: 'anime, photorealistic, oil painting',
              },
              {
                displayName: 'Number of Images',
                name: 'numberOfMedia',
                type: 'number',
                default: 1,
                description: 'Number of images to generate (1-10)',
                typeOptions: { minValue: 1, maxValue: 10 },
              },
              {
                displayName: 'Steps',
                name: 'steps',
                type: 'number',
                default: 20,
                description:
                  'Number of inference steps. More steps = better quality but slower. Flux models work best with 4 steps.',
                typeOptions: { minValue: 1, maxValue: 100 },
              },
              {
                displayName: 'Guidance',
                name: 'guidance',
                type: 'number',
                default: 7.5,
                description: 'How closely to follow the prompt. 7.5 is optimal for most models.',
                typeOptions: { minValue: 0, maxValue: 30, numberPrecision: 1 },
              },
              {
                displayName: 'Seed',
                name: 'seed',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Random seed for reproducibility. Leave empty for random.',
                placeholder: '12345',
              },
            ],
          },
          {
            displayName: 'Output',
            name: 'output',
            values: [
              {
                displayName: 'Download Images',
                name: 'downloadImages',
                type: 'boolean',
                default: true,
                description:
                  'Whether to download images as binary data (recommended to avoid 48h URL expiry)',
              },
              {
                displayName: 'Output Format',
                name: 'outputFormat',
                type: 'options',
                options: [
                  { name: 'PNG', value: 'png' },
                  { name: 'JPG', value: 'jpg' },
                ],
                default: 'png',
                description: 'Output image format',
              },
              {
                displayName: 'Size Preset',
                name: 'sizePreset',
                type: 'string',
                default: '',
                description:
                  'Size preset ID (e.g., "square_hd", "portrait_4_7"). Leave empty for default.',
                placeholder: 'square_hd',
              },
              {
                displayName: 'Custom Width',
                name: 'width',
                type: 'number',
                default: 1024,
                description:
                  'Custom width in pixels (256-2048). Only used if Size Preset is "custom".',
                typeOptions: { minValue: 256, maxValue: 2048 },
              },
              {
                displayName: 'Custom Height',
                name: 'height',
                type: 'number',
                default: 1024,
                description:
                  'Custom height in pixels (256-2048). Only used if Size Preset is "custom".',
                typeOptions: { minValue: 256, maxValue: 2048 },
              },
            ],
          },
          {
            displayName: 'Advanced',
            name: 'advanced',
            values: [
              {
                displayName: 'Token Type',
                name: 'tokenType',
                type: 'options',
                options: [
                  { name: 'Spark', value: 'spark' },
                  { name: 'SOGNI', value: 'sogni' },
                ],
                default: 'spark',
                description: 'Token type to use for payment',
              },
              {
                displayName: 'Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Maximum time to wait for image generation in milliseconds. If left empty, defaults to 60,000 for fast or 600,000 for relaxed network.',
                typeOptions: { minValue: 30000 },
              },
            ],
          },
          {
            displayName: 'ControlNet',
            name: 'controlNet',
            values: [
              {
                displayName: 'Enable ControlNet',
                name: 'enableControlNet',
                type: 'boolean',
                default: false,
                description: 'Whether to use ControlNet for guided image generation',
              },
              {
                displayName: 'ControlNet Type',
                name: 'controlNetType',
                type: 'options',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                options: [
                  { name: 'Canny (Edge Detection)', value: 'canny', description: 'Detect edges' },
                  { name: 'Scribble', value: 'scribble', description: 'Hand-drawn scribbles' },
                  { name: 'Line Art', value: 'lineart', description: 'Extract line art' },
                  { name: 'Line Art Anime', value: 'lineartanime', description: 'Anime line art' },
                  { name: 'Soft Edge', value: 'softedge', description: 'Detect soft edges' },
                  { name: 'Shuffle', value: 'shuffle', description: 'Shuffle control image' },
                  { name: 'Tile', value: 'tile', description: 'Tiling pattern' },
                  { name: 'Inpaint', value: 'inpaint', description: 'Inpaint masked areas' },
                  {
                    name: 'InstructPix2Pix',
                    value: 'instrp2p',
                    description: 'Instruction-based editing',
                  },
                  { name: 'Depth', value: 'depth', description: 'Use depth map' },
                  { name: 'Normal Map', value: 'normalbae', description: 'Use normal map' },
                  { name: 'OpenPose', value: 'openpose', description: 'Use pose detection' },
                  {
                    name: 'Segmentation',
                    value: 'segmentation',
                    description: 'Use semantic segmentation',
                  },
                  { name: 'MLSD (Line Segment)', value: 'mlsd', description: 'Line segments' },
                  { name: 'InstantID', value: 'instantid', description: 'Identity preservation' },
                ],
                default: 'canny',
                description: 'Type of ControlNet to use',
              },
              {
                displayName: 'ControlNet Image (Binary Property)',
                name: 'controlNetImageProperty',
                type: 'string',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                default: 'data',
                description: 'Name of the binary property containing the control image',
                placeholder: 'data',
              },
              {
                displayName: 'ControlNet Strength',
                name: 'controlNetStrength',
                type: 'number',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                default: 0.5,
                description:
                  'Control strength (0-1). 0 = full control to prompt, 1 = full control to ControlNet',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
              {
                displayName: 'ControlNet Mode',
                name: 'controlNetMode',
                type: 'options',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                options: [
                  { name: 'Balanced', value: 'balanced', description: 'Balanced' },
                  { name: 'Prompt Priority', value: 'prompt_priority', description: 'Prompt wins' },
                  { name: 'ControlNet Priority', value: 'cn_priority', description: 'CN wins' },
                ],
                default: 'balanced',
                description: 'How to weight control and prompt',
              },
              {
                displayName: 'ControlNet Guidance Start',
                name: 'controlNetGuidanceStart',
                type: 'number',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                default: 0,
                description: 'Step when ControlNet first applied (0-1)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
              {
                displayName: 'ControlNet Guidance End',
                name: 'controlNetGuidanceEnd',
                type: 'number',
                displayOptions: {
                  show: { '/additionalFields.controlNet.enableControlNet': [true] },
                },
                default: 1,
                description: 'Step when ControlNet last applied (0-1)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
            ],
          },
        ],
      },

      // ===== Video Additional Fields =====
      {
        displayName: 'Additional Fields',
        name: 'videoAdditionalFields',
        type: 'fixedCollection',
        placeholder: 'Add Field Group',
        default: {},
        displayOptions: {
          show: { resource: ['video'], operation: ['generate'] },
        },
        options: [
          {
            displayName: 'Video Settings',
            name: 'videoSettings',
            values: [
              {
                displayName: 'Negative Prompt',
                name: 'negativePrompt',
                type: 'string',
                default: '',
                typeOptions: { rows: 2 },
                description: 'Description of what to avoid in the video',
                placeholder: 'blurry, static, glitchy',
              },
              {
                displayName: 'Style Prompt',
                name: 'stylePrompt',
                type: 'string',
                default: '',
                description: 'Additional style instructions for the video',
                placeholder: 'cinematic, smooth motion, high quality',
              },
              {
                displayName: 'Number of Videos',
                name: 'numberOfMedia',
                type: 'number',
                default: 1,
                description: 'How many videos to generate (1-4)',
                typeOptions: { minValue: 1, maxValue: 4 },
              },
              {
                displayName: 'Frames',
                name: 'frames',
                type: 'number',
                default: 30,
                description:
                  'Number of frames in the video (10-120). LTX-2 models work best with frame counts of 8n+1.',
                typeOptions: { minValue: 10, maxValue: 120 },
              },
              {
                displayName: 'Duration (seconds)',
                name: 'duration',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Optional duration in seconds. If set, this is passed to the SDK for model-aware frame handling.',
                typeOptions: { minValue: 1, maxValue: 20 },
              },
              {
                displayName: 'FPS (Frames Per Second)',
                name: 'fps',
                type: 'number',
                default: 30,
                description: 'Frames per second (10-60)',
                typeOptions: { minValue: 10, maxValue: 60 },
              },
              {
                displayName: 'Steps',
                name: 'steps',
                type: 'number',
                default: 20,
                description: 'Number of inference steps (1-100)',
                typeOptions: { minValue: 1, maxValue: 100 },
              },
              {
                displayName: 'Guidance',
                name: 'guidance',
                type: 'number',
                default: 7.5,
                description: 'How closely to follow the prompt (0-30)',
                typeOptions: { minValue: 0, maxValue: 30, numberPrecision: 1 },
              },
              {
                displayName: 'Shift',
                name: 'shift',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Video motion intensity (typically 1.0-8.0, model dependent)',
                typeOptions: { minValue: 0, maxValue: 10, numberPrecision: 1 },
              },
              {
                displayName: 'TeaCache Threshold',
                name: 'teacacheThreshold',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Optional optimization threshold for supported T2V/I2V models (0.0-1.0)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
              {
                displayName: 'Sampler',
                name: 'sampler',
                type: 'string',
                default: '',
                description: 'Optional sampler override (model-specific)',
                placeholder: 'euler',
              },
              {
                displayName: 'Scheduler',
                name: 'scheduler',
                type: 'string',
                default: '',
                description: 'Optional scheduler override (model-specific)',
                placeholder: 'normal',
              },
              {
                displayName: 'Seed',
                name: 'seed',
                type: 'number',
                default: undefined,
                description: 'Seed for reproducible results (optional)',
                typeOptions: { minValue: 0, maxValue: 2147483647 },
              },
            ],
          },
          {
            displayName: 'Workflow Inputs',
            name: 'inputs',
            values: [
              {
                displayName: 'Reference Image (Binary Property)',
                name: 'referenceImageProperty',
                type: 'string',
                default: '',
                description: 'Binary property containing reference image (i2v/s2v/animate workflows)',
                placeholder: 'data',
              },
              {
                displayName: 'Reference End Image (Binary Property)',
                name: 'referenceImageEndProperty',
                type: 'string',
                default: '',
                description: 'Binary property containing ending image for interpolation-capable workflows',
                placeholder: 'endImage',
              },
              {
                displayName: 'Reference Audio (Binary Property)',
                name: 'referenceAudioProperty',
                type: 'string',
                default: '',
                description: 'Binary property containing audio for s2v workflows',
                placeholder: 'audio',
              },
              {
                displayName: 'Reference Video (Binary Property)',
                name: 'referenceVideoProperty',
                type: 'string',
                default: '',
                description: 'Binary property containing source/driving video for animate/v2v workflows',
                placeholder: 'video',
              },
            ],
          },
          {
            displayName: 'Workflow Controls',
            name: 'workflowControls',
            values: [
              {
                displayName: 'Video Start (s)',
                name: 'videoStart',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Start offset in seconds when reading reference video',
                typeOptions: { minValue: 0, numberPrecision: 2 },
              },
              {
                displayName: 'Audio Start (s)',
                name: 'audioStart',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Start offset in seconds when reading reference audio',
                typeOptions: { minValue: 0, numberPrecision: 2 },
              },
              {
                displayName: 'Audio Duration (s)',
                name: 'audioDuration',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Optional audio duration in seconds for s2v workflows',
                typeOptions: { minValue: 0.1, numberPrecision: 2 },
              },
              {
                displayName: 'Trim End Frame',
                name: 'trimEndFrame',
                type: 'boolean',
                default: false,
                description: 'Trim final frame (useful for stitched transition sequences)',
              },
              {
                displayName: 'First Frame Strength',
                name: 'firstFrameStrength',
                type: 'number',
                default: undefined as unknown as number,
                description: 'LTX-2 keyframe interpolation strength for start frame (0-1)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
              {
                displayName: 'Last Frame Strength',
                name: 'lastFrameStrength',
                type: 'number',
                default: undefined as unknown as number,
                description: 'LTX-2 keyframe interpolation strength for end frame (0-1)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
              {
                displayName: 'SAM2 Coordinates (JSON)',
                name: 'sam2CoordinatesJson',
                type: 'string',
                default: '',
                description:
                  'Animate-replace subject points as JSON array, e.g. [{"x":0.5,"y":0.5}]',
                placeholder: '[{"x":0.5,"y":0.5}]',
              },
              {
                displayName: 'Enable LTX-2 Video ControlNet',
                name: 'enableVideoControlNet',
                type: 'boolean',
                default: false,
                description: 'Enable LTX-2 v2v ControlNet using the reference video as control input',
              },
              {
                displayName: 'Video ControlNet Type',
                name: 'videoControlNetType',
                type: 'options',
                displayOptions: {
                  show: { '/videoAdditionalFields.workflowControls.enableVideoControlNet': [true] },
                },
                options: [
                  { name: 'Canny', value: 'canny' },
                  { name: 'Pose', value: 'pose' },
                  { name: 'Depth', value: 'depth' },
                  { name: 'Detailer', value: 'detailer' },
                ],
                default: 'canny',
                description: 'Control signal extracted from reference video',
              },
              {
                displayName: 'Video ControlNet Strength',
                name: 'videoControlNetStrength',
                type: 'number',
                displayOptions: {
                  show: { '/videoAdditionalFields.workflowControls.enableVideoControlNet': [true] },
                },
                default: 0.8,
                description: 'How strongly to follow ControlNet signal (0-1)',
                typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
              },
            ],
          },
          {
            displayName: 'Output',
            name: 'output',
            values: [
              {
                displayName: 'Download Videos',
                name: 'downloadVideos',
                type: 'boolean',
                default: true,
                description: 'Whether to download videos as binary data (prevents URL expiry)',
              },
              {
                displayName: 'Output Format',
                name: 'outputFormat',
                type: 'options',
                options: [{ name: 'MP4', value: 'mp4' }],
                default: 'mp4',
                description: 'Video output format (currently only MP4 is supported)',
              },
              {
                displayName: 'Width',
                name: 'width',
                type: 'number',
                default: 512,
                description: 'Video width in pixels (256-1024)',
                typeOptions: { minValue: 256, maxValue: 1024 },
              },
              {
                displayName: 'Height',
                name: 'height',
                type: 'number',
                default: 512,
                description: 'Video height in pixels (256-1024)',
                typeOptions: { minValue: 256, maxValue: 1024 },
              },
            ],
          },
          {
            displayName: 'Advanced',
            name: 'advanced',
            values: [
              {
                displayName: 'Token Type',
                name: 'tokenType',
                type: 'options',
                options: [
                  { name: 'Spark', value: 'spark', description: 'Use Spark tokens (cheaper)' },
                  { name: 'SOGNI', value: 'sogni', description: 'Use SOGNI tokens' },
                ],
                default: 'spark',
                description: 'Which token type to use for generation',
              },
              {
                displayName: 'Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: undefined,
                description: 'Max wait time in milliseconds. Leave empty for network-based defaults.',
                typeOptions: { minValue: 1000, maxValue: 3600000 },
              },
              {
                displayName: 'Auto Resize Video Assets',
                name: 'autoResizeVideoAssets',
                type: 'boolean',
                default: true,
                description:
                  'Automatically normalize and resize reference images for video-compatible dimensions',
              },
            ],
          },
        ],
      },

      // ===== Audio Generation Parameters =====

      // Model picker with search (loadOptions) - Audio
      {
        displayName: 'Model Search',
        name: 'audioModelSearch',
        type: 'string',
        placeholder: 'e.g., ace-step, music',
        default: '',
        description:
          'Type to filter audio models by name/tag. The dropdown below refreshes when you edit this field.',
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate', 'estimateCost'] },
        },
      },
      {
        displayName: 'Model',
        name: 'audioModelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate', 'estimateCost'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getAudioModelOptions',
          loadOptionsDependsOn: ['audioModelSearch'],
        },
        default: '',
        description:
          'Choose an audio model from the list (recommended), or paste a known model ID into this field.',
      },
      {
        displayName: 'Positive Prompt',
        name: 'audioPositivePrompt',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate'] },
        },
        default: '',
        typeOptions: { rows: 4 },
        description:
          'Text description of the music or audio you want to generate (genre, mood, instruments, etc.)',
        placeholder: 'upbeat synthwave with driving bass, 80s vibes',
      },
      {
        displayName: 'Network',
        name: 'audioNetwork',
        type: 'options',
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate'] },
        },
        options: [
          {
            name: 'Fast',
            value: 'fast',
            description: 'Faster generation, uses SOGNI/Spark tokens',
          },
          {
            name: 'Relaxed',
            value: 'relaxed',
            description: 'Slower but cheaper, uses SOGNI/Spark tokens',
          },
        ],
        default: 'fast',
        description:
          'Network type to use. If timeout is left empty, this will imply 120s (fast) or 1200s (relaxed) for audio.',
      },
      {
        displayName: 'Duration (Seconds)',
        name: 'audioDuration',
        type: 'number',
        default: 30,
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate'] },
        },
        description: 'Length of the generated audio in seconds (10–600).',
        typeOptions: { minValue: 10, maxValue: 600 },
      },

      // ===== Audio Cost Estimate Parameters =====
      {
        displayName: 'Duration (Seconds)',
        name: 'audioEstimateDuration',
        type: 'number',
        default: 30,
        displayOptions: {
          show: { resource: ['audio'], operation: ['estimateCost'] },
        },
        description: 'Estimated audio duration in seconds (10–600)',
        typeOptions: { minValue: 10, maxValue: 600 },
      },
      {
        displayName: 'Steps',
        name: 'audioEstimateSteps',
        type: 'number',
        default: 30,
        displayOptions: {
          show: { resource: ['audio'], operation: ['estimateCost'] },
        },
        description: 'Inference steps used for estimation',
        typeOptions: { minValue: 1, maxValue: 200 },
      },
      {
        displayName: 'Number of Tracks',
        name: 'audioEstimateNumberOfMedia',
        type: 'number',
        default: 1,
        displayOptions: {
          show: { resource: ['audio'], operation: ['estimateCost'] },
        },
        description: 'How many audio tracks to estimate',
        typeOptions: { minValue: 1, maxValue: 10 },
      },
      {
        displayName: 'Token Type',
        name: 'audioEstimateTokenType',
        type: 'options',
        default: 'spark',
        displayOptions: {
          show: { resource: ['audio'], operation: ['estimateCost'] },
        },
        options: [
          { name: 'Spark', value: 'spark' },
          { name: 'SOGNI', value: 'sogni' },
        ],
        description: 'Token type for the estimate',
      },

      // ===== Audio Additional Fields =====
      {
        displayName: 'Additional Fields',
        name: 'audioAdditionalFields',
        type: 'fixedCollection',
        placeholder: 'Add Field Group',
        default: {},
        displayOptions: {
          show: { resource: ['audio'], operation: ['generate'] },
        },
        options: [
          {
            displayName: 'Music & Lyrics',
            name: 'musicAndLyrics',
            values: [
              {
                displayName: 'Lyrics',
                name: 'lyrics',
                type: 'string',
                default: '',
                typeOptions: { rows: 4 },
                description:
                  'Song lyrics. Leave empty for instrumental generation.',
                placeholder: '[Verse 1]\nWalking through the neon glow…',
              },
              {
                displayName: 'Language',
                name: 'language',
                type: 'string',
                default: '',
                description:
                  'Lyrics language code (e.g., en, es, ja). Leave empty for server default.',
                placeholder: 'en',
              },
              {
                displayName: 'BPM',
                name: 'bpm',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Beats per minute (30–300). Leave empty for server default (120).',
                typeOptions: { minValue: 30, maxValue: 300 },
              },
              {
                displayName: 'Time Signature',
                name: 'timesignature',
                type: 'options',
                default: '',
                options: [
                  { name: 'Default', value: '' },
                  { name: '2/4', value: '2' },
                  { name: '3/4', value: '3' },
                  { name: '4/4', value: '4' },
                  { name: '6/8', value: '6' },
                ],
                description: 'Time signature for the composition',
              },
              {
                displayName: 'Key / Scale',
                name: 'keyscale',
                type: 'string',
                default: '',
                description: 'Key/scale (e.g., "C major", "A minor"). Empty uses server default.',
                placeholder: 'C major',
              },
              {
                displayName: 'Composer Mode',
                name: 'composerMode',
                type: 'boolean',
                default: true,
                description:
                  'Whether to enable AI composer mode for higher quality. Disable for faster runs or when using reference audio.',
              },
              {
                displayName: 'Prompt Strength',
                name: 'promptStrength',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'How closely the AI composer follows your prompt (0–10). Empty uses server default (2.0).',
                typeOptions: { minValue: 0, maxValue: 10, numberPrecision: 2 },
              },
              {
                displayName: 'Creativity',
                name: 'creativity',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Composition variation / temperature (0–2). Higher = more creative. Empty uses server default (0.85).',
                typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
              },
              {
                displayName: 'Shift',
                name: 'shift',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'ModelSamplingAuraFlow shift (1–6). Empty uses server default (3 for turbo).',
                typeOptions: { minValue: 1, maxValue: 6, numberPrecision: 1 },
              },
              {
                displayName: 'Sampler',
                name: 'sampler',
                type: 'string',
                default: '',
                description: 'Sampler name. Available options depend on the model.',
              },
              {
                displayName: 'Scheduler',
                name: 'scheduler',
                type: 'string',
                default: '',
                description: 'Scheduler name. Available options depend on the model.',
              },
            ],
          },
          {
            displayName: 'Generation Settings',
            name: 'generationSettings',
            values: [
              {
                displayName: 'Negative Prompt',
                name: 'negativePrompt',
                type: 'string',
                default: '',
                typeOptions: { rows: 2 },
                description: "Text description of what you don't want to hear",
                placeholder: 'distorted, off-key, low quality',
              },
              {
                displayName: 'Style Prompt',
                name: 'stylePrompt',
                type: 'string',
                default: '',
                description: 'Style description for the audio',
                placeholder: 'synthwave, lo-fi, orchestral',
              },
              {
                displayName: 'Number of Tracks',
                name: 'numberOfMedia',
                type: 'number',
                default: 1,
                description: 'Number of audio tracks to generate (1-10)',
                typeOptions: { minValue: 1, maxValue: 10 },
              },
              {
                displayName: 'Steps',
                name: 'steps',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'Number of inference steps. Leave empty to use the model default.',
                typeOptions: { minValue: 1, maxValue: 200 },
              },
              {
                displayName: 'Guidance',
                name: 'guidance',
                type: 'number',
                default: undefined as unknown as number,
                description:
                  'How closely to follow the prompt. Leave empty to use the model default.',
                typeOptions: { minValue: 0, maxValue: 30, numberPrecision: 1 },
              },
              {
                displayName: 'Seed',
                name: 'seed',
                type: 'number',
                default: undefined as unknown as number,
                description: 'Random seed for reproducibility. Leave empty for random.',
                placeholder: '12345',
              },
            ],
          },
          {
            displayName: 'Output',
            name: 'output',
            values: [
              {
                displayName: 'Download Audio',
                name: 'downloadAudios',
                type: 'boolean',
                default: true,
                description:
                  'Whether to download audio as binary data (recommended to avoid 48h URL expiry)',
              },
              {
                displayName: 'Output Format',
                name: 'outputFormat',
                type: 'options',
                options: [
                  { name: 'MP3', value: 'mp3' },
                  { name: 'FLAC', value: 'flac' },
                  { name: 'WAV', value: 'wav' },
                ],
                default: 'mp3',
                description: 'Audio output format',
              },
            ],
          },
          {
            displayName: 'Advanced',
            name: 'advanced',
            values: [
              {
                displayName: 'Token Type',
                name: 'tokenType',
                type: 'options',
                options: [
                  { name: 'Spark', value: 'spark', description: 'Use Spark tokens (cheaper)' },
                  { name: 'SOGNI', value: 'sogni', description: 'Use SOGNI tokens' },
                ],
                default: 'spark',
                description: 'Which token type to use for generation',
              },
              {
                displayName: 'Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: undefined,
                description: 'Max wait time in milliseconds. Leave empty for network-based defaults.',
                typeOptions: { minValue: 1000, maxValue: 3600000 },
              },
            ],
          },
        ],
      },

      // ===== Creative Workflow Parameters =====
      {
        displayName: 'Start Mode',
        name: 'cwStartMode',
        type: 'options',
        default: 'template',
        displayOptions: {
          show: { resource: ['creativeWorkflow'], operation: ['start'] },
        },
        options: [
          {
            name: 'Saved Template',
            value: 'template',
            description: 'Run a workflow template by ID, with input values',
          },
          {
            name: 'Inline Plan',
            value: 'inline',
            description: 'Run a one-shot plan composed client-side (steps[] array)',
          },
        ],
        description: 'How to define the workflow to run',
      },
      {
        displayName: 'Template ID',
        name: 'cwTemplateId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['creativeWorkflow'],
            operation: ['start'],
            cwStartMode: ['template'],
          },
        },
        description: 'ID of the saved workflow template to run',
        placeholder: 'wf_tpl_…',
      },
      {
        displayName: 'Inputs JSON',
        name: 'cwInputsJson',
        type: 'string',
        default: '',
        typeOptions: { rows: 6 },
        displayOptions: {
          show: {
            resource: ['creativeWorkflow'],
            operation: ['start'],
            cwStartMode: ['template'],
          },
        },
        description:
          'Optional inputs to pass to the template, as a JSON object resolved against the template\'s declared inputs[].',
        placeholder: '{"brief":"A neon city at dusk","aspect_ratio":"16:9"}',
      },
      {
        displayName: 'Inline Workflow JSON',
        name: 'cwInputJson',
        type: 'string',
        required: true,
        default: '',
        typeOptions: { rows: 10 },
        displayOptions: {
          show: {
            resource: ['creativeWorkflow'],
            operation: ['start'],
            cwStartMode: ['inline'],
          },
        },
        description:
          'Full inline workflow as JSON: { title?: string, steps: [{ id?, toolName, arguments, dependsOn? }, …] }.',
        placeholder:
          '{"title":"hero shot","steps":[{"toolName":"generate_image","arguments":{"prompt":"a neon city at dusk"}}]}',
      },
      {
        displayName: 'Wait Until Terminal',
        name: 'cwWait',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['creativeWorkflow'], operation: ['start'] },
        },
        description:
          'Whether to wait, following the workflow\'s event stream, until it reaches a terminal status (completed, partial_failure, failed, cancelled, waiting_for_user). Off = return the queued record immediately.',
      },
      {
        displayName: 'Start Additional Fields',
        name: 'cwStartAdditionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: { resource: ['creativeWorkflow'], operation: ['start'] },
        },
        options: [
          {
            displayName: 'Token Type',
            name: 'tokenType',
            type: 'options',
            options: [
              { name: 'Spark', value: 'spark', description: 'Use Spark tokens (cheaper)' },
              { name: 'SOGNI', value: 'sogni', description: 'Use SOGNI tokens' },
            ],
            default: 'spark',
            description: 'Token type charged for the run',
          },
          {
            displayName: 'App Source',
            name: 'appSource',
            type: 'string',
            default: 'n8n-nodes-sogni',
            description: 'Application source label used for server-side attribution',
          },
          {
            displayName: 'Idempotency Key',
            name: 'idempotencyKey',
            type: 'string',
            default: '',
            description:
              'Optional idempotency key for retrying the same request safely. Leave empty to omit.',
          },
          {
            displayName: 'Max Estimated Capacity Units',
            name: 'maxEstimatedCapacityUnits',
            type: 'number',
            default: undefined,
            description:
              'Cap on the estimated capacity units charged. Leave empty to use server default.',
            typeOptions: { minValue: 1, maxValue: 1000000 },
          },
          {
            displayName: 'Confirm Cost',
            name: 'confirmCost',
            type: 'boolean',
            default: false,
            description: 'Whether to require explicit cost confirmation server-side before running',
          },
          {
            displayName: 'Media References JSON',
            name: 'mediaReferencesJson',
            type: 'string',
            default: '',
            typeOptions: { rows: 4 },
            description:
              'Optional array of uploaded HTTP(S) media references the workflow can use (durable workflows require URLs, not data URIs).',
            placeholder: '[{"id":"img1","url":"https://example.com/hero.png"}]',
          },
          {
            displayName: 'Wait Timeout (ms)',
            name: 'pollTimeoutMs',
            type: 'number',
            default: 600000,
            description:
              'Maximum total time to wait for terminal status when "Wait Until Terminal" is on',
            typeOptions: { minValue: 1000, maxValue: 3600000 },
          },
        ],
      },
      {
        displayName: 'Workflow ID',
        name: 'cwWorkflowId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['creativeWorkflow'],
            operation: ['get', 'events', 'cancel'],
          },
        },
        description: 'The runtime workflow ID (returned from a Start operation)',
        placeholder: 'wf_run_…',
      },
      {
        displayName: 'Limit',
        name: 'cwListLimit',
        type: 'number',
        default: 20,
        displayOptions: {
          show: { resource: ['creativeWorkflow'], operation: ['list'] },
        },
        description: 'How many workflows to return',
        typeOptions: { minValue: 1, maxValue: 200 },
      },
      {
        displayName: 'Offset',
        name: 'cwListOffset',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['creativeWorkflow'], operation: ['list'] },
        },
        description: 'How many workflows to skip',
        typeOptions: { minValue: 0, maxValue: 100000 },
      },

      // ===== LLM Parameters =====
      {
        displayName: 'Model Search',
        name: 'llmModelSearch',
        type: 'string',
        placeholder: 'e.g., qwen, vision, reasoning',
        default: '',
        displayOptions: {
          show: { resource: ['llm'], operation: ['generate', 'estimateCost'] },
        },
        description:
          'Type to filter chat models by ID. The dropdown below refreshes when you edit this field.',
      },
      {
        displayName: 'Model',
        name: 'llmModelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['llm'], operation: ['generate', 'estimateCost'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getChatModelOptions',
          loadOptionsDependsOn: ['llmModelSearch'],
        },
        default: '',
        description: 'The Sogni chat/LLM model to use',
      },
      {
        displayName: 'Prompt',
        name: 'llmPrompt',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: { resource: ['llm'], operation: ['generate', 'estimateCost'] },
        },
        description: 'The user prompt to send to the selected Sogni LLM model',
      },
      {
        displayName: 'System Prompt',
        name: 'llmSystemPrompt',
        type: 'string',
        default: '',
        displayOptions: {
          show: { resource: ['llm'], operation: ['generate', 'estimateCost'] },
        },
        description: 'Optional system instruction to guide tone, style, or behavior',
      },
      {
        displayName: 'LLM Additional Fields',
        name: 'llmAdditionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: { resource: ['llm'], operation: ['generate', 'estimateCost'] },
        },
        options: [
          {
            displayName: 'Max Tokens',
            name: 'maxTokens',
            type: 'number',
            default: 256,
            description: 'Maximum number of completion tokens to request',
            typeOptions: { minValue: 1, maxValue: 65536 },
          },
          {
            displayName: 'Messages JSON',
            name: 'messagesJson',
            type: 'string',
            default: '',
            typeOptions: { rows: 6 },
            description:
              'Optional full chat messages array as JSON. When set, this overrides Prompt and System Prompt.',
            placeholder:
              '[{"role":"system","content":"You are concise."},{"role":"user","content":"Hello"}]',
          },
          {
            displayName: 'Thinking',
            name: 'think',
            type: 'boolean',
            default: false,
            description: 'Whether to enable reasoning for models that support it',
          },
          {
            displayName: 'Enable Sogni Hosted Tools',
            name: 'useSogniHostedTools',
            type: 'boolean',
            default: false,
            description:
              `Whether to expose the current Sogni hosted creative tool catalog (${SOGNI_HOSTED_TOOL_NAMES.join(', ') || 'manifest-backed tools'}) to the model. No Tools JSON required.`,
          },
          {
            displayName: 'Tools JSON',
            name: 'toolsJson',
            type: 'string',
            default: '',
            typeOptions: { rows: 6 },
            description:
              'Optional OpenAI-style tools array as JSON for custom tool calling. Merged with Sogni hosted tools when that toggle is on; entries here override hosted tools with the same name.',
            placeholder:
              '[{"type":"function","function":{"name":"get_time","description":"Get current time","parameters":{"type":"object","properties":{"timezone":{"type":"string"}},"required":["timezone"]}}}]',
          },
          {
            displayName: 'Tool Choice JSON',
            name: 'toolChoiceJson',
            type: 'string',
            default: '',
            description:
              'Optional tool choice. Use `auto`, `none`, `required`, or a JSON object such as {"type":"function","function":{"name":"my_tool"}}',
            placeholder: 'auto',
          },
          {
            displayName: 'Token Type',
            name: 'tokenType',
            type: 'options',
            options: [
              { name: 'Spark', value: 'spark', description: 'Use Spark tokens (cheaper)' },
              { name: 'SOGNI', value: 'sogni', description: 'Use SOGNI tokens' },
            ],
            default: 'spark',
            description: 'Which token type to use for the chat request',
          },
        ],
      },

      // ===== Model Get Parameters =====
      {
        displayName: 'Model Search',
        name: 'modelSearch',
        type: 'string',
        placeholder: 'e.g., flux, sd, anime',
        default: '',
        displayOptions: {
          show: { resource: ['model'], operation: ['get'] },
        },
        description:
          'Type to filter models by name/tag. The dropdown below refreshes when you edit this field.',
      },
      {
        displayName: 'Model',
        name: 'modelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['model'], operation: ['get'] },
        },
        typeOptions: {
          loadOptionsMethod: 'getModelOptions',
          loadOptionsDependsOn: ['modelSearch'],
        },
        default: '',
        description: 'The model to retrieve',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: { resource: ['model'], operation: ['getAll'] },
        },
        options: [
          {
            displayName: 'Sort by Workers',
            name: 'sortByWorkers',
            type: 'boolean',
            default: true,
            description: 'Whether to sort models by worker count (most popular first)',
          },
          {
            displayName: 'Minimum Workers',
            name: 'minWorkers',
            type: 'number',
            default: 0,
            description: 'Filter models with at least this many workers',
          },
        ],
      },
    ],
  };

  // Model picker loadOptions
  methods = {
    loadOptions: {
      async getModelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        // IMPORTANT: Use a dedicated unique appId for loadOptions so the editor UI cannot
        // interfere with any running workflow execution.
        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getModelOptions appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          // Read search text and coerce to string
          const search = (this.getCurrentNodeParameter('modelSearch') as string) || '';

          const models = await client.getAvailableModels({
            sortByWorkers: true,
            minWorkers: 0,
            // Pass both keys; wrapper will ignore unknowns
            search: search || undefined,
            filter: search || undefined,
            limit: 100,
          } as any);

          const options: INodePropertyOptions[] = (models as any[]).map((model: any) => {
            const workers = model.workerCount ?? model.workers ?? 0;
            const healthy =
              model.health === 'healthy' ||
              model.status === 'healthy' ||
              (typeof model.healthy === 'boolean' ? model.healthy : workers > 0);
            const recommended = healthy && workers >= 5;
            const badge = workers ? ` • ${workers} workers` : '';
            return {
              name: `${model.name || model.id}${badge}${recommended ? ' (recommended)' : ''}`,
              value: model.id,
              description: model.description || undefined,
            };
          });

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getModelOptions',
            appId,
            timeoutMs: 2000,
          });
        }
      },

      async getVideoModelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        // IMPORTANT: Use a dedicated unique appId for loadOptions so the editor UI cannot
        // interfere with any running workflow execution.
        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getVideoModelOptions appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          // Read search text and coerce to string
          const search = (this.getCurrentNodeParameter('videoModelSearch') as string) || '';

          const models = await client.getAvailableModels({
            sortByWorkers: true,
            minWorkers: 0,
            // Pass both keys; wrapper will ignore unknowns
            search: search || undefined,
            filter: search || undefined,
            limit: 100,
          } as any);

          // Filter for video models. Include explicit video families (WAN/LTX) plus keyword fallback.
          const videoModels = (models as any[]).filter((model: any) => isVideoModelCandidate(model));

          const options: INodePropertyOptions[] = videoModels.map((model: any) => {
            const workers = model.workerCount ?? model.workers ?? 0;
            const healthy =
              model.health === 'healthy' ||
              model.status === 'healthy' ||
              (typeof model.healthy === 'boolean' ? model.healthy : workers > 0);
            const recommended = healthy && workers >= 5;
            const badge = workers ? ` • ${workers} workers` : '';
            return {
              name: `${model.name || model.id}${badge}${recommended ? ' (recommended)' : ''}`,
              value: model.id,
              description: model.description || undefined,
            };
          });

          // If no video models found, add a placeholder
          if (options.length === 0) {
            options.push({
              name: 'No video models available - check back later',
              value: '',
              description: 'Video models are being added to the platform',
            });
          }

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getVideoModelOptions',
            appId,
            timeoutMs: 2000,
          });
        }
      },

      async getImageSizePresets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getImageSizePresets appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          const modelId = ((this.getCurrentNodeParameter('modelId') as string) || '').trim();
          const network = ((this.getCurrentNodeParameter('network') as string) || 'fast').trim() as
            | 'fast'
            | 'relaxed';

          if (!modelId) {
            return [
              {
                name: 'Pick a Model first to load its server-validated presets',
                value: '',
                description: 'Set the Model dropdown above before choosing a size preset',
              },
            ];
          }

          const presets = await client.getSizePresets(network, modelId);

          const options: INodePropertyOptions[] = [
            {
              name: 'Custom (Use Width/Height Below)',
              value: '',
              description:
                'Don\'t use a preset — fall back to the optional Width/Height fields in Additional Fields',
            },
            ...(presets as any[]).map((preset: any) => {
              const label = preset.label || preset.id || `${preset.width}x${preset.height}`;
              const ratio = preset.ratio ? ` (${preset.ratio})` : '';
              return {
                name: `${label}${ratio} • ${preset.width}x${preset.height}`,
                value: preset.id,
                description: preset.aspect || undefined,
              };
            }),
          ];

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getImageSizePresets',
            appId,
            timeoutMs: 2000,
          });
        }
      },

      async getAudioModelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        // IMPORTANT: Use a dedicated unique appId for loadOptions so the editor UI cannot
        // interfere with any running workflow execution.
        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getAudioModelOptions appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          const search = (this.getCurrentNodeParameter('audioModelSearch') as string) || '';

          const models = await client.getAvailableModels({
            sortByWorkers: true,
            minWorkers: 0,
            search: search || undefined,
            filter: search || undefined,
            limit: 100,
          } as any);

          // Filter for audio models. Prefer the SDK-provided `media` field; fall back to keyword
          // heuristics for resilience against older client versions that don't expose it.
          // Real ACE-Step model IDs use underscores (e.g. ace_step_1.5_turbo).
          const audioModels = (models as any[]).filter((model: any) => {
            if (model?.media === 'audio') return true;
            const id = String(model?.id ?? '').toLowerCase();
            const name = String(model?.name ?? '').toLowerCase();
            const description = String(model?.description ?? '').toLowerCase();
            const haystack = `${id} ${name} ${description}`;
            return (
              id.startsWith('ace_step') ||
              id.startsWith('ace-step') ||
              haystack.includes('audio') ||
              haystack.includes('music')
            );
          });

          const options: INodePropertyOptions[] = audioModels.map((model: any) => {
            const workers = model.workerCount ?? model.workers ?? 0;
            const healthy =
              model.health === 'healthy' ||
              model.status === 'healthy' ||
              (typeof model.healthy === 'boolean' ? model.healthy : workers > 0);
            const recommended = healthy && workers >= 5;
            const badge = workers ? ` • ${workers} workers` : '';
            return {
              name: `${model.name || model.id}${badge}${recommended ? ' (recommended)' : ''}`,
              value: model.id,
              description: model.description || undefined,
            };
          });

          if (options.length === 0) {
            options.push({
              name: 'No audio models available - check back later',
              value: '',
              description: 'Audio models are being added to the platform',
            });
          }

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getAudioModelOptions',
            appId,
            timeoutMs: 2000,
          });
        }
      },

      async getImageEditModelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        // IMPORTANT: Use a dedicated unique appId for loadOptions so the editor UI cannot
        // interfere with any running workflow execution.
        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getImageEditModelOptions appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          // Read search text and coerce to string
          const search = (this.getCurrentNodeParameter('imageEditModelSearch') as string) || '';

          const models = await client.getAvailableModels({
            sortByWorkers: true,
            minWorkers: 0,
            search: search || undefined,
            filter: search || undefined,
            limit: 100,
          } as any);

          // Filter for Qwen Image Edit models only
          const imageEditModels = (models as any[]).filter((model: any) => {
            const modelId = (model.id || '').toLowerCase();
            const name = (model.name || model.id || '').toLowerCase();
            // Match Qwen image edit models
            return (
              modelId.includes('qwen') && modelId.includes('image_edit') ||
              name.includes('qwen') && name.includes('image edit')
            );
          });

          const options: INodePropertyOptions[] = imageEditModels.map((model: any) => {
            const workers = model.workerCount ?? model.workers ?? 0;
            const healthy =
              model.health === 'healthy' ||
              model.status === 'healthy' ||
              (typeof model.healthy === 'boolean' ? model.healthy : workers > 0);
            const recommended = healthy && workers >= 5;
            const badge = workers ? ` • ${workers} workers` : '';

            // Add step recommendation based on model type
            const modelId = (model.id || '').toLowerCase();
            const isLightning = modelId.includes('lightning');
            const stepRecommendation = isLightning ? ' (4 steps recommended)' : ' (20 steps recommended)';

            return {
              name: `${model.name || model.id}${badge}${stepRecommendation}${recommended ? ' ★' : ''}`,
              value: model.id,
              description: model.description || `Qwen Image Edit model${isLightning ? ' - Fast lightning variant' : ''}`,
            };
          });

          // If no Qwen image edit models found, add a placeholder
          if (options.length === 0) {
            options.push({
              name: 'No Qwen Image Edit models available - check back later',
              value: '',
              description: 'Qwen Image Edit models are being added to the platform',
            });
          }

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getImageEditModelOptions',
            appId,
            timeoutMs: 2000,
          });
        }
      },

      async getChatModelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('sogniApi');

        // IMPORTANT: Use a dedicated unique appId for loadOptions so the editor UI cannot
        // interfere with any running workflow execution.
        const appId = generateUniqueAppId('n8n-sogni-loadopts');
        debugLogAppId(`loadOptions:getChatModelOptions appId=${appId}`);

        const client = createSogniClient(credentials, appId);

        try {
          const search = ((this.getCurrentNodeParameter('llmModelSearch') as string) || '')
            .trim()
            .toLowerCase();

          let models: Record<string, any>;
          try {
            models = await client.waitForChatModels(CHAT_MODEL_LOAD_OPTIONS_TIMEOUT_MS);
          } catch {
            models = await client.getAvailableChatModels();
          }

          const options: INodePropertyOptions[] = Object.entries(models)
            .filter(([modelId, info]) => {
              if (!search) return true;
              const provider = String((info as any)?.provider || '').toLowerCase();
              const label = String((info as any)?.label || '').toLowerCase();
              return (
                modelId.toLowerCase().includes(search) ||
                provider.includes(search) ||
                label.includes(search)
              );
            })
            .map(([modelId, info]) => {
              const workers = (info as any)?.workers ?? 0;
              const badge = workers ? ` • ${workers} workers` : '';
              return {
                name: `${modelId}${badge}${workers > 0 ? ' (available)' : ''}`,
                value: modelId,
                description:
                  (info as any)?.description ||
                  (info as any)?.label ||
                  (info as any)?.provider ||
                  undefined,
              };
            });

          if (options.length === 0) {
            options.push({
              name: 'No LLM models available - check back later',
              value: '',
              description: 'Chat models are not currently available for this account/session',
            });
          }

          return options;
        } finally {
          await safeDisconnect(client, {
            label: 'loadOptions:getChatModelOptions',
            appId,
            timeoutMs: 2000,
          });
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Get credentials
    const credentials = await this.getCredentials('sogniApi');

    /**
     * App ID strategy:
     * - If the user explicitly set an appId in credentials, honor it exactly.
     *   (Note: They must ensure they don't run multiple concurrent executions with the same appId.)
     * - Otherwise, generate a UNIQUE appId per node execution to avoid WebSocket collisions.
     */
    const userProvidedAppId = normalizeAppId(credentials.appId as string | undefined);
    const appId = userProvidedAppId ?? generateUniqueAppId('n8n-sogni');

    debugLogAppId(
      `execute node="${this.getNode().name}" appId=${appId} source=${
        userProvidedAppId ? 'credentials' : 'generated'
      }`,
    );

    // Create Sogni client (reuse single connection across all input items)
    const client = createSogniClient(credentials, appId);

    try {
      for (let i = 0; i < items.length; i++) {
        try {
          const resource = this.getNodeParameter('resource', i) as string;
          const operation = this.getNodeParameter('operation', i) as string;

          if (resource === 'image' && operation === 'generate') {
            // Image Generation
            const modelId = this.getNodeParameter('modelId', i) as string;
            const positivePrompt = this.getNodeParameter('positivePrompt', i) as string;

            // Grouped additional fields + backward-compatibility with old flat shape
            const additional = (this.getNodeParameter('additionalFields', i, {}) as any) || {};
            const gen = (additional.generationSettings as any) || {};
            const out = (additional.output as any) || {};
            const adv = (additional.advanced as any) || {};
            const cn = (additional.controlNet as any) || {};
            const legacy = additional;

            // --- network: support both top-level and legacy-in-additionalFields ---
            const networkTop = this.getNodeParameter('network', i) as 'fast' | 'relaxed' | undefined;
            const networkLegacy = legacy.network as 'fast' | 'relaxed' | undefined;
            const network = networkTop ?? networkLegacy ?? 'fast';

            const numberOfMedia = gen.numberOfMedia ?? legacy.numberOfMedia ?? legacy.numberOfImages ?? 1;
            const steps = gen.steps ?? legacy.steps ?? 20;
            const guidance = gen.guidance ?? legacy.guidance ?? 7.5;
            const negativePrompt = gen.negativePrompt ?? legacy.negativePrompt ?? '';
            const stylePrompt = gen.stylePrompt ?? legacy.stylePrompt ?? '';
            const seed = gen.seed ?? legacy.seed;

            const tokenType = adv.tokenType ?? legacy.tokenType ?? 'spark';
            const timeoutInput = adv.timeout ?? legacy.timeout;

            const downloadImages = out.downloadImages ?? legacy.downloadImages ?? true;
            const outputFormat = out.outputFormat ?? legacy.outputFormat ?? 'png';
            // Top-level dynamic size preset (loadOptions) wins over the legacy fixed-collection one.
            const topLevelSizePreset = ((this.getNodeParameter('imageSizePreset', i, '') as string) || '')
              .trim();
            const sizePreset = topLevelSizePreset || out.sizePreset || legacy.sizePreset;
            const width = out.width ?? legacy.width;
            const height = out.height ?? legacy.height;

            // Timeout defaults by network if user left it empty
            const resolvedTimeoutMs =
              typeof timeoutInput === 'number' && !Number.isNaN(timeoutInput)
                ? timeoutInput
                : network === 'fast'
                ? 60_000
                : 600_000;

            // Build project config
            const projectConfig: any = {
              modelId,
              positivePrompt,
              negativePrompt,
              stylePrompt,
              steps,
              guidance,
              numberOfMedia,
              network,
              tokenType,
              outputFormat,
              sizePreset,
              width,
              height,
              seed,
              waitForCompletion: true,
              timeout: resolvedTimeoutMs,
            };

            // ControlNet support
            const enableControlNet = cn.enableControlNet ?? legacy.enableControlNet ?? false;

            if (enableControlNet) {
              const controlNetType = (cn.controlNetType ?? legacy.controlNetType) as ControlNetName;
              const imagePropertyName =
                cn.controlNetImageProperty ?? legacy.controlNetImageProperty ?? 'data';

              const binaryData = items[i].binary?.[imagePropertyName];
              if (!binaryData) {
                throw new NodeOperationError(
                  this.getNode(),
                  `No binary data found in property "${imagePropertyName}". Please provide a control image.`,
                  { itemIndex: i },
                );
              }

              const imageBuffer = await this.helpers.getBinaryDataBuffer(i, imagePropertyName);

              projectConfig.controlNet = {
                name: controlNetType,
                image: imageBuffer,
                strength: cn.controlNetStrength ?? legacy.controlNetStrength ?? 0.5,
                mode: cn.controlNetMode ?? legacy.controlNetMode ?? 'balanced',
                guidanceStart: cn.controlNetGuidanceStart ?? legacy.controlNetGuidanceStart ?? 0,
                guidanceEnd: cn.controlNetGuidanceEnd ?? legacy.controlNetGuidanceEnd ?? 1,
              };
            }

            // Generate image
            const result = await client.createImageProject(projectConfig);
            const r: any = result; // relaxed view for optional fields not declared on the SDK type

            // Prepare output data
            const projectId = r.projectId ?? r.project?.id ?? undefined;

            const outputData: INodeExecutionData = {
              json: {
                projectId,
                modelId,
                prompt: positivePrompt,
                imageUrls: r.imageUrls || [],
                completed: r.completed,
                jobs: Array.isArray(r.jobs)
                  ? r.jobs.map((job: any) => ({
                      id: job.id,
                      status: job.status,
                    }))
                  : undefined,
                // Surface returned metadata when available
                meta: {
                  network,
                  tokenType,
                  resolved: {
                    steps,
                    guidance,
                    numberOfMedia,
                    timeoutMs: resolvedTimeoutMs,
                  },
                  cost: r.cost ?? r.costTokens ?? r.tokensUsed ?? r.tokenCost ?? undefined,
                  queuePosition: r.queuePosition ?? r.queue?.position ?? r.position ?? undefined,
                  latencies: {
                    queueMs:
                      r.queueTimeMs ?? r.latencies?.queueMs ?? r.metrics?.queueTimeMs ?? undefined,
                    generationMs:
                      r.generationTimeMs ??
                      r.latencies?.generationMs ??
                      r.metrics?.generationTimeMs ??
                      undefined,
                    totalMs:
                      r.totalTimeMs ?? r.latencies?.totalMs ?? r.metrics?.totalTimeMs ?? undefined,
                  },
                  workerId: r.workerId ?? r.worker?.id ?? undefined,
                  modelVersion: r.modelVersion ?? r.model?.version ?? undefined,
                  raw: r.meta ?? r.metadata ?? undefined,
                },
              },
              binary: {},
            };

            // Download images using native fetch; detect mime & filename
            if (downloadImages !== false && r.imageUrls && r.imageUrls.length > 0) {
              for (let imgIndex = 0; imgIndex < r.imageUrls.length; imgIndex++) {
                const imageUrl = r.imageUrls[imgIndex];

                try {
                  let headers: Record<string, string> = {};

                  const resp = await fetch(imageUrl);
                  if (!resp.ok) {
                    throw new Error(`Failed to download image: ${resp.status} ${resp.statusText}`);
                  }
                  const arrayBuffer = await resp.arrayBuffer();
                  const bodyBuffer = Buffer.from(arrayBuffer);

                  // normalize fetch headers
                  headers = {};
                  resp.headers.forEach((v, k) => {
                    headers[k.toLowerCase()] = v;
                  });

                  const headerCt = headers['content-type'] || (headers as any)['Content-Type'];
                  const mimeType = headerCt || sniffMimeType(bodyBuffer) || 'application/octet-stream';
                  const headerCd =
                    headers['content-disposition'] || (headers as any)['Content-Disposition'];
                  const cdFilename = parseContentDispositionFilename(headerCd);
                  const guessedExt = extensionFromMime(mimeType);

                  const defaultNameBase = (projectId ?? 'sogni') + `_${imgIndex}`;
                  const filename = cdFilename || `${defaultNameBase}.${guessedExt || 'bin'}`;

                  const binaryPropertyName = imgIndex === 0 ? 'image' : `image_${imgIndex}`;

                  outputData.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
                    bodyBuffer,
                    filename,
                    mimeType,
                  );
                } catch (downloadError) {
                  // If download fails, still include the URL
                  // eslint-disable-next-line no-console
                  console.error(`Failed to download image ${imgIndex}:`, downloadError);
                }
              }
            }

            returnData.push(outputData);
          } else if (resource === 'image' && operation === 'edit') {
            // Image Edit with Qwen
            const modelId = this.getNodeParameter('imageEditModelId', i) as string;
            const editPrompt = this.getNodeParameter('imageEditPrompt', i) as string;
            const contextImage1Property = this.getNodeParameter('contextImage1Property', i) as string;
            const contextImage2Property = this.getNodeParameter('contextImage2Property', i, '') as string;
            const contextImage3Property = this.getNodeParameter('contextImage3Property', i, '') as string;
            const network = this.getNodeParameter('imageEditNetwork', i) as 'fast' | 'relaxed';

            // Image edit additional fields
            const additional = (this.getNodeParameter('imageEditAdditionalFields', i, {}) as any) || {};
            const gen = (additional.generationSettings as any) || {};
            const out = (additional.output as any) || {};
            const adv = (additional.advanced as any) || {};

            const negativePrompt = gen.negativePrompt ?? '';
            const stylePrompt = gen.stylePrompt ?? '';
            const numberOfMedia = gen.numberOfMedia ?? 1;
            const stepsInput = gen.steps;
            const seed = gen.seed;

            const downloadImages = out.downloadImages ?? true;
            const outputFormat = out.outputFormat ?? 'png';
            const sizePreset = out.sizePreset;
            const width = out.width;
            const height = out.height;

            const tokenType = adv.tokenType ?? 'spark';
            const timeoutInput = adv.timeout;

            // Auto-detect steps from model if not provided
            const isLightningModel = modelId.toLowerCase().includes('lightning');
            const steps = typeof stepsInput === 'number' && !Number.isNaN(stepsInput)
              ? stepsInput
              : isLightningModel ? 4 : 20;
            const guidanceInput = gen.guidance;
            const guidance = typeof guidanceInput === 'number' && !Number.isNaN(guidanceInput)
              ? guidanceInput
              : isLightningModel ? 1.0 : 4.0;

            // Timeout defaults by network if user left it empty
            const resolvedTimeoutMs =
              typeof timeoutInput === 'number' && !Number.isNaN(timeoutInput)
                ? timeoutInput
                : network === 'fast'
                ? 60_000
                : 600_000;

            // Collect context images (1 required, 2-3 optional)
            const contextImages: Buffer[] = [];

            // Context image 1 (required)
            const binaryData1 = items[i].binary?.[contextImage1Property];
            if (!binaryData1) {
              throw new NodeOperationError(
                this.getNode(),
                `No binary data found in property "${contextImage1Property}". Please provide a context image.`,
                { itemIndex: i },
              );
            }
            contextImages.push(await this.helpers.getBinaryDataBuffer(i, contextImage1Property));

            // Context image 2 (optional)
            if (contextImage2Property && contextImage2Property.trim()) {
              const binaryData2 = items[i].binary?.[contextImage2Property];
              if (binaryData2) {
                contextImages.push(await this.helpers.getBinaryDataBuffer(i, contextImage2Property));
              }
            }

            // Context image 3 (optional)
            if (contextImage3Property && contextImage3Property.trim()) {
              const binaryData3 = items[i].binary?.[contextImage3Property];
              if (binaryData3) {
                contextImages.push(await this.helpers.getBinaryDataBuffer(i, contextImage3Property));
              }
            }

            // Build image edit project config
            const editProjectConfig: any = {
              modelId,
              positivePrompt: editPrompt,
              negativePrompt,
              stylePrompt,
              steps,
              guidance,
              numberOfMedia,
              network,
              tokenType,
              outputFormat,
              sizePreset,
              width,
              height,
              seed,
              contextImages,
              waitForCompletion: true,
              timeout: resolvedTimeoutMs,
            };

            // Call the image edit API
            const result = await client.createImageEditProject(editProjectConfig);
            const r: any = result;

            // Prepare output data
            const projectId = r.projectId ?? r.project?.id ?? undefined;

            const editOutputData: INodeExecutionData = {
              json: {
                projectId,
                modelId,
                prompt: editPrompt,
                imageUrls: r.imageUrls || [],
                completed: r.completed,
                contextImagesCount: contextImages.length,
                jobs: Array.isArray(r.jobs)
                  ? r.jobs.map((job: any) => ({
                      id: job.id,
                      status: job.status,
                    }))
                  : undefined,
                meta: {
                  network,
                  tokenType,
                  resolved: {
                    steps,
                    guidance,
                    numberOfMedia,
                    timeoutMs: resolvedTimeoutMs,
                  },
                  cost: r.cost ?? r.costTokens ?? r.tokensUsed ?? r.tokenCost ?? undefined,
                  queuePosition: r.queuePosition ?? r.queue?.position ?? r.position ?? undefined,
                  latencies: {
                    queueMs:
                      r.queueTimeMs ?? r.latencies?.queueMs ?? r.metrics?.queueTimeMs ?? undefined,
                    generationMs:
                      r.generationTimeMs ??
                      r.latencies?.generationMs ??
                      r.metrics?.generationTimeMs ??
                      undefined,
                    totalMs:
                      r.totalTimeMs ?? r.latencies?.totalMs ?? r.metrics?.totalTimeMs ?? undefined,
                  },
                  workerId: r.workerId ?? r.worker?.id ?? undefined,
                  modelVersion: r.modelVersion ?? r.model?.version ?? undefined,
                  raw: r.meta ?? r.metadata ?? undefined,
                },
              },
              binary: {},
            };

            // Download images using native fetch
            if (downloadImages !== false && r.imageUrls && r.imageUrls.length > 0) {
              for (let imgIndex = 0; imgIndex < r.imageUrls.length; imgIndex++) {
                const imageUrl = r.imageUrls[imgIndex];

                try {
                  let headers: Record<string, string> = {};

                  const resp = await fetch(imageUrl);
                  if (!resp.ok) {
                    throw new Error(`Failed to download image: ${resp.status} ${resp.statusText}`);
                  }
                  const arrayBuffer = await resp.arrayBuffer();
                  const bodyBuffer = Buffer.from(arrayBuffer);

                  // normalize fetch headers
                  headers = {};
                  resp.headers.forEach((v, k) => {
                    headers[k.toLowerCase()] = v;
                  });

                  const headerCt = headers['content-type'] || (headers as any)['Content-Type'];
                  const mimeType = headerCt || sniffMimeType(bodyBuffer) || 'application/octet-stream';
                  const headerCd =
                    headers['content-disposition'] || (headers as any)['Content-Disposition'];
                  const cdFilename = parseContentDispositionFilename(headerCd);
                  const guessedExt = extensionFromMime(mimeType);

                  const defaultNameBase = (projectId ?? 'sogni_edit') + `_${imgIndex}`;
                  const filename = cdFilename || `${defaultNameBase}.${guessedExt || 'bin'}`;

                  const binaryPropertyName = imgIndex === 0 ? 'image' : `image_${imgIndex}`;

                  editOutputData.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
                    bodyBuffer,
                    filename,
                    mimeType,
                  );
                } catch (downloadError) {
                  // If download fails, still include the URL
                  // eslint-disable-next-line no-console
                  console.error(`Failed to download edited image ${imgIndex}:`, downloadError);
                }
              }
            }

            returnData.push(editOutputData);
          } else if (resource === 'video' && operation === 'generate') {
            // Video Generation
            const videoModelId = this.getNodeParameter('videoModelId', i) as string;
            const videoPositivePrompt = this.getNodeParameter('videoPositivePrompt', i) as string;
            const videoNetwork = this.getNodeParameter('videoNetwork', i) as 'fast' | 'relaxed';

            // Video additional fields
            const videoAdditional = (this.getNodeParameter('videoAdditionalFields', i, {}) as any) || {};
            const videoSettings = (videoAdditional.videoSettings as any) || {};
            const videoInputs = (videoAdditional.inputs as any) || {};
            const videoWorkflow = (videoAdditional.workflowControls as any) || {};
            const videoOutput = (videoAdditional.output as any) || {};
            const videoAdvanced = (videoAdditional.advanced as any) || {};

            // Extract video parameters
            const negativePrompt = videoSettings.negativePrompt ?? '';
            const stylePrompt = videoSettings.stylePrompt ?? '';
            const numberOfMedia = videoSettings.numberOfMedia ?? 1;
            const requestedFrames = videoSettings.frames ?? 30;
            const duration = videoSettings.duration;
            const fps = videoSettings.fps ?? 30;
            const steps = videoSettings.steps ?? 20;
            const guidance = videoSettings.guidance ?? 7.5;
            const shift = videoSettings.shift;
            const teacacheThreshold = videoSettings.teacacheThreshold;
            const sampler = videoSettings.sampler;
            const scheduler = videoSettings.scheduler;
            const seed = videoSettings.seed;
            const frames = normalizeRequestedVideoFrames(videoModelId, requestedFrames);

            const downloadVideos = videoOutput.downloadVideos ?? true;
            const outputFormat = videoOutput.outputFormat ?? 'mp4';
            const width = videoOutput.width ?? 512;
            const height = videoOutput.height ?? 512;

            const tokenType = videoAdvanced.tokenType ?? 'spark';
            const timeoutInput = videoAdvanced.timeout;
            const autoResizeVideoAssets = videoAdvanced.autoResizeVideoAssets ?? true;

            const referenceImageProperty = (videoInputs.referenceImageProperty ?? '').trim();
            const referenceImageEndProperty = (videoInputs.referenceImageEndProperty ?? '').trim();
            const referenceAudioProperty = (videoInputs.referenceAudioProperty ?? '').trim();
            const referenceVideoProperty = (videoInputs.referenceVideoProperty ?? '').trim();

            const readOptionalBinaryProperty = async (
              propertyName: string,
              label: string,
            ): Promise<Buffer | undefined> => {
              if (!propertyName) return undefined;
              const binaryData = items[i].binary?.[propertyName];
              if (!binaryData) {
                throw new NodeOperationError(
                  this.getNode(),
                  `No binary data found in property "${propertyName}" for ${label}.`,
                  { itemIndex: i },
                );
              }
              return this.helpers.getBinaryDataBuffer(i, propertyName);
            };

            const referenceImage = await readOptionalBinaryProperty(
              referenceImageProperty,
              'reference image',
            );
            const referenceImageEnd = await readOptionalBinaryProperty(
              referenceImageEndProperty,
              'reference end image',
            );
            const referenceAudio = await readOptionalBinaryProperty(
              referenceAudioProperty,
              'reference audio',
            );
            const referenceVideo = await readOptionalBinaryProperty(
              referenceVideoProperty,
              'reference video',
            );

            const videoStart = videoWorkflow.videoStart;
            const audioStart = videoWorkflow.audioStart;
            const audioDuration = videoWorkflow.audioDuration;
            const trimEndFrame = videoWorkflow.trimEndFrame ?? false;
            const firstFrameStrength = videoWorkflow.firstFrameStrength;
            const lastFrameStrength = videoWorkflow.lastFrameStrength;
            const sam2CoordinatesJson = (videoWorkflow.sam2CoordinatesJson ?? '').trim();

            let sam2Coordinates:
              | Array<{ x: number; y: number }>
              | undefined;
            if (sam2CoordinatesJson) {
              let parsed: unknown;
              try {
                parsed = JSON.parse(sam2CoordinatesJson);
              } catch {
                throw new NodeOperationError(
                  this.getNode(),
                  'SAM2 Coordinates must be valid JSON, e.g. [{"x":0.5,"y":0.5}]',
                  { itemIndex: i },
                );
              }

              if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new NodeOperationError(
                  this.getNode(),
                  'SAM2 Coordinates must be a non-empty JSON array.',
                  { itemIndex: i },
                );
              }

              sam2Coordinates = parsed.map((point: any, pointIndex: number) => {
                const x = Number(point?.x);
                const y = Number(point?.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                  throw new NodeOperationError(
                    this.getNode(),
                    `SAM2 coordinate at index ${pointIndex} must include numeric x and y values.`,
                    { itemIndex: i },
                  );
                }
                return { x, y };
              });
            }

            const enableVideoControlNet = videoWorkflow.enableVideoControlNet ?? false;
            const videoControlNetType = (videoWorkflow.videoControlNetType ??
              'canny') as VideoControlNetName;
            const videoControlNetStrength = videoWorkflow.videoControlNetStrength;

            // Timeout defaults for video (longer than image)
            const resolvedTimeoutMs =
              typeof timeoutInput === 'number' && !Number.isNaN(timeoutInput)
                ? timeoutInput
                : videoNetwork === 'fast'
                ? 120_000 // 2 minutes for fast video
                : 1200_000; // 20 minutes for relaxed video

            // Build video project config
            const videoProjectConfig: any = {
              modelId: videoModelId,
              positivePrompt: videoPositivePrompt,
              negativePrompt,
              stylePrompt,
              frames,
              duration,
              fps,
              steps,
              guidance,
              shift,
              teacacheThreshold,
              numberOfMedia,
              network: videoNetwork,
              tokenType,
              outputFormat,
              width,
              height,
              seed,
              sampler,
              scheduler,
              referenceImage,
              referenceImageEnd,
              referenceAudio,
              referenceVideo,
              videoStart,
              audioStart,
              audioDuration,
              trimEndFrame,
              firstFrameStrength,
              lastFrameStrength,
              sam2Coordinates,
              autoResizeVideoAssets,
              waitForCompletion: true,
              timeout: resolvedTimeoutMs,
            };

            if (enableVideoControlNet) {
              videoProjectConfig.controlNet = {
                name: videoControlNetType,
                strength: videoControlNetStrength,
              };
            }

            // Generate video
            const videoResult = await client.createVideoProject(videoProjectConfig);
            const vr: any = videoResult;

            // Prepare output data
            const videoProjectId = vr.projectId ?? vr.project?.id ?? undefined;

            const videoOutputData: INodeExecutionData = {
              json: {
                projectId: videoProjectId,
                modelId: videoModelId,
                prompt: videoPositivePrompt,
                videoUrls: vr.videoUrls || [],
                completed: vr.completed,
                jobs: Array.isArray(vr.jobs)
                  ? vr.jobs.map((job: any) => ({
                      id: job.id,
                      status: job.status,
                    }))
                  : undefined,
                // Surface returned metadata when available
                meta: {
                  network: videoNetwork,
                  tokenType,
                  resolved: {
                    frames,
                    requestedFrames,
                    duration,
                    fps,
                    steps,
                    guidance,
                    shift,
                    teacacheThreshold,
                    numberOfMedia,
                    sampler,
                    scheduler,
                    videoStart,
                    audioStart,
                    audioDuration,
                    trimEndFrame,
                    firstFrameStrength,
                    lastFrameStrength,
                    timeoutMs: resolvedTimeoutMs,
                    autoResizeVideoAssets,
                    videoControlNet:
                      enableVideoControlNet
                        ? {
                            type: videoControlNetType,
                            strength: videoControlNetStrength,
                          }
                        : undefined,
                    providedAssets: {
                      referenceImage: !!referenceImage,
                      referenceImageEnd: !!referenceImageEnd,
                      referenceAudio: !!referenceAudio,
                      referenceVideo: !!referenceVideo,
                      sam2Coordinates: sam2Coordinates?.length ?? 0,
                    },
                  },
                  cost: vr.cost ?? vr.costTokens ?? vr.tokensUsed ?? vr.tokenCost ?? undefined,
                  queuePosition: vr.queuePosition ?? vr.queue?.position ?? vr.position ?? undefined,
                  latencies: {
                    queueMs:
                      vr.queueTimeMs ?? vr.latencies?.queueMs ?? vr.metrics?.queueTimeMs ?? undefined,
                    generationMs:
                      vr.generationTimeMs ??
                      vr.latencies?.generationMs ??
                      vr.metrics?.generationTimeMs ??
                      undefined,
                    totalMs:
                      vr.totalTimeMs ?? vr.latencies?.totalMs ?? vr.metrics?.totalTimeMs ?? undefined,
                  },
                  workerId: vr.workerId ?? vr.worker?.id ?? undefined,
                  modelVersion: vr.modelVersion ?? vr.model?.version ?? undefined,
                  raw: vr.meta ?? vr.metadata ?? undefined,
                },
              },
              binary: {},
            };

            // Download videos using native fetch
            if (downloadVideos !== false && vr.videoUrls && vr.videoUrls.length > 0) {
              for (let vidIndex = 0; vidIndex < vr.videoUrls.length; vidIndex++) {
                const videoUrl = vr.videoUrls[vidIndex];

                try {
                  let headers: Record<string, string> = {};

                  const resp = await fetch(videoUrl);
                  if (!resp.ok) {
                    throw new Error(`Failed to download video: ${resp.status} ${resp.statusText}`);
                  }
                  const arrayBuffer = await resp.arrayBuffer();
                  const bodyBuffer = Buffer.from(arrayBuffer);

                  // normalize fetch headers
                  headers = {};
                  resp.headers.forEach((v, k) => {
                    headers[k.toLowerCase()] = v;
                  });

                  const headerCt = headers['content-type'] || (headers as any)['Content-Type'];
                  const mimeType = headerCt || `video/${outputFormat}`;
                  const headerCd =
                    headers['content-disposition'] || (headers as any)['Content-Disposition'];
                  const cdFilename = parseContentDispositionFilename(headerCd);

                  const defaultNameBase = (videoProjectId ?? 'sogni_video') + `_${vidIndex}`;
                  const filename = cdFilename || `${defaultNameBase}.${outputFormat}`;

                  const binaryPropertyName = vidIndex === 0 ? 'video' : `video_${vidIndex}`;

                  videoOutputData.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
                    bodyBuffer,
                    filename,
                    mimeType,
                  );
                } catch (downloadError) {
                  // If download fails, still include the URL
                  // eslint-disable-next-line no-console
                  console.error(`Failed to download video ${vidIndex}:`, downloadError);
                }
              }
            }

            returnData.push(videoOutputData);
          } else if (resource === 'video' && operation === 'estimateCost') {
            const modelId = this.getNodeParameter('videoModelId', i) as string;
            const width = this.getNodeParameter('videoEstimateWidth', i) as number;
            const height = this.getNodeParameter('videoEstimateHeight', i) as number;
            const fps = this.getNodeParameter('videoEstimateFps', i) as number;
            const steps = this.getNodeParameter('videoEstimateSteps', i) as number;
            const duration = this.getNodeParameter('videoEstimateDuration', i) as number;
            const framesInput = this.getNodeParameter('videoEstimateFrames', i, undefined) as
              | number
              | undefined;
            const numberOfMedia = this.getNodeParameter('videoEstimateNumberOfMedia', i) as number;
            const tokenType = this.getNodeParameter('videoEstimateTokenType', i) as 'spark' | 'sogni';

            const estimateParams: any = {
              modelId,
              width,
              height,
              fps,
              steps,
              duration,
              numberOfMedia,
              tokenType,
            };

            if (typeof framesInput === 'number' && !Number.isNaN(framesInput) && framesInput > 0) {
              estimateParams.frames = normalizeRequestedVideoFrames(modelId, framesInput);
            }

            const estimate = await client.estimateVideoCost(estimateParams);

            returnData.push({
              json: {
                modelId,
                parameters: estimateParams,
                estimate,
              },
            });
          } else if (resource === 'llm' && operation === 'generate') {
            const model = this.getNodeParameter('llmModelId', i) as string;
            const prompt = this.getNodeParameter('llmPrompt', i) as string;
            const systemPrompt = (this.getNodeParameter('llmSystemPrompt', i, '') as string).trim();
            const additional = (this.getNodeParameter('llmAdditionalFields', i, {}) as any) || {};
            const maxTokens = additional.maxTokens as number | undefined;
            const messagesJson = String(additional.messagesJson ?? '').trim();
            const think = additional.think ?? false;
            const useSogniHostedTools = additional.useSogniHostedTools === true;
            const toolsJson = String(additional.toolsJson ?? '').trim();
            const toolChoiceJson = String(additional.toolChoiceJson ?? '').trim();
            const tokenType = (additional.tokenType ?? 'spark') as 'spark' | 'sogni';

            await client.waitForChatModels(CHAT_MODEL_EXECUTION_TIMEOUT_MS);

            const messages = messagesJson
              ? parseJsonParameter<any[]>(messagesJson, 'Messages JSON')
              : (() => {
                  const baseMessages: Array<{ role: 'system' | 'user'; content: string }> = [];
                  if (systemPrompt) {
                    baseMessages.push({ role: 'system', content: systemPrompt });
                  }
                  baseMessages.push({ role: 'user', content: prompt });
                  return baseMessages;
                })();

            if (!Array.isArray(messages) || messages.length === 0) {
              throw new Error('Messages JSON must be a non-empty array when provided');
            }

            const userTools = toolsJson
              ? parseJsonParameter<any[]>(toolsJson, 'Tools JSON')
              : undefined;
            if (toolsJson && !Array.isArray(userTools)) {
              throw new Error('Tools JSON must be an array when provided');
            }

            // Build the final tools array. When the hosted-tools toggle is on we
            // start from the Sogni manifest; any user-provided entry with the same
            // function name takes precedence.
            let tools: any[] | undefined;
            if (useSogniHostedTools) {
              const hostedTools = getHostedTools();
              const userNames = new Set(
                (userTools ?? [])
                  .map((t: any) => t?.function?.name)
                  .filter((n: any): n is string => typeof n === 'string'),
              );
              tools = [
                ...hostedTools.filter((tool) => {
                  const toolName = tool.function?.name;
                  return typeof toolName !== 'string' || !userNames.has(toolName);
                }),
                ...(userTools ?? []),
              ];
            } else {
              tools = userTools;
            }

            let toolChoice: any = undefined;
            if (toolChoiceJson) {
              if (toolChoiceJson === 'auto' || toolChoiceJson === 'none' || toolChoiceJson === 'required') {
                toolChoice = toolChoiceJson;
              } else {
                toolChoice = parseJsonParameter<any>(toolChoiceJson, 'Tool Choice JSON');
              }
            }

            const result = await client.createChatCompletion({
              model,
              messages,
              tools,
              tool_choice: toolChoice,
              max_tokens:
                typeof maxTokens === 'number' && !Number.isNaN(maxTokens) ? maxTokens : undefined,
              think,
              tokenType,
            } as any);

            const inputJson = items[i]?.json ?? {};

            returnData.push({
              json: {
                ...inputJson,
                modelId: model,
                prompt,
                systemPrompt: systemPrompt || undefined,
                messages,
                tools,
                toolChoice,
                useSogniHostedTools,
                content: (result as any).content || '',
                finishReason: (result as any).finishReason,
                jobId: (result as any).jobID,
                toolCalls: (result as any).tool_calls,
                usage: (result as any).usage,
                response: result,
              },
            });
          } else if (resource === 'llm' && operation === 'estimateCost') {
            const model = this.getNodeParameter('llmModelId', i) as string;
            const prompt = this.getNodeParameter('llmPrompt', i) as string;
            const systemPrompt = (this.getNodeParameter('llmSystemPrompt', i, '') as string).trim();
            const additional = (this.getNodeParameter('llmAdditionalFields', i, {}) as any) || {};
            const maxTokens = additional.maxTokens as number | undefined;
            const messagesJson = String(additional.messagesJson ?? '').trim();
            const tokenType = (additional.tokenType ?? 'spark') as 'spark' | 'sogni';

            await client.waitForChatModels(CHAT_MODEL_EXECUTION_TIMEOUT_MS);

            const messages = messagesJson
              ? parseJsonParameter<any[]>(messagesJson, 'Messages JSON')
              : (() => {
                  const baseMessages: Array<{ role: 'system' | 'user'; content: string }> = [];
                  if (systemPrompt) {
                    baseMessages.push({ role: 'system', content: systemPrompt });
                  }
                  baseMessages.push({ role: 'user', content: prompt });
                  return baseMessages;
                })();

            if (!Array.isArray(messages) || messages.length === 0) {
              throw new Error('Messages JSON must be a non-empty array when provided');
            }

            const estimate = await client.estimateChatCost({
              model,
              messages: messages as any,
              max_tokens:
                typeof maxTokens === 'number' && !Number.isNaN(maxTokens) ? maxTokens : undefined,
              tokenType,
            });

            returnData.push({
              json: {
                modelId: model,
                parameters: {
                  prompt,
                  systemPrompt: systemPrompt || undefined,
                  maxTokens,
                  tokenType,
                  messages,
                },
                estimate,
              },
            });
          } else if (resource === 'llm' && operation === 'getAll') {
            const models = await client.waitForChatModels(CHAT_MODEL_EXECUTION_TIMEOUT_MS);

            Object.entries(models).forEach(([id, info]) => {
              returnData.push({
                json: {
                  id,
                  workerCount: (info as any)?.workers ?? 0,
                  ...info,
                },
              });
            });
          } else if (resource === 'model' && operation === 'getAll') {
            // Get All Models
            const options = this.getNodeParameter('options', i, {}) as any;
            const models = await client.getAvailableModels({
              sortByWorkers: options.sortByWorkers !== false,
              minWorkers: options.minWorkers || 0,
            });

            (models as any[]).forEach((model: any) => {
              returnData.push({
                json: {
                  id: model.id,
                  name: model.name,
                  workerCount: model.workerCount,
                  recommendedSettings: model.recommendedSettings,
                },
              });
            });
          } else if (resource === 'model' && operation === 'get') {
            // Get Specific Model
            const modelId = this.getNodeParameter('modelId', i) as string;
            const model = await client.getModel(modelId);

            returnData.push({
              json: {
                id: model.id,
                name: model.name,
                workerCount: model.workerCount,
                recommendedSettings: model.recommendedSettings,
              },
            });
          } else if (resource === 'model' && operation === 'getPopular') {
            // Get Most Popular Model — convenience for "pick whatever has the
            // most workers right now" without two round trips.
            const model = await client.getMostPopularModel();

            returnData.push({
              json: {
                id: (model as any).id,
                name: (model as any).name,
                workerCount: (model as any).workerCount,
                recommendedSettings: (model as any).recommendedSettings,
              },
            });
          } else if (resource === 'account' && operation === 'getBalance') {
            // Get Balance
            const balance = await client.getBalance();

            returnData.push({
              json: {
                sogni: balance.sogni,
                spark: balance.spark,
              },
            });
          } else if (resource === 'audio' && operation === 'generate') {
            const audioModelId = this.getNodeParameter('audioModelId', i) as string;
            const audioPositivePrompt = this.getNodeParameter('audioPositivePrompt', i) as string;
            const audioNetwork = this.getNodeParameter('audioNetwork', i) as 'fast' | 'relaxed';
            const audioDuration = this.getNodeParameter('audioDuration', i) as number;

            const audioAdditional = (this.getNodeParameter('audioAdditionalFields', i, {}) as any) || {};
            const musicAndLyrics = (audioAdditional.musicAndLyrics ?? {}) as any;
            const genSettings = (audioAdditional.generationSettings ?? {}) as any;
            const output = (audioAdditional.output ?? {}) as any;
            const advanced = (audioAdditional.advanced ?? {}) as any;

            const numberOfMedia = (genSettings.numberOfMedia as number | undefined) ?? 1;
            const negativePrompt = (genSettings.negativePrompt as string | undefined)?.trim() || undefined;
            const stylePrompt = (genSettings.stylePrompt as string | undefined)?.trim() || undefined;
            const steps = genSettings.steps as number | undefined;
            const guidance = genSettings.guidance as number | undefined;
            const seed = genSettings.seed as number | undefined;

            const lyrics = (musicAndLyrics.lyrics as string | undefined)?.trim() || undefined;
            const language = (musicAndLyrics.language as string | undefined)?.trim() || undefined;
            const bpm = musicAndLyrics.bpm as number | undefined;
            const timesignature =
              (musicAndLyrics.timesignature as string | undefined)?.trim() || undefined;
            const keyscale = (musicAndLyrics.keyscale as string | undefined)?.trim() || undefined;
            const composerMode = musicAndLyrics.composerMode as boolean | undefined;
            const promptStrength = musicAndLyrics.promptStrength as number | undefined;
            const creativity = musicAndLyrics.creativity as number | undefined;
            const shift = musicAndLyrics.shift as number | undefined;
            const sampler = (musicAndLyrics.sampler as string | undefined)?.trim() || undefined;
            const scheduler = (musicAndLyrics.scheduler as string | undefined)?.trim() || undefined;

            const downloadAudios = output.downloadAudios !== false;
            const outputFormat = (output.outputFormat as 'mp3' | 'flac' | 'wav' | undefined) || 'mp3';

            const tokenType = (advanced.tokenType as 'spark' | 'sogni' | undefined) || 'spark';
            const explicitTimeout = advanced.timeout as number | undefined;
            const resolvedTimeoutMs =
              typeof explicitTimeout === 'number' && !Number.isNaN(explicitTimeout)
                ? explicitTimeout
                : audioNetwork === 'relaxed'
                  ? 1200000
                  : 120000;

            const audioConfig: any = {
              modelId: audioModelId,
              positivePrompt: audioPositivePrompt,
              numberOfMedia,
              duration: audioDuration,
              network: audioNetwork,
              tokenType,
              waitForCompletion: true,
              timeout: resolvedTimeoutMs,
              outputFormat,
            };

            if (negativePrompt !== undefined) audioConfig.negativePrompt = negativePrompt;
            if (stylePrompt !== undefined) audioConfig.stylePrompt = stylePrompt;
            if (typeof steps === 'number' && !Number.isNaN(steps)) audioConfig.steps = steps;
            if (typeof guidance === 'number' && !Number.isNaN(guidance)) audioConfig.guidance = guidance;
            if (typeof seed === 'number' && !Number.isNaN(seed)) audioConfig.seed = seed;

            if (lyrics !== undefined) audioConfig.lyrics = lyrics;
            if (language !== undefined) audioConfig.language = language;
            if (typeof bpm === 'number' && !Number.isNaN(bpm)) audioConfig.bpm = bpm;
            if (timesignature !== undefined) audioConfig.timesignature = timesignature;
            if (keyscale !== undefined) audioConfig.keyscale = keyscale;
            if (typeof composerMode === 'boolean') audioConfig.composerMode = composerMode;
            if (typeof promptStrength === 'number' && !Number.isNaN(promptStrength)) {
              audioConfig.promptStrength = promptStrength;
            }
            if (typeof creativity === 'number' && !Number.isNaN(creativity)) {
              audioConfig.creativity = creativity;
            }
            if (typeof shift === 'number' && !Number.isNaN(shift)) audioConfig.shift = shift;
            if (sampler !== undefined) audioConfig.sampler = sampler;
            if (scheduler !== undefined) audioConfig.scheduler = scheduler;

            const ar = await client.createAudioProject(audioConfig);
            const audioProjectId =
              (ar as any).projectId ?? (ar as any).project?.id ?? (ar as any).project?.projectId;

            const audioOutputData: INodeExecutionData = {
              json: {
                projectId: audioProjectId,
                audioUrls: ar.audioUrls,
                completed: ar.completed,
                jobsCount: ar.jobs?.length || 0,
                error: ar.error,
                meta: {
                  modelId: audioModelId,
                  network: audioNetwork,
                  tokenType,
                  parameters: {
                    positivePrompt: audioPositivePrompt,
                    negativePrompt,
                    stylePrompt,
                    duration: audioDuration,
                    numberOfMedia,
                    steps,
                    guidance,
                    seed,
                    lyrics,
                    language,
                    bpm,
                    timesignature,
                    keyscale,
                    composerMode,
                    promptStrength,
                    creativity,
                    shift,
                    sampler,
                    scheduler,
                    outputFormat,
                    timeoutMs: resolvedTimeoutMs,
                  },
                },
              },
              binary: {},
            };

            if (downloadAudios && ar.audioUrls && ar.audioUrls.length > 0) {
              for (let aIndex = 0; aIndex < ar.audioUrls.length; aIndex++) {
                const audioUrl = ar.audioUrls[aIndex];

                try {
                  const resp = await fetch(audioUrl);
                  if (!resp.ok) {
                    throw new Error(`Failed to download audio: ${resp.status} ${resp.statusText}`);
                  }
                  const arrayBuffer = await resp.arrayBuffer();
                  const bodyBuffer = Buffer.from(arrayBuffer);

                  const headers: Record<string, string> = {};
                  resp.headers.forEach((v, k) => {
                    headers[k.toLowerCase()] = v;
                  });

                  const headerCt = headers['content-type'];
                  const fallbackMime =
                    outputFormat === 'wav'
                      ? 'audio/wav'
                      : outputFormat === 'flac'
                        ? 'audio/flac'
                        : 'audio/mpeg';
                  const mimeType = headerCt || fallbackMime;
                  const headerCd = headers['content-disposition'];
                  const cdFilename = parseContentDispositionFilename(headerCd);

                  const defaultNameBase = (audioProjectId ?? 'sogni_audio') + `_${aIndex}`;
                  const filename = cdFilename || `${defaultNameBase}.${outputFormat}`;

                  const binaryPropertyName = aIndex === 0 ? 'audio' : `audio_${aIndex}`;

                  audioOutputData.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
                    bodyBuffer,
                    filename,
                    mimeType,
                  );
                } catch (downloadError) {
                  // If download fails, still include the URL
                  // eslint-disable-next-line no-console
                  console.error(`Failed to download audio ${aIndex}:`, downloadError);
                }
              }
            }

            returnData.push(audioOutputData);
          } else if (resource === 'audio' && operation === 'estimateCost') {
            const audioModelId = this.getNodeParameter('audioModelId', i) as string;
            const duration = this.getNodeParameter('audioEstimateDuration', i) as number;
            const steps = this.getNodeParameter('audioEstimateSteps', i) as number;
            const numberOfMedia = this.getNodeParameter('audioEstimateNumberOfMedia', i) as number;
            const tokenType = this.getNodeParameter('audioEstimateTokenType', i) as 'spark' | 'sogni';

            const estimateParams = {
              modelId: audioModelId,
              duration,
              steps,
              numberOfMedia,
              tokenType,
            };

            const estimate = await client.estimateAudioCost(estimateParams);

            returnData.push({
              json: {
                modelId: audioModelId,
                parameters: estimateParams,
                estimate,
              },
            });
          } else if (resource === 'creativeWorkflow' && operation === 'start') {
            const startMode = this.getNodeParameter('cwStartMode', i) as 'template' | 'inline';
            const wait = this.getNodeParameter('cwWait', i, false) as boolean;
            const additional =
              (this.getNodeParameter('cwStartAdditionalFields', i, {}) as any) || {};

            const tokenType = (additional.tokenType as 'spark' | 'sogni' | undefined) || 'spark';
            const appSource = (additional.appSource as string | undefined) || 'n8n-nodes-sogni';
            const idempotencyKey = (additional.idempotencyKey as string | undefined)?.trim() || undefined;
            const maxEstimatedCapacityUnits = additional.maxEstimatedCapacityUnits as number | undefined;
            const confirmCost =
              typeof additional.confirmCost === 'boolean' ? additional.confirmCost : undefined;
            const mediaReferencesJson =
              String(additional.mediaReferencesJson ?? '').trim() || undefined;
            const pollTimeoutMs = (additional.pollTimeoutMs as number | undefined) ?? 600000;

            const startParams: any = {
              tokenType,
              appSource,
            };
            if (idempotencyKey) startParams.idempotencyKey = idempotencyKey;
            if (typeof maxEstimatedCapacityUnits === 'number' && !Number.isNaN(maxEstimatedCapacityUnits)) {
              startParams.maxEstimatedCapacityUnits = maxEstimatedCapacityUnits;
            }
            if (typeof confirmCost === 'boolean') startParams.confirmCost = confirmCost;
            if (mediaReferencesJson) {
              const parsedRefs = parseJsonParameter<any[]>(mediaReferencesJson, 'Media References JSON');
              if (!Array.isArray(parsedRefs)) {
                throw new Error('Media References JSON must be an array when provided');
              }
              startParams.mediaReferences = parsedRefs;
            }

            if (startMode === 'template') {
              const templateId = (this.getNodeParameter('cwTemplateId', i) as string).trim();
              if (!templateId) {
                throw new Error('Template ID is required when Start Mode is "Saved Template"');
              }
              startParams.workflowId = templateId;
              const inputsJson = String(this.getNodeParameter('cwInputsJson', i, '') as string).trim();
              if (inputsJson) {
                const parsedInputs = parseJsonParameter<Record<string, unknown>>(
                  inputsJson,
                  'Inputs JSON',
                );
                if (!parsedInputs || typeof parsedInputs !== 'object' || Array.isArray(parsedInputs)) {
                  throw new Error('Inputs JSON must be an object when provided');
                }
                startParams.inputs = parsedInputs;
              }
            } else {
              const inputJson = String(this.getNodeParameter('cwInputJson', i) as string).trim();
              if (!inputJson) {
                throw new Error('Inline Workflow JSON is required when Start Mode is "Inline Plan"');
              }
              const parsedInput = parseJsonParameter<any>(inputJson, 'Inline Workflow JSON');
              if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
                throw new Error('Inline Workflow JSON must be an object containing a steps array');
              }
              if (!Array.isArray(parsedInput.steps) || parsedInput.steps.length === 0) {
                throw new Error('Inline Workflow JSON must contain a non-empty steps[] array');
              }
              startParams.input = parsedInput;
            }

            const record = await client.startCreativeWorkflow(startParams);
            const workflowId = (record as any)?.workflowId as string | undefined;

            let finalRecord: any = record;
            let polled = false;
            let timedOut = false;

            if (wait && workflowId) {
              polled = true;
              // Follows the workflow's event stream; never polls it (see creativeWorkflowWait.ts).
              ({ record: finalRecord, timedOut } = await waitForCreativeWorkflow(client, workflowId, {
                timeoutMs: pollTimeoutMs,
              }));
            }

            returnData.push({
              json: {
                workflowId,
                status: (finalRecord as any)?.status,
                waited: polled,
                timedOut,
                record: finalRecord,
              },
            });
          } else if (resource === 'creativeWorkflow' && operation === 'get') {
            const workflowId = (this.getNodeParameter('cwWorkflowId', i) as string).trim();
            if (!workflowId) {
              throw new Error('Workflow ID is required');
            }
            const record = await client.getCreativeWorkflow(workflowId);
            returnData.push({
              json: {
                workflowId: (record as any)?.workflowId ?? workflowId,
                status: (record as any)?.status,
                record,
              },
            });
          } else if (resource === 'creativeWorkflow' && operation === 'list') {
            const limit = this.getNodeParameter('cwListLimit', i) as number;
            const offset = this.getNodeParameter('cwListOffset', i) as number;
            const records = await client.listCreativeWorkflows({ limit, offset });

            (records as any[]).forEach((record: any) => {
              returnData.push({
                json: {
                  workflowId: record?.workflowId,
                  status: record?.status,
                  title: record?.title,
                  createdAt: record?.createdAt ?? record?.createTime,
                  updatedAt: record?.updatedAt ?? record?.updateTime,
                  record,
                },
              });
            });
          } else if (resource === 'creativeWorkflow' && operation === 'events') {
            const workflowId = (this.getNodeParameter('cwWorkflowId', i) as string).trim();
            if (!workflowId) {
              throw new Error('Workflow ID is required');
            }
            const events = await client.getCreativeWorkflowEvents(workflowId);
            (events as any[]).forEach((event: any) => {
              returnData.push({
                json: {
                  workflowId,
                  ...event,
                },
              });
            });
          } else if (resource === 'creativeWorkflow' && operation === 'cancel') {
            const workflowId = (this.getNodeParameter('cwWorkflowId', i) as string).trim();
            if (!workflowId) {
              throw new Error('Workflow ID is required');
            }
            const record = await client.cancelCreativeWorkflow(workflowId);
            const cancelStatus = String((record as any)?.status ?? '');
            returnData.push({
              json: {
                workflowId: (record as any)?.workflowId ?? workflowId,
                status: (record as any)?.status,
                // Derived from the returned record, not assumed. The server can
                // return the workflow in any state (already-completed runs are a
                // no-op cancel) so we report what the server actually says.
                cancelled: cancelStatus === 'cancelled' || cancelStatus === 'canceled',
                record,
              },
            });
          }
        } catch (error) {
          if (this.continueOnFail()) {
            returnData.push({
              json: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
            continue;
          }
          throw error;
        }
      }

      return [returnData];
    } finally {
      // Always disconnect (best-effort; includes hard-close fallback)
      await safeDisconnect(client, { label: 'execute', appId, timeoutMs: 5000 });
    }
  }
}
