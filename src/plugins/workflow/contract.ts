// The workflow plugin's records, its workflow and stage extension points and its
// flows slot.

import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  PageApi,
  PluginManifest,
} from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';
import type { RowActivity } from '../sessions/contract';
import type {
  ChipInput,
  CompleteLayout,
  SidePaneInput,
  StripInput,
} from './layouts/layout';

export type {
  ActionInput,
  ChipInput,
  CompleteLayout,
  Layout,
  MarkState,
  SideGroupInput,
  SideItemInput,
  SidePaneInput,
  StepInput,
  StripInput,
  WorkflowKit,
  WorkflowPart,
} from './layouts/layout';

// A registered workflow's id. Each workflow names its own.
export type WorkflowId = string;

// A stage module's id, unique within its workflow.
export type StageId = string;

export const IDLE_STAGE: StageId = 'idle';

export interface ChecklistItem {
  text: string;
  done: boolean;
  // Set by a workflow that knows which open items run: false shows an open item
  // pending; true or left out, it shows the stage's state.
  running?: boolean;
}

export interface SessionFlow {
  sessionId: string;
  projectDir: string;
  // Null until a workflow claims a skill.
  workflow: WorkflowId | null;
  movedUpFrom: WorkflowId | null;
  stage: StageId;
  // From `checklistReported`.
  checklist: readonly ChecklistItem[] | null;
  // The current workflow's own; null on a new claim.
  state: unknown;
  // A live turn with agent work ended with `workflow` null.
  missedLevel: boolean;
  turnRunning: boolean;
  // Agent ids the main agent spawned that have not finished.
  runningSubagents: readonly string[];
}

export type WorkflowSignal =
  // `argsPath`: `args` resolved against projectDir; null only for empty args.
  | {
      type: 'skillStarted';
      skill: string;
      args: string;
      argsPath: string | null;
    }
  | { type: 'fileWritten'; path: string }
  // From `set_workflow_step`: the agent says the session moved to this stage.
  | { type: 'stepReported'; step: StageId }
  // The agent's whole list of work items.
  | { type: 'checklistReported'; items: readonly ChecklistItem[] }
  | { type: 'turnStarted' }
  // Also from a sessionEnded of the flow's current host session (a crash
  // mid-turn).
  | { type: 'turnEnded' }
  // From agentSpawned of any agent, a subagent's own included.
  | { type: 'subagentStarted'; agentId: string }
  // From agentFinished for an id in runningSubagents.
  | { type: 'subagentFinished'; agentId: string }
  // Resets turnRunning and runningSubagents: a fresh process runs nothing.
  | { type: 'cleared' }
  // A workflow's own event, which the engine does not read.
  | { type: 'custom'; event: unknown };

export interface MainStage {
  id: StageId;
  // The stage's place in its workflow's `stages`, ascending.
  order: number;
  // The stage this signal moves the flow to, or null to leave the decision to
  // the next stage. Pure. `flow` is the flow after the fold's running state and
  // the workflow's `foldState` for this signal (see foldFlow).
  enter(flow: SessionFlow, signal: WorkflowSignal): StageId | null;
  // The value `set_workflow_step` names this stage by; left out, no report can
  // name it. The stage's own `enter` rule answers the `stepReported` signal.
  reportedAs?: string;
  // True for a stage whose entry finishes the workflow's run.
  finishes?: boolean;
}

export interface MainWorkflow {
  id: WorkflowId;
  // Small 10, medium 20, large 30, spike 40. The lowest order's claim wins a skill two
  // workflows claim.
  order: number;
  claims(signal: WorkflowSignal): boolean;
  firstStage: StageId;
  stages: readonly MainStage[];
  // The workflow's own bookkeeping; returns the new state, or `flow.state` for
  // no change.
  foldState?(flow: SessionFlow, signal: WorkflowSignal): unknown;
  // Compares states for the fold's same-flow check. Left out: by reference.
  sameState?(a: unknown, b: unknown): boolean;
  // Review fix cycles for the run log. Left out: 0.
  fixCycles?(flow: SessionFlow): number;
}

// A flow is busy while a turn runs or a subagent at any depth runs (a skill
// may dispatch in the background, and its results arrive in turns with no
// user message).
export function isBusy(flow: SessionFlow): boolean {
  return flow.turnRunning || flow.runningSubagents.length > 0;
}

// What a stage is doing now. A step not reached has no status: it is pending.
export type StageStatus = 'running' | 'paused' | 'ready' | 'done';

// The status of a stage that runs while its flow is busy.
export function busyStatus(flow: SessionFlow): StageStatus {
  return isBusy(flow) ? 'running' : 'paused';
}

// The status of a workflow's last stage: running until its flow is no longer
// busy, then done.
export function finishingStatus(flow: SessionFlow): StageStatus {
  return isBusy(flow) ? 'running' : 'done';
}

// True when `signal` starts `skill` (`plugin:name`), named in full or by the
// bare `name` Claude Code also accepts for a typed command.
export function startsSkill(signal: WorkflowSignal, skill: string): boolean {
  if (signal.type !== 'skillStarted') {
    return false;
  }
  const bareName = skill.slice(skill.indexOf(':') + 1);
  return signal.skill === skill || signal.skill === bareName;
}

// True when `signal` reports the step of stage `stage`.
export function reportsStep(signal: WorkflowSignal, stage: StageId): boolean {
  return signal.type === 'stepReported' && signal.step === stage;
}

// A stage's detail from its parts, joined by ` · `, each empty part left out.
export function detailLine(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' · ');
}

// A label and its status, joined by ` · `; the label alone for a null status.
export function statusText(label: string, status: StageStatus | null): string {
  return detailLine(label, status ?? '');
}

// A stage's status text, then what its stage adds: 'Build · running 3/9'.
export function statusLine(stage: PageStage, flow: SessionFlow): string {
  const text = statusText(stage.label, stage.status(flow));
  return text + (stage.statusProgress?.(flow) ?? '');
}

export interface StageActionSpec {
  // The owner plugin's short command id.
  command: string;
  // The button's text.
  label: string;
  // Runs from its own `<Leader>w` key only: no button, and never the main action.
  keyOnly?: true;
  // Whether the action shows for this flow, beyond the stage match.
  available(flow: SessionFlow): boolean;
  // Whether the shown action can run now; a shown action that cannot is drawn
  // disabled.
  enabled(flow: SessionFlow): boolean;
}

export interface PageStage {
  id: StageId;
  // The step's word: 'Build'.
  label: string;
  // Idle is false.
  inStepper: boolean;
  // Stages sharing a slot take one place in the stepper: the one the flow is
  // in, otherwise the slot's last by order.
  stepSlot?: string;
  // Equal to the main half's order (page-stages.test.ts pins it); addWorkflow
  // sorts the workflow's stages on it, for the stepper.
  order: number;
  // Actions in order, the main action first. `ww` and the main action's button
  // run the first available one that is not `keyOnly`; when that one is
  // disabled, they run nothing and log `nothing to run`.
  actions: readonly StageActionSpec[];
  // The side pane's detail line; '' for none.
  // The chip's input and the strip's input still carry it for a user layout.
  detail(flow: SessionFlow): string;
  // What the stage is doing for this flow; null for a stage with no status.
  status(flow: SessionFlow): StageStatus | null;
  // What follows the status text in the status line and the label of the
  // stepper's current step, its separator included: ' 3/9', ' · round 2'. Left
  // out, nothing follows.
  statusProgress?(flow: SessionFlow): string;
  // True when the current group's open items draw the stage's status; left out,
  // they draw `pending`.
  runsTasks?: boolean;
  // What the session's row says while the stage waits on the user and the flow
  // is not busy, in place of the chip's tag. Left out, the row keeps its other
  // activities and the chip its tag.
  rowActivity?: RowActivity;
  // What the session's row says in place of a finished turn's done: set when a
  // turn ends in the stage while another session is the active one, until the
  // user views the session or the flow is busy again. The chip keeps its tag.
  unseenActivity?: RowActivity;
}

// Above chat's done, below chat's working: the stage's word replaces a finished
// turn's and gives way to a running one.
export const STAGE_ACTIVITY_RANK = 15;

// The row activity `stage` shows for `flow`, null for none: none while busy,
// else the stage's own `rowActivity`.
export function shownRowActivity(
  stage: PageStage,
  flow: SessionFlow,
): RowActivity | null {
  return isBusy(flow) ? null : (stage.rowActivity ?? null);
}

// Where a fold's signal came from. 'live' is a live event or a workflow's action;
// only it stamps the flow's save time, which a replayed event is compared against.
// 'observed' is something a workflow read for itself, as a file.
export type SignalOrigin = 'live' | 'replay' | 'observed';

export interface FoldEvent {
  sessionId: string;
  before: SessionFlow;
  after: SessionFlow;
  signal: WorkflowSignal;
  origin: SignalOrigin;
  // False: a replayed event at or before the save time, running state only.
  whole: boolean;
}

export interface WorkflowObserver {
  // After every apply, also when the flow did not change.
  folded(event: FoldEvent): void;
  // After the store opened the session's flow.
  opened(flow: SessionFlow): void;
  // The session ended, or forgetFlows forgot it.
  closed(sessionId: string): void;
  // A replayed agent event arrived, before its signals fold.
  replaying(sessionId: string): void;
}

// What the self-test script drives main through. `forgetFlows` drops every
// flow in the folder, saved ones included, and tells the observers each open one
// closed, for a run that closed the folder's sessions; `onMainTurnEnded` hears
// each main-agent `turnEnded` once main applied it, whether or not the flow
// changed; `callStepTool` makes a `set_workflow_step` call from the session and
// `callChecklistTool` a `set_workflow_checklist` call, since the fake harness calls
// no MCP tool.
export interface WorkflowSelfTestHooks {
  forgetFlows(projectDir: string): void;
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;
  callStepTool(sessionId: string, step: string): void;
  callChecklistTool(sessionId: string, items: readonly ChecklistItem[]): void;
}

export interface WorkflowMainExports {
  addWorkflow(workflow: MainWorkflow): Disposable;
  // The load of flows.json settled.
  ready: Promise<void>;
  signal(
    sessionId: string,
    signal: WorkflowSignal,
    origin: 'live' | 'observed',
  ): void;
  flowOf(sessionId: string): SessionFlow | null;
  flows(): readonly SessionFlow[];
  // Replaces the current workflow's state with no fold, keeping the save time.
  setState(sessionId: string, state: unknown): void;
  observe(observer: WorkflowObserver): Disposable;
  // The engine's layout.d.ts, raw.
  layoutTypes: string;
  selfTestHooks: WorkflowSelfTestHooks | null;
}

export const workflowMainKey: DependencyKey<
  WorkflowMainExports,
  'main',
  'workflow'
> = { id: 'workflow', process: 'main' };

export interface ChecklistGroup {
  title: string;
  items: readonly ChecklistItem[];
}

// What the side pane's checklist reads; the engine takes `checked` and `total` as
// given.
export interface ChecklistView {
  title: string;
  checked: number;
  total: number;
  groups: readonly ChecklistGroup[];
}

// The checklist of a workflow with no `checklist` of its own: one `Tasks` group
// from `flow.checklist`; null while that is null.
export function defaultChecklist(flow: SessionFlow): ChecklistView | null {
  const items = flow.checklist;
  if (items === null) {
    return null;
  }
  return {
    title: '',
    checked: items.filter((item) => item.done).length,
    total: items.length,
    groups: items.length === 0 ? [] : [{ title: 'Tasks', items }],
  };
}

// `<checked>/<total>` of the flow's checklist; null with no list or an empty one.
export function checklistCount(flow: SessionFlow): string | null {
  const checklist = defaultChecklist(flow);
  return checklist === null || checklist.total === 0
    ? null
    : `${checklist.checked}/${checklist.total}`;
}

// A drawn part. `dispose` removes the element and disposes every anchor the part
// named.
export interface Drawn {
  element: HTMLElement;
  dispose(): void;
}

// The session a stage action runs for, and the action: `mainAction`,
// `toggleFinishedWaves`, or the short command id of a stage's action.
export interface StageActionArg {
  sessionId: string;
  action: string;
}

// Runs a stage action for a session through the engine's gate, as every stage
// button, fold and stage key does.
export const workflowStageActionCommand: CommandKey<
  StageActionArg,
  'workflow.stageAction'
> = { id: 'workflow.stageAction' };

// One workflow plugin's parts: each draws into `parent` with the plugin's layouts
// as last shown, falling back to its `default` on a throw, its buttons running
// `workflow.stageAction` for `sessionId`. No part takes a key scope. `sideTitle` is
// the title of the workflow's side part.
export interface WorkflowDraw {
  sideTitle: string;
  chip(parent: HTMLElement, input: ChipInput, sessionId: string): Drawn;
  strip(parent: HTMLElement, input: StripInput, sessionId: string): Drawn;
  sidePane(parent: HTMLElement, input: SidePaneInput, sessionId: string): Drawn;
}

// A workflow's page half.
export interface PageWorkflow {
  id: WorkflowId;
  // Its word: 'Small'.
  label: string;
  // Its letter on the session row: 'S'.
  badge: string;
  stages: readonly PageStage[];
  // From `createWorkflowDraw`, called with the plugin's own api.
  draw: WorkflowDraw;
  // Left out: `defaultChecklist`.
  checklist?(flow: SessionFlow): ChecklistView | null;
  // Runs one of its stages' action commands for the session `workflow.stageAction`
  // names, after the engine's gate; a reject is logged and toasted.
  runAction(
    sessionId: string,
    command: string,
    flow: SessionFlow,
  ): Promise<void>;
  // The countdown's text, null while none runs; the chip and strip tick while it
  // is not null.
  countdownText?(flow: SessionFlow, now: number): string | null;
  // What the log's `<name> progress <text>` line reads; null logs none.
  progressText?(flow: SessionFlow): string | null;
  // Whether the strip counts a checklist. Left out: `checklist(flow) !== null`.
  hasPlan?(flow: SessionFlow): boolean;
  // Its samples for the layout preview, each run per preview step.
  previewFlows?(sessionId: string, now: number): readonly SessionFlow[];
}

// The part of a plugin's page api `createWorkflowDraw` shows its layouts through.
export type PagePluginApi = Pick<
  PageApi<PluginManifest, ChannelShape>,
  'layouts'
>;

// `manifest` names the owner of the plugin's layouts and its commands' key hints;
// `userLayout` reads the plugin's `layout` setting.
export interface WorkflowDrawOptions {
  manifest: Pick<PluginManifest, 'id' | 'commands'>;
  defaultLayout: CompleteLayout;
  defaultStylesheet: string;
  userLayout(): string;
  sideTitle: string;
}

// `addWorkflow` throws on an id already added. `createWorkflowDraw` shows the
// plugin's layouts through its `api`, which owns the show's life.
export interface WorkflowPageExports {
  addWorkflow(workflow: PageWorkflow): Disposable;
  createWorkflowDraw(
    api: PagePluginApi,
    options: WorkflowDrawOptions,
  ): WorkflowDraw;
}

export const workflowPageKey: DependencyKey<
  WorkflowPageExports,
  'page',
  'workflow'
> = { id: 'workflow', process: 'page' };

// Each open session's flow, keyed by the row's sessionId. A store change writes or
// deletes the one flow it touched.
export const workflowFlowsSlot: KeyedSlotKey<SessionFlow, 'main', 'workflow'> =
  { id: 'workflow.flows', process: 'main', kind: 'keyed' };
