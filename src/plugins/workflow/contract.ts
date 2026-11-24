// The workflow plugin's records, its workflow and stage extension points and its
// flows slot.

import type { CommandKey } from '../../contracts/commands';
import type { PlanFormat, WorkflowDecl } from '../../contracts/contributions';
import type { DemoMainStep } from '../../contracts/demo';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  PageApi,
  PluginManifest,
} from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';
import { HEADLESS_NOTE } from '../chat/contract';
import {
  type OfflineAnswer,
  type RowActivity,
  textResult,
} from '../sessions/contract';
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

export { qualifiedWorkflowId } from '../../contracts/contributions';

// A registered workflow's id. Each workflow names its own; a declared
// workflow's is qualified, `<plugin name>:<id>`.
export type WorkflowId = string;

// A stage module's id, unique within its workflow.
export type StageId = string;

export const IDLE_STAGE: StageId = 'idle';

// The engine's built-in workflow, which every flow starts on and a declared
// workflow's claim replaces. It is never switched off.
export const CHECKLIST_WORKFLOW_ID: WorkflowId = 'checklist';
export const CHECKLIST_STAGE: StageId = 'work';
export const CHECKLIST_WORKFLOW: WorkflowDecl = {
  id: CHECKLIST_WORKFLOW_ID,
  label: 'Checklist',
  badge: 'C',
  order: 1000,
  claims: [],
  sidePane: { kind: 'checklist', title: 'Checklist' },
  stages: [
    {
      id: CHECKLIST_STAGE,
      label: 'Checklist',
      status: 'busy',
      progress: ' {checklist}',
      enter: [],
    },
  ],
};

// The short command id of a declared action: the workflow id with each `:`
// as `-`, then `-<action id>` (`my-plugin-large-clearAndMake`).
export function actionCommandShortId(
  workflowId: string,
  actionId: string,
): string {
  return `${workflowId.replaceAll(':', '-')}-${actionId}`;
}

// One declaration the workflows reader accepted, with its plugin's
// `planFormat`, null when the plugin declares none.
export interface DeclaredWorkflow {
  id: WorkflowId;
  pluginName: string;
  decl: WorkflowDecl;
  planFormat: PlanFormat | null;
}

// The Checklist flow as a declaration: main and page register it before any
// contributed one.
export const CHECKLIST_DECLARED: DeclaredWorkflow = {
  id: CHECKLIST_WORKFLOW_ID,
  pluginName: '',
  decl: CHECKLIST_WORKFLOW,
  planFormat: null,
};

// Whether a workflow other than the Checklist flow holds `flow`.
export function isClaimed(flow: SessionFlow): boolean {
  return flow.workflow !== null && flow.workflow !== CHECKLIST_WORKFLOW_ID;
}

// One entry of `workflow.autoStart`: the qualified workflow whose `auto`
// actions run after `seconds`, at least 1.
export interface AutoStartSetting {
  workflow: string;
  seconds: number;
}

// The flow's plan, kept by the plan capability. `dir` is the plan folder,
// `reported` whether the agent reported it, `unreportedDir` a folder a plan
// write named before any report, and `snapshots` each plan counter's value at
// the last stage that `records` it.
export interface PlanState {
  dir: string | null;
  reported: boolean;
  unreportedDir: string | null;
  progress: PlanProgress | null;
  snapshots: Record<string, number>;
}

// What a read of the plan file gave: `wave` is the first group with an open
// box, `counters` each `planFormat` counter.
export interface PlanProgress {
  title: string;
  checked: number;
  total: number;
  wave: number | null;
  counters: Record<string, number>;
  tasks: PlanTaskLine[];
}

// One box of the plan: `file` its task document, `status` that document's
// status, `verification` whether it is the verification task.
export interface PlanTaskLine {
  group: number | null;
  text: string;
  done: boolean;
  file: string | null;
  status: string | null;
  verification: boolean;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
  // Which open items run: true shows the stage's state, false shows pending.
  // With no item true, the first open item not false shows the stage's state and
  // the rest show pending.
  running?: boolean;
}

export interface SessionFlow {
  sessionId: string;
  projectDir: string;
  // A new flow's is the Checklist flow's; null only in a saved file written
  // before it, which the loader maps to the Checklist flow, so a held flow
  // never has null.
  workflow: WorkflowId | null;
  movedUpFrom: WorkflowId | null;
  stage: StageId;
  // From `checklistReported`.
  checklist: readonly ChecklistItem[] | null;
  // True once a `checklistReported` folded; no claim resets it.
  checklistReported: boolean;
  // The plan capability's; null on another workflow's claim.
  plan: PlanState | null;
  // The declared workflow's counters by name.
  counters: Record<string, number>;
  // The stage a finishing stage was entered from.
  enteredFrom: StageId | null;
  // When the auto-start countdown runs its action, epoch ms; null for none.
  countdownEndsAt: number | null;
  // A live turn with agent work ended on the Checklist flow while another
  // workflow was registered.
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
  // From the plan capability: the read plan changed, or its folder holds no
  // plan file.
  | { type: 'planChanged'; progress: PlanProgress }
  | { type: 'planGone' }
  // A plan report through `set_workflow_plan` or a plan-run file.
  | { type: 'planReported'; planDir: string }
  // A declared event: an `event` action's, or a `launch` action's `then`.
  | { type: 'event'; event: string };

export interface MainStage {
  id: StageId;
  // The stage's place in its workflow's `stages`, ascending.
  order: number;
  // The stage this signal moves the flow to, or null to leave the decision to
  // the next stage. Pure. `flow` is the flow after the fold's running state and
  // the workflow's `foldFields` for this signal (see foldFlow).
  enter(flow: SessionFlow, signal: WorkflowSignal): StageId | null;
  // The value `set_workflow_step` names this stage by; left out, no report can
  // name it. The stage's own `enter` rule answers the `stepReported` signal.
  reportedAs?: string;
  // True for a stage whose entry finishes the workflow's run.
  finishes?: boolean;
}

export interface MainWorkflow {
  id: WorkflowId;
  // The lowest order's claim wins a skill two workflows claim.
  order: number;
  claims(signal: WorkflowSignal): boolean;
  firstStage: StageId;
  stages: readonly MainStage[];
  // The flow's other fields for this signal, after the checklist and before
  // the stage rules; returns `flow` itself for no change.
  foldFields?(flow: SessionFlow, signal: WorkflowSignal): SessionFlow;
  // The flow after the stage rules, given `before`, the flow they started
  // from; returns `next` itself for no change.
  afterStage?(
    before: SessionFlow,
    next: SessionFlow,
    signal: WorkflowSignal,
  ): SessionFlow;
  // Review fix cycles for the run log. Left out: 0.
  fixCycles?(flow: SessionFlow): number;
}

// A demo sample's whole flow: each field `fields` leaves out takes a new flow's
// value (`newFlow` in flow.ts, which imports this file).
export function sampleFlow(
  sessionId: string,
  projectDir: string,
  fields: Partial<Omit<SessionFlow, 'sessionId' | 'projectDir'>>,
): SessionFlow {
  return {
    sessionId,
    projectDir,
    workflow: CHECKLIST_WORKFLOW_ID,
    movedUpFrom: null,
    stage: CHECKLIST_STAGE,
    checklist: null,
    checklistReported: false,
    plan: null,
    counters: {},
    enteredFrom: null,
    countdownEndsAt: null,
    missedLevel: false,
    turnRunning: false,
    runningSubagents: [],
    ...fields,
  };
}

// A sample checklist of `texts`, its first `done` items done.
export function sampleChecklist(
  texts: readonly string[],
  done: number,
): ChecklistItem[] {
  return texts.map((text, index) => ({ text, done: index < done }));
}

// The samples a demo stage shows in turn: `show` draws `flow` through
// `showSample`, then disposes the sample before it, so the row never draws its
// stored flow between beats; `dispose` disposes the last.
export interface SampleSequence extends Disposable {
  show(flow: SessionFlow): void;
}

export function createSampleSequence(
  showSample: (flow: SessionFlow) => Disposable,
): SampleSequence {
  let last: Disposable | null = null;
  return {
    show(flow) {
      const previous = last;
      last = showSample(flow);
      previous?.dispose();
    },
    dispose() {
      last?.dispose();
      last = null;
    },
  };
}

// A workflow step's main half: one demo session, `session`, opened with plain
// text naming the step, which the fake answers with an echo turn. The demo run
// closes it when the step is left, so the dispose does nothing.
export function sampleSessionStep(id: string, title: string): DemoMainStep {
  return {
    id,
    enter: async (context) => ({
      sessions: {
        session: await context.launchSession(
          `A sample session for the ${title} step.`,
        ),
      },
      dispose() {},
    }),
  };
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
  // What follows the stage's word on the session row's chip, its separator
  // included: ' 3/8'. Left out, nothing follows.
  chipProgress?(flow: SessionFlow): string;
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
// no MCP tool. `addDeclared` enables a declared workflow beside the
// contributed ones, whatever `workflow.off` lists, until the dispose.
export interface WorkflowSelfTestHooks {
  forgetFlows(projectDir: string): void;
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;
  callStepTool(sessionId: string, step: string): void;
  callChecklistTool(sessionId: string, items: readonly ChecklistItem[]): void;
  addDeclared(workflow: DeclaredWorkflow): Disposable;
}

// The relay hook the `auri` checklist gate asks. Any request line; the reply
// is `{ reported, open, items }`.
export const CHECKLIST_HOOK = 'workflow.checklist';

// The enabled declared workflows, keyed by qualified id, in workflow order:
// the contributed ones `workflow.off` leaves on, then each `addDeclared` one.
// The Checklist flow is never in it.
export const workflowDeclaredSlot: KeyedSlotKey<
  DeclaredWorkflow,
  'main',
  'workflow'
> = { id: 'workflow.declared', process: 'main', kind: 'keyed' };

export interface WorkflowChannel extends ChannelShape {
  invoke: {
    // Runs a declared action, by its short command id, or `cancelCountdown` on
    // the session's flow; rejects with main's error text.
    runAction(arg: { sessionId: string; action: string }): Promise<void>;
  };
  messages: Record<never, never>;
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
  // True when the flow's stage is one with `finishes` in the registered
  // workflow holding the flow; false for a flow with no such workflow.
  stageFinishes(flow: SessionFlow): boolean;
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
// `userLayout` reads the plugin's `layout` setting. `badgeColor` is the badge's
// CSS color, from the declaration's `badgeColor`.
export interface WorkflowDrawOptions {
  manifest: Pick<PluginManifest, 'id' | 'commands'>;
  defaultLayout: CompleteLayout;
  defaultStylesheet: string;
  userLayout(): string;
  sideTitle: string;
  badgeColor: string;
}

// `addWorkflow` throws on an id already added. `createWorkflowDraw` shows the
// plugin's layouts through its `api`, which owns the show's life. `showSample`
// draws a demo sample on its session's row (once the row is there) over its
// stored flow until the dispose, and activates the session; a sample runs no
// action, as the preview runs none. The dispose draws the stored flow again,
// unless a newer sample of the session shows.
export interface WorkflowPageExports {
  addWorkflow(workflow: PageWorkflow): Disposable;
  createWorkflowDraw(
    api: PagePluginApi,
    options: WorkflowDrawOptions,
  ): WorkflowDraw;
  showSample(flow: SessionFlow): Disposable;
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

// The answer of set_workflow_step, set_workflow_checklist and set_workflow_plan
// while the app is closed: the call is recorded and replays onto its row when
// the app adopts the run, and the run carries on headless.
export const WORKFLOW_OFFLINE_ANSWER: OfflineAnswer = {
  result: textResult(
    `Recorded. The app applies it when it opens.\n\n${HEADLESS_NOTE}`,
  ),
  replay: true,
};
