import type { JsonValue } from '../contracts/contributions';
import { CONTRIBUTIONS_VERSION } from './agent-plugin';

const STRING = { type: 'string' };
const BOOLEAN = { type: 'boolean' };
const TRUE = { const: true };
const STRINGS = { type: 'array', items: STRING };
const STRING_MAP = { type: 'object', additionalProperties: STRING };

// An object whose `required` fields must be set and which holds no other.
function record(
  properties: { [key: string]: JsonValue },
  required: string[] = [],
): JsonValue {
  return {
    type: 'object',
    required,
    properties,
    additionalProperties: false,
  };
}

const ref = (name: string): JsonValue => ({ $ref: `#/$defs/${name}` });

const PREDICATE = {
  anyOf: [
    { enum: ['idle', 'busy', 'planRead', 'planHasTasks', 'planOpen'] },
    record({ counterRose: STRING }, ['counterRose']),
  ],
};

const PREDICATES = { type: 'array', items: ref('predicate') };

const GUARDS = { from: STRINGS, when: PREDICATES };

const TRIGGER = {
  anyOf: [
    record(
      { skill: STRING, ...GUARDS, clearsPlan: TRUE, planFromArgs: TRUE },
      ['skill'],
    ),
    record({ step: STRING, ...GUARDS }, ['step']),
    record({ event: STRING, ...GUARDS, clearsPlan: TRUE }, ['event']),
  ],
};

const ACTIVITY = record(
  {
    word: STRING,
    tone: {
      enum: ['idle', 'running', 'success', 'warning', 'attention', 'error'],
    },
    emphasis: { enum: ['raised', 'urgent'] },
  },
  ['word', 'tone'],
);

const ACTION = record(
  {
    kind: { enum: ['send', 'clearAndSend', 'launch', 'openPlan', 'event'] },
    label: STRING,
    text: STRING,
    event: STRING,
    then: STRING,
    keyOnly: TRUE,
    risky: TRUE,
    key: STRING,
    available: PREDICATES,
    enabled: PREDICATES,
  },
  ['kind', 'label'],
);

const STAGE = record(
  {
    id: STRING,
    label: STRING,
    step: STRING,
    inStepper: BOOLEAN,
    slot: STRING,
    runsTasks: BOOLEAN,
    status: { enum: ['busy', 'finishing', 'ready', 'none'] },
    finishes: BOOLEAN,
    reopens: BOOLEAN,
    records: STRINGS,
    enter: { type: 'array', items: ref('trigger') },
    progress: STRING,
    chipProgress: STRING,
    detail: STRINGS,
    rowActivity: ref('activity'),
    unseenActivity: ref('activity'),
    actions: STRINGS,
    auto: STRING,
  },
  ['id', 'label', 'status', 'enter'],
);

const WORKFLOW = record(
  {
    id: STRING,
    label: STRING,
    badge: STRING,
    badgeColor: STRING,
    order: { type: 'number' },
    claims: STRINGS,
    groups: { type: 'object', additionalProperties: STRINGS },
    counters: {
      type: 'object',
      additionalProperties: record(
        { counts: STRING, resetOn: { const: 'claim' } },
        ['counts', 'resetOn'],
      ),
    },
    fixCycles: {
      anyOf: [
        record({ counter: STRING }, ['counter']),
        record({ planCounter: STRING }, ['planCounter']),
      ],
    },
    sidePane: record(
      { kind: { enum: ['checklist', 'plan'] }, title: STRING },
      ['kind', 'title'],
    ),
    actions: { type: 'object', additionalProperties: ref('action') },
    stages: { type: 'array', items: ref('stage') },
  },
  ['id', 'label', 'badge', 'order', 'claims', 'sidePane', 'stages'],
);

const PLAN_FORMAT = record({
  folder: STRING,
  file: STRING,
  tasksSection: STRING,
  groupHeading: record({ pattern: STRING, title: STRING }, [
    'pattern',
    'title',
  ]),
  titleSuffix: STRING,
  counters: {
    type: 'object',
    additionalProperties: record(
      { section: STRING, heading: STRING, itemPrefix: STRING },
      ['heading', 'itemPrefix'],
    ),
  },
  taskDocs: record(
    {
      link: { const: 'bareMd' },
      statusField: STRING,
      statusLines: { type: 'number' },
      statuses: STRINGS,
      running: STRING,
    },
    ['link', 'statusField', 'statusLines', 'statuses', 'running'],
  ),
  verificationTask: record({ lastTaskDocLacking: STRING }, [
    'lastTaskDocLacking',
  ]),
});

const RETRO = record(
  {
    label: STRING,
    command: STRING,
    folder: STRING,
    on: { type: 'array', items: { enum: ['close', 'clear'] } },
  },
  ['command', 'folder', 'on'],
);

const BACKLOG = record(
  {
    label: STRING,
    homes: STRINGS,
    file: STRING,
    areaFolder: STRING,
    assistant: record({ instructions: STRING }, ['instructions']),
  },
  ['homes', 'file'],
);

const DOCS = record({
  globalFolders: {
    type: 'array',
    items: record(
      {
        path: STRING,
        referenceFiles: STRINGS,
        subfolders: STRINGS,
        skip: STRINGS,
      },
      ['path'],
    ),
  },
  wikiMain: STRING,
  linkPrefixes: STRING_MAP,
});

const COMMAND_PATTERN = record(
  {
    program: STRING,
    words: STRINGS,
    valueFlags: STRINGS,
    projectPathFlag: STRING,
    projectPathVariable: STRING,
  },
  ['program', 'words'],
);

const LIVE_VIEW = record(
  {
    open: { type: 'array', items: ref('commandPattern') },
    close: { type: 'array', items: ref('commandPattern') },
    probe: record(
      { file: STRING, entry: STRING, runner: { const: 'unityScript' } },
      ['file', 'entry', 'runner'],
    ),
  },
  ['open', 'close'],
);

// The JSON schema of `AuriFile` (`src/contracts/contributions.ts`), which the
// app writes to `plugins/_types/auri.schema.json` for a plugin author's
// editor. A top-level key it does not list is allowed, as the app ignores it.
export const auriFileSchema: JsonValue = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'auri.json',
  type: 'object',
  required: ['version'],
  properties: {
    $schema: STRING,
    version: { const: CONTRIBUTIONS_VERSION },
    workflows: { type: 'array', items: ref('workflow') },
    planFormat: PLAN_FORMAT,
    retro: RETRO,
    backlog: BACKLOG,
    docs: DOCS,
    liveView: LIVE_VIEW,
  },
  $defs: {
    predicate: PREDICATE,
    trigger: TRIGGER,
    activity: ACTIVITY,
    action: ACTION,
    stage: STAGE,
    workflow: WORKFLOW,
    commandPattern: COMMAND_PATTERN,
  },
};
