// The types of `auri.json`, the file an agent plugin carries at its root to
// bind the app's features (docs/features/feature-contributions/design.md).
// Each top-level key but `version` and `$schema` is a feature key.

// What `JSON.parse` can return.
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FeatureKey =
  | 'workflows'
  | 'planFormat'
  | 'retro'
  | 'backlog'
  | 'docs'
  | 'liveView';

// Every feature key, in the order problems and Settings list them.
export const FEATURE_KEYS: readonly FeatureKey[] = [
  'workflows',
  'planFormat',
  'retro',
  'backlog',
  'docs',
  'liveView',
];

// The tones a row's activity shows in, the members of the page kit's
// `DotStatus`.
export type ActivityTone =
  | 'idle'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';

// How a row catches the eye: `raised` for a state the user may come to when
// ready, `urgent` for one blocked on the user.
export type RowEmphasis = 'raised' | 'urgent';

export interface AuriFile {
  $schema?: string;
  version: 1;
  workflows?: WorkflowDecl[];
  planFormat?: PlanFormat;
  retro?: RetroContribution;
  backlog?: BacklogContribution;
  docs?: DocsContribution;
  liveView?: LiveViewContribution;
}

export interface WorkflowDecl {
  id: string;
  label: string;
  badge: string;
  badgeColor?: string;
  order: number;
  claims: string[];
  groups?: Record<string, string[]>;
  counters?: Record<string, CounterDecl>;
  fixCycles?: { counter: string } | { planCounter: string };
  sidePane: { kind: 'checklist' | 'plan'; title: string };
  actions?: Record<string, ActionDecl>;
  stages: StageDecl[];
}

export interface StageDecl {
  id: string;
  label: string;
  step?: string;
  inStepper?: boolean;
  slot?: string;
  runsTasks?: boolean;
  status: 'busy' | 'finishing' | 'ready' | 'none';
  finishes?: boolean;
  reopens?: boolean;
  records?: string[];
  enter: TriggerDecl[];
  progress?: string;
  chipProgress?: string;
  detail?: string[];
  rowActivity?: ActivityDecl;
  unseenActivity?: ActivityDecl;
  actions?: string[];
  auto?: string;
}

export type TriggerDecl =
  | {
      skill: string;
      from?: string[];
      when?: PredicateDecl[];
      clearsPlan?: true;
      planFromArgs?: true;
    }
  | { step: string; from?: string[]; when?: PredicateDecl[] }
  | {
      event: string;
      from?: string[];
      when?: PredicateDecl[];
      clearsPlan?: true;
    };

export type PredicateDecl =
  | 'idle'
  | 'busy'
  | 'planRead'
  | 'planHasTasks'
  | 'planOpen'
  | { counterRose: string };

export interface CounterDecl {
  counts: string;
  resetOn: 'claim';
}

export interface ActivityDecl {
  word: string;
  tone: ActivityTone;
  emphasis?: RowEmphasis;
}

export interface ActionDecl {
  kind: 'send' | 'clearAndSend' | 'launch' | 'openPlan' | 'event';
  label: string;
  text?: string;
  event?: string;
  then?: string;
  keyOnly?: true;
  risky?: true;
  key?: string;
  available?: PredicateDecl[];
  enabled?: PredicateDecl[];
}

export interface PlanFormat {
  folder?: string;
  file?: string;
  tasksSection?: string;
  groupHeading?: { pattern: string; title: string };
  titleSuffix?: string;
  counters?: Record<
    string,
    { section?: string; heading: string; itemPrefix: string }
  >;
  taskDocs?: {
    link: 'bareMd';
    statusField: string;
    statusLines: number;
    statuses: string[];
    running: string;
  };
  verificationTask?: { lastTaskDocLacking: string };
}

export interface RetroContribution {
  label?: string;
  command: string;
  folder: string;
  on: ('close' | 'clear')[];
}

export interface BacklogContribution {
  label?: string;
  homes: string[];
  file: string;
  areaFolder?: string;
  assistant?: { instructions: string };
}

export interface DocsContribution {
  globalFolders?: {
    path: string;
    referenceFiles?: string[];
    subfolders?: string[];
    skip?: string[];
  }[];
  wikiMain?: string;
  linkPrefixes?: Record<string, string>;
}

export interface CommandPattern {
  program: string;
  words: string[];
  valueFlags?: string[];
  projectPathFlag?: string;
  projectPathVariable?: string;
}

export interface LiveViewContribution {
  open: CommandPattern[];
  close: CommandPattern[];
  probe?: { file: string; entry: string; runner: 'unityScript' };
}

// A declared workflow's id across plugins: `<plugin name>:<id>`.
export function qualifiedWorkflowId(pluginName: string, id: string): string {
  return `${pluginName}:${id}`;
}
