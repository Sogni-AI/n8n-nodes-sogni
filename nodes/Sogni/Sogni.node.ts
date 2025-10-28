import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
  IBinaryData,
} from 'n8n-workflow';

import { SogniClientWrapper, SogniError, ControlNetName } from '@sogni-ai/sogni-client-wrapper';

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
          {
            name: 'Image',
            value: 'image',
          },
          {
            name: 'Model',
            value: 'model',
          },
          {
            name: 'Account',
            value: 'account',
          },
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
          show: {
            resource: ['image'],
          },
        },
        options: [
          {
            name: 'Generate',
            value: 'generate',
            description: 'Generate AI images',
            action: 'Generate an image',
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
          show: {
            resource: ['model'],
          },
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
        displayOptions: {
          show: {
            resource: ['account'],
          },
        },
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
      {
        displayName: 'Model ID',
        name: 'modelId',
        type: 'string',
        required: true,
        displayOptions: {
          show: {
            resource: ['image'],
            operation: ['generate'],
          },
        },
        default: 'flux1-schnell-fp8',
        description: 'The AI model to use for generation',
        placeholder: 'flux1-schnell-fp8',
      },
      {
        displayName: 'Positive Prompt',
        name: 'positivePrompt',
        type: 'string',
        required: true,
        displayOptions: {
          show: {
            resource: ['image'],
            operation: ['generate'],
          },
        },
        default: '',
        typeOptions: {
          rows: 4,
        },
        description: 'Text description of what you want to generate',
        placeholder: 'A beautiful sunset over mountains, vibrant colors, photorealistic',
      },
      {
        displayName: 'Network',
        name: 'network',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['image'],
            operation: ['generate'],
          },
        },
        options: [
          {
            name: 'Fast',
            value: 'fast',
            description: 'Faster generation, uses SOGNI tokens',
          },
          {
            name: 'Relaxed',
            value: 'relaxed',
            description: 'Slower but cheaper, uses Spark tokens',
          },
        ],
        default: 'relaxed',
        description: 'Network type to use',
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: {
            resource: ['image'],
            operation: ['generate'],
          },
        },
        options: [
          {
            displayName: 'Negative Prompt',
            name: 'negativePrompt',
            type: 'string',
            default: '',
            typeOptions: {
              rows: 2,
            },
            description: 'Text description of what you don\'t want to see',
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
            typeOptions: {
              minValue: 1,
              maxValue: 10,
            },
          },
          {
            displayName: 'Steps',
            name: 'steps',
            type: 'number',
            default: 20,
            description: 'Number of inference steps. More steps = better quality but slower. Flux models work best with 4 steps.',
            typeOptions: {
              minValue: 1,
              maxValue: 100,
            },
          },
          {
            displayName: 'Guidance',
            name: 'guidance',
            type: 'number',
            default: 7.5,
            description: 'How closely to follow the prompt. 7.5 is optimal for most models.',
            typeOptions: {
              minValue: 0,
              maxValue: 30,
              numberPrecision: 1,
            },
          },
          {
            displayName: 'Token Type',
            name: 'tokenType',
            type: 'options',
            options: [
              {
                name: 'Spark',
                value: 'spark',
              },
              {
                name: 'SOGNI',
                value: 'sogni',
              },
            ],
            default: 'spark',
            description: 'Token type to use for payment',
          },
          {
            displayName: 'Output Format',
            name: 'outputFormat',
            type: 'options',
            options: [
              {
                name: 'PNG',
                value: 'png',
              },
              {
                name: 'JPG',
                value: 'jpg',
              },
            ],
            default: 'png',
            description: 'Output image format',
          },
          {
            displayName: 'Download Images',
            name: 'downloadImages',
            type: 'boolean',
            default: true,
            description: 'Whether to download images as binary data (recommended to avoid 24h URL expiry)',
          },
          {
            displayName: 'Size Preset',
            name: 'sizePreset',
            type: 'string',
            default: '',
            description: 'Size preset ID (e.g., "square_hd", "portrait_4_7"). Leave empty for default.',
            placeholder: 'square_hd',
          },
          {
            displayName: 'Custom Width',
            name: 'width',
            type: 'number',
            default: 1024,
            description: 'Custom width in pixels (256-2048). Only used if Size Preset is "custom".',
            typeOptions: {
              minValue: 256,
              maxValue: 2048,
            },
          },
          {
            displayName: 'Custom Height',
            name: 'height',
            type: 'number',
            default: 1024,
            description: 'Custom height in pixels (256-2048). Only used if Size Preset is "custom".',
            typeOptions: {
              minValue: 256,
              maxValue: 2048,
            },
          },
          {
            displayName: 'Seed',
            name: 'seed',
            type: 'number',
            default: undefined,
            description: 'Random seed for reproducibility. Leave empty for random.',
            placeholder: '12345',
          },
          {
            displayName: 'Timeout (ms)',
            name: 'timeout',
            type: 'number',
            default: 600000,
            description: 'Maximum time to wait for image generation in milliseconds (10 minutes for relaxed network)',
            typeOptions: {
              minValue: 30000,
            },
          },
          // ControlNet Section
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
              show: {
                '/additionalFields.enableControlNet': [true],
              },
            },
            options: [
              {
                name: 'Canny (Edge Detection)',
                value: 'canny',
                description: 'Detect edges in the control image',
              },
              {
                name: 'Scribble',
                value: 'scribble',
                description: 'Use hand-drawn scribbles as control',
              },
              {
                name: 'Line Art',
                value: 'lineart',
                description: 'Extract line art from control image',
              },
              {
                name: 'Line Art Anime',
                value: 'lineartanime',
                description: 'Extract anime-style line art',
              },
              {
                name: 'Soft Edge',
                value: 'softedge',
                description: 'Detect soft edges',
              },
              {
                name: 'Shuffle',
                value: 'shuffle',
                description: 'Shuffle control image',
              },
              {
                name: 'Tile',
                value: 'tile',
                description: 'Use tiling pattern',
              },
              {
                name: 'Inpaint',
                value: 'inpaint',
                description: 'Inpaint masked areas',
              },
              {
                name: 'InstructPix2Pix',
                value: 'instrp2p',
                description: 'Instruction-based image editing',
              },
              {
                name: 'Depth',
                value: 'depth',
                description: 'Use depth map',
              },
              {
                name: 'Normal Map',
                value: 'normalbae',
                description: 'Use normal map',
              },
              {
                name: 'OpenPose',
                value: 'openpose',
                description: 'Use pose detection',
              },
              {
                name: 'Segmentation',
                value: 'segmentation',
                description: 'Use semantic segmentation',
              },
              {
                name: 'MLSD (Line Segment)',
                value: 'mlsd',
                description: 'Mobile Line Segment Detection',
              },
              {
                name: 'InstantID',
                value: 'instantid',
                description: 'Instant identity preservation',
              },
            ],
            default: 'canny',
            description: 'Type of ControlNet to use',
          },
          {
            displayName: 'ControlNet Image (Binary Property)',
            name: 'controlNetImageProperty',
            type: 'string',
            displayOptions: {
              show: {
                '/additionalFields.enableControlNet': [true],
              },
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
              show: {
                '/additionalFields.enableControlNet': [true],
              },
            },
            default: 0.5,
            description: 'Control strength (0-1). 0 = full control to prompt, 1 = full control to ControlNet',
            typeOptions: {
              minValue: 0,
              maxValue: 1,
              numberPrecision: 2,
            },
          },
          {
            displayName: 'ControlNet Mode',
            name: 'controlNetMode',
            type: 'options',
            displayOptions: {
              show: {
                '/additionalFields.enableControlNet': [true],
              },
            },
            options: [
              {
                name: 'Balanced',
                value: 'balanced',
                description: 'Balanced between prompt and control',
              },
              {
                name: 'Prompt Priority',
                value: 'prompt_priority',
                description: 'Prompt has more impact',
              },
              {
                name: 'ControlNet Priority',
                value: 'cn_priority',
                description: 'ControlNet has more impact',
              },
            ],
            default: 'balanced',
            description: 'How to weight control and prompt',
          },
          {
            displayName: 'ControlNet Guidance Start',
            name: 'controlNetGuidanceStart',
            type: 'number',
            displayOptions: {
              show: {
                '/additionalFields.enableControlNet': [true],
              },
            },
            default: 0,
            description: 'Step when ControlNet first applied (0-1)',
            typeOptions: {
              minValue: 0,
              maxValue: 1,
              numberPrecision: 2,
            },
          },
          {
            displayName: 'ControlNet Guidance End',
            name: 'controlNetGuidanceEnd',
            type: 'number',
            displayOptions: {
              show: {
                '/additionalFields.enableControlNet': [true],
              },
            },
            default: 1,
            description: 'Step when ControlNet last applied (0-1)',
            typeOptions: {
              minValue: 0,
              maxValue: 1,
              numberPrecision: 2,
            },
          },
        ],
      },

      // ===== Model Get Parameters =====
      {
        displayName: 'Model ID',
        name: 'modelId',
        type: 'string',
        required: true,
        displayOptions: {
          show: {
            resource: ['model'],
            operation: ['get'],
          },
        },
        default: '',
        description: 'The ID of the model to retrieve',
        placeholder: 'flux1-schnell-fp8',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            resource: ['model'],
            operation: ['getAll'],
          },
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Get credentials
    const credentials = await this.getCredentials('sogniApi');

    // Generate unique appId per execution to avoid socket collisions
    const appId = credentials.appId as string || `n8n-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create Sogni client
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
            const network = this.getNodeParameter('network', i) as 'fast' | 'relaxed';
            const additionalFields = this.getNodeParameter('additionalFields', i, {}) as any;

            // Build project config
            const projectConfig: any = {
              modelId,
              positivePrompt,
              negativePrompt: additionalFields.negativePrompt || '',
              stylePrompt: additionalFields.stylePrompt || '',
              steps: additionalFields.steps || 20,
              guidance: additionalFields.guidance || 7.5,
              numberOfImages: additionalFields.numberOfImages || 1,
              network,
              tokenType: additionalFields.tokenType || 'spark',
              outputFormat: additionalFields.outputFormat || 'png',
              sizePreset: additionalFields.sizePreset,
              width: additionalFields.width,
              height: additionalFields.height,
              seed: additionalFields.seed,
              waitForCompletion: true,
              timeout: additionalFields.timeout || 600000,
            };

            // ControlNet support
            if (additionalFields.enableControlNet) {
              const controlNetType = additionalFields.controlNetType as ControlNetName;
              const imagePropertyName = additionalFields.controlNetImageProperty || 'data';
              
              // Get control image from binary data
              const binaryData = items[i].binary?.[imagePropertyName];
              if (!binaryData) {
                throw new NodeOperationError(
                  this.getNode(),
                  `No binary data found in property "${imagePropertyName}". Please provide a control image.`,
                  { itemIndex: i }
                );
              }

              // Convert binary data to Buffer
              const imageBuffer = await this.helpers.getBinaryDataBuffer(i, imagePropertyName);

              projectConfig.controlNet = {
                name: controlNetType,
                image: imageBuffer,
                strength: additionalFields.controlNetStrength || 0.5,
                mode: additionalFields.controlNetMode || 'balanced',
                guidanceStart: additionalFields.controlNetGuidanceStart || 0,
                guidanceEnd: additionalFields.controlNetGuidanceEnd || 1,
              };
            }

            // Generate image
            const result = await client.createProject(projectConfig);

            // Prepare output data
            const outputData: INodeExecutionData = {
              json: {
                projectId: result.project.id,
                modelId,
                prompt: positivePrompt,
                imageUrls: result.imageUrls || [],
                completed: result.completed,
                jobs: result.jobs?.map((job: any) => ({
                  id: job.id,
                  status: job.status,
                })),
              },
              binary: {},
            };

            // Download images if requested
            if (additionalFields.downloadImages !== false && result.imageUrls && result.imageUrls.length > 0) {
              for (let imgIndex = 0; imgIndex < result.imageUrls.length; imgIndex++) {
                const imageUrl = result.imageUrls[imgIndex];
                
                try {
                  const response = await fetch(imageUrl);
                  if (!response.ok) {
                    throw new Error(`Failed to download image: ${response.statusText}`);
                  }
                  
                  const arrayBuffer = await response.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);
                  
                  const binaryPropertyName = imgIndex === 0 ? 'image' : `image_${imgIndex}`;
                  const mimeType = additionalFields.outputFormat === 'jpg' ? 'image/jpeg' : 'image/png';
                  const fileExtension = additionalFields.outputFormat === 'jpg' ? 'jpg' : 'png';
                  
                  outputData.binary![binaryPropertyName] = await this.helpers.prepareBinaryData(
                    buffer,
                    `sogni_${result.project.id}_${imgIndex}.${fileExtension}`,
                    mimeType
                  );
                } catch (downloadError) {
                  // If download fails, still include the URL
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

            models.forEach((model: any) => {
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

