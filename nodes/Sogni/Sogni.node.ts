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

import { SogniClientWrapper, SogniError, ControlNetName } from '@sogni-ai/sogni-client-wrapper';

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

export class Sogni implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sogni AI',
    name: 'sogni',
    icon: 'file:sogni.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Generate AI images and videos using Sogni AI Supernet with ControlNet support',
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
          show: { resource: ['video'], operation: ['generate'] },
        },
      },
      {
        displayName: 'Model',
        name: 'videoModelId',
        type: 'options',
        required: true,
        displayOptions: {
          show: { resource: ['video'], operation: ['generate'] },
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
                  'Whether to download images as binary data (recommended to avoid 24h URL expiry)',
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
                description: 'Number of frames in the video (10-120)',
                typeOptions: { minValue: 10, maxValue: 120 },
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
            ],
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

        const client = new SogniClientWrapper({
          username: credentials.username as string,
          password: credentials.password as string,
          appId,
          autoConnect: true,
          debug: false,
        });

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

        const client = new SogniClientWrapper({
          username: credentials.username as string,
          password: credentials.password as string,
          appId,
          autoConnect: true,
          debug: false,
        });

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

          // Filter for video models (models that contain 'video', 'vid', 'animation', or 'motion' in their name/id)
          const videoModels = (models as any[]).filter((model: any) => {
            const name = (model.name || model.id || '').toLowerCase();
            return (
              name.includes('video') ||
              name.includes('vid') ||
              name.includes('animation') ||
              name.includes('motion') ||
              name.includes('animate')
            );
          });

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
    const client = new SogniClientWrapper({
      username: credentials.username as string,
      password: credentials.password as string,
      appId,
      autoConnect: true,
      debug: false,
    });

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
            const sizePreset = out.sizePreset ?? legacy.sizePreset;
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
          } else if (resource === 'video' && operation === 'generate') {
            // Video Generation
            const videoModelId = this.getNodeParameter('videoModelId', i) as string;
            const videoPositivePrompt = this.getNodeParameter('videoPositivePrompt', i) as string;
            const videoNetwork = this.getNodeParameter('videoNetwork', i) as 'fast' | 'relaxed';

            // Video additional fields
            const videoAdditional = (this.getNodeParameter('videoAdditionalFields', i, {}) as any) || {};
            const videoSettings = (videoAdditional.videoSettings as any) || {};
            const videoOutput = (videoAdditional.output as any) || {};
            const videoAdvanced = (videoAdditional.advanced as any) || {};

            // Extract video parameters
            const negativePrompt = videoSettings.negativePrompt ?? '';
            const stylePrompt = videoSettings.stylePrompt ?? '';
            const numberOfMedia = videoSettings.numberOfMedia ?? 1;
            const frames = videoSettings.frames ?? 30;
            const fps = videoSettings.fps ?? 30;
            const steps = videoSettings.steps ?? 20;
            const guidance = videoSettings.guidance ?? 7.5;
            const seed = videoSettings.seed;

            const downloadVideos = videoOutput.downloadVideos ?? true;
            const outputFormat = videoOutput.outputFormat ?? 'mp4';
            const width = videoOutput.width ?? 512;
            const height = videoOutput.height ?? 512;

            const tokenType = videoAdvanced.tokenType ?? 'spark';
            const timeoutInput = videoAdvanced.timeout;

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
              fps,
              steps,
              guidance,
              numberOfMedia,
              network: videoNetwork,
              tokenType,
              outputFormat,
              width,
              height,
              seed,
              waitForCompletion: true,
              timeout: resolvedTimeoutMs,
            };

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
                    fps,
                    steps,
                    guidance,
                    numberOfMedia,
                    timeoutMs: resolvedTimeoutMs,
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
          } else if (resource === 'account' && operation === 'getBalance') {
            // Get Balance
            const balance = await client.getBalance();

            returnData.push({
              json: {
                sogni: balance.sogni,
                spark: balance.spark,
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
