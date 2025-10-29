import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
  ILoadOptionsFunctions,
  INodePropertyOptions,
} from 'n8n-workflow';

import { SogniClientWrapper, SogniError, ControlNetName } from '@sogni-ai/sogni-client-wrapper';

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
    description: 'Generate AI images using Sogni AI Supernet with ControlNet support',
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

      // Model picker with search (loadOptions)
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
        default: 'relaxed',
        description:
          'Network type to use. If timeout is left empty, this will imply 60s (fast) or 600s (relaxed).',
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
                name: 'numberOfImages',
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
        const appId =
          (credentials.appId as string) ||
          `n8n-model-picker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
          try {
            await client.disconnect();
          } catch {
            // ignore
          }
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Get credentials
    const credentials = await this.getCredentials('sogniApi');

    // Generate unique appId per execution to avoid socket collisions
    const appId =
      (credentials.appId as string) ||
      `n8n-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
            const networkTop = (this.getNodeParameter('network', i) as 'fast' | 'relaxed' | undefined);
            const networkLegacy = legacy.network as 'fast' | 'relaxed' | undefined;
            const network = (networkTop ?? networkLegacy ?? 'relaxed');

            const numberOfImages = gen.numberOfImages ?? legacy.numberOfImages ?? 1;
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
              numberOfImages,
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
            const result = await client.createProject(projectConfig);
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
                    numberOfImages,
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
      // Always disconnect
      await client.disconnect();
    }
  }
}
