import { PLUGIN_ID_PATTERN } from '../define-plugin';
import { BIND_WHERES, EDITOR_MODES } from '../plugin-manifests';
import {
  ARG_KINDS,
  PROCESS_NAMES,
  SETTING_KINDS,
  SHORT_ID_PATTERN,
  TOKEN_KINDS,
} from './validate-manifest';

const STRING = { type: 'string' };
const BOOLEAN = { type: 'boolean' };

// `dependsOn` and `reads`: a list of plugin ids per process.
const PLUGIN_LISTS = {
  type: 'object',
  required: PROCESS_NAMES,
  properties: Object.fromEntries(
    PROCESS_NAMES.map((process) => [process, { type: 'array', items: STRING }]),
  ),
  additionalProperties: false,
};

// A key's `arg`: a number, a string, or an object of those.
const ARG_VALUE = {
  anyOf: [
    { type: ['number', 'string'] },
    { type: 'object', additionalProperties: { type: ['number', 'string'] } },
  ],
};

const COMMAND = {
  type: 'object',
  required: ['label', 'group', 'runsIn'],
  properties: {
    label: STRING,
    group: STRING,
    runsIn: { enum: PROCESS_NAMES },
    arg: {
      anyOf: [
        { enum: ARG_KINDS },
        { type: 'object', additionalProperties: { enum: ARG_KINDS } },
      ],
    },
  },
  additionalProperties: false,
};

// A key list: an array of items holding `properties` and an optional `arg`.
function keyList(required: string[], properties: Record<string, object>) {
  return {
    type: 'array',
    items: {
      type: 'object',
      required,
      properties: { ...properties, arg: ARG_VALUE },
      additionalProperties: false,
    },
  };
}

const ACCELERATOR_LIST = keyList(['accelerator', 'command'], {
  accelerator: STRING,
  command: STRING,
});

const KEYS = {
  type: 'object',
  properties: {
    binds: keyList(['keys', 'scope', 'command'], {
      keys: STRING,
      scope: STRING,
      command: STRING,
      where: { enum: BIND_WHERES },
      mode: { enum: EDITOR_MODES },
    }),
    groups: { type: 'object', additionalProperties: STRING },
    app: ACCELERATOR_LIST,
    global: ACCELERATOR_LIST,
    intercept: keyList(['key', 'command'], {
      key: STRING,
      command: STRING,
      control: BOOLEAN,
      alt: BOOLEAN,
      shift: BOOLEAN,
      meta: BOOLEAN,
    }),
    remaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mode', 'keys', 'to'],
        properties: {
          mode: { enum: EDITOR_MODES },
          keys: { type: 'string', minLength: 1 },
          to: STRING,
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

// The JSON Schema of a user plugin's `manifest.json`: what a schema can state
// of the checks `validateManifest` makes, for an editor to check as it types.
export const manifestSchema: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Wigley plugin manifest',
  type: 'object',
  required: [
    'id',
    'label',
    'description',
    'dependsOn',
    'reads',
    'commands',
    'scopes',
    'settings',
    'settingInfo',
    'themeTokens',
  ],
  properties: {
    $schema: STRING,
    id: { type: 'string', pattern: PLUGIN_ID_PATTERN, not: { const: 'core' } },
    label: STRING,
    description: STRING,
    dependsOn: PLUGIN_LISTS,
    reads: PLUGIN_LISTS,
    commands: {
      type: 'object',
      propertyNames: { pattern: SHORT_ID_PATTERN },
      additionalProperties: COMMAND,
    },
    scopes: {
      type: 'object',
      propertyNames: { pattern: SHORT_ID_PATTERN, not: { const: 'any' } },
      additionalProperties: STRING,
    },
    keys: KEYS,
    settings: { type: 'object' },
    optionalSettings: {
      type: 'object',
      additionalProperties: { enum: SETTING_KINDS },
    },
    settingInfo: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['label', 'description'],
        properties: { label: STRING, description: STRING },
        additionalProperties: false,
      },
    },
    settingControls: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
    },
    themeTokens: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['kind', 'default'],
        properties: { kind: { enum: TOKEN_KINDS }, default: STRING },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
