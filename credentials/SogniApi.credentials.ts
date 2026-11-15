import {
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class SogniApi implements ICredentialType {
  name = 'sogniApi';
  displayName = 'Sogni AI API';
  documentationUrl = 'https://sdk-docs.sogni.ai/';
  properties: INodeProperties[] = [
    {
      displayName: 'Authentication',
      name: 'authType',
      type: 'options',
      options: [
        {
          name: 'API Key',
          value: 'apiKey',
          description: 'Works with every account, including accounts with two-factor authentication',
        },
        {
          name: 'Username and Password',
          value: 'usernamePassword',
          description: 'Does not work for accounts with two-factor authentication turned on',
        },
      ],
      // Credentials saved before this field existed have no authType. n8n fills in this
      // default for them, so it must stay 'usernamePassword' or those credentials break.
      default: 'usernamePassword',
      description: 'How n8n signs in to Sogni. Accounts with two-factor authentication need an API key.',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['apiKey'],
        },
      },
      description:
        'Your Sogni API key. Log in to https://dashboard.sogni.ai and create one from the username menu in the top-right corner.',
    },
    {
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['usernamePassword'],
        },
      },
      description: 'Your Sogni AI account username',
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['usernamePassword'],
        },
      },
      description: 'Your Sogni AI account password',
    },
    {
      displayName: 'App ID',
      name: 'appId',
      type: 'string',
      default: '',
      description: 'Unique identifier for your application. Leave empty to auto-generate a UUID.',
      placeholder: 'e.g., my-n8n-workflow-12345',
    },
  ];
}
