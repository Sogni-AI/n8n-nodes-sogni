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
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: '',
      required: true,
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
