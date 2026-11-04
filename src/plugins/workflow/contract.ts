// The workflow plugin's records, its stage extension points and its channel
// between its main and page parts.

import type { Disposable } from '../../contracts/disposable';
import type { ChannelShape } from '../../contracts/plugin';
import type { PlanProgress } from './plan-reader';

// A stage module's id: 'idle', 'primer', 'feature', 'planReady', 'make',
// 'review', 'closed'.
export type StageId = string;

export const IDLE_STAGE: StageId = 'idle';

export interface SessionFlow {
  sessionId: string;
  projectDir: string;
  stage: StageId;
  // The plan folder (holding plan.md), full path.
  planDir: string | null;
  // Null until the plan folder is read.
  progress: PlanProgress | null;
  // The plan's review rounds when make was last entered: review lights only on
  // a round above it. Null when make was entered before the plan was read, or
  // the plan folder changed since; left out on a flow saved before this field.
  // Either way the next read fills it.
  reviewRoundsAtMake?: number | null;
  turnRunning: boolean;
  // Agent ids the main agent spawned that have not finished.
  runningSubagents: readonly string[];
  // Epoch ms; non-null only while the auto-start counts down.
  countdownEndsAt: number | null;
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
  | { type: 'turnStarted' }
  // Also from a sessionEnded of the flow's current host session (a crash
  // mid-turn).
  | { type: 'turnEnded' }
  // From agentSpawned with parentAgentId MAIN_AGENT_ID.
  | { type: 'subagentStarted'; agentId: string }
  // From agentFinished for an id in runningSubagents.
  | { type: 'subagentFinished'; agentId: string }
  // Resets turnRunning and runningSubagents: a fresh process runs nothing.
  | { type: 'cleared' }
  | { type: 'planChanged'; progress: PlanProgress }
  | { type: 'planGone' }
  // Make in new session gave this session's plan away.
  | { type: 'handedOff' }
  | { type: 'dismissed' };

export interface MainStage {
  id: StageId;
  // Stage order: idle 0, primer 10, feature 20, planReady 30, make 40,
  // review 50, closed 60.
  order: number;
  // The stage this signal moves the flow to, or null to leave the decision to
  // the next stage. Pure. `flow` is the flow after the fold's bookkeeping for
  // this signal (see foldFlow).
  enter(flow: SessionFlow, signal: WorkflowSignal): StageId | null;
  // A main-side command the auto-start runs when a flow enters this stage
  // while `workflow.autoClearAndMake` is on, after `workflow.autoStartSeconds`;
  // left out, entering the stage starts no countdown.
  autoCommand?: string;
  // True for a stage that starts a new plan (primer, feature): entering it
  // clears planDir and progress.
  clearsPlan?: boolean;
  // True for the stage that starts a make run (make): entering it, or entering
  // it again, records the plan's review rounds as reviewRoundsAtMake.
  recordsReviewRounds?: boolean;
}

// A flow is busy while a turn runs or a main-agent subagent runs (wigley:make
// and wigley:feature dispatch in the background, and their results arrive in
// turns with no user message).
export function isBusy(flow: SessionFlow): boolean {
  return flow.turnRunning || flow.runningSubagents.length > 0;
}

// What a stage is doing now. A step not reached has no status: it is pending.
export type StageStatus = 'running' | 'paused' | 'ready' | 'done';

// The status of a stage that runs while its flow is busy.
export function busyStatus(flow: SessionFlow): StageStatus {
  return isBusy(flow) ? 'running' : 'paused';
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

// A stage's detail from its parts, joined by ` · `, each empty part left out.
export function detailLine(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' · ');
}

// A label and its status, joined by ` · `; the label alone for a null status.
export function statusText(label: string, status: StageStatus | null): string {
  return detailLine(label, status ?? '');
}

export interface StageActionSpec {
  // The workflow command id it runs, without the 'workflow.' prefix:
  // 'clearAndMake'.
  command: string;
  // The button's text: 'Clear & make'.
  label: string;
  // 'page': the page runs it (openPlan); 'main': through
  // runAction.
  side: 'page' | 'main';
  // Whether the action shows for this flow, beyond the stage match: Resume
  // make shows only with open boxes.
  available(flow: SessionFlow): boolean;
  // Whether the shown action can run now: Clear & make, Resume make and Retro
  // are drawn disabled while isBusy.
  enabled(flow: SessionFlow): boolean;
}

export interface PageStage {
  id: StageId;
  // The step's word: 'Make'.
  label: string;
  // Idle is false.
  inStepper: boolean;
  // Stages sharing a slot take one place in the stepper: the one the flow is
  // in, otherwise the slot's last by order ('start': primer, feature; 'make':
  // planReady, make).
  stepSlot?: string;
  // Equal to the main half's order (page-stages.test.ts pins it); the stepper
  // sorts on it.
  order: number;
  // Actions in order, the main action first. `ww` and the main action's button
  // run the first available one; when that one is disabled, they run nothing
  // and log `nothing to run`.
  actions: readonly StageActionSpec[];
  // The side pane's detail line: '3/7 · wave 2 · Claim grants'; '' for none.
  // The chip's input and the strip's input still carry it for a user layout.
  detail(flow: SessionFlow): string;
  // What the stage is doing for this flow; null for a stage with no status.
  status(flow: SessionFlow): StageStatus | null;
  // The label and status with this stage's progress: 'Make · running 3/9'.
  statusLine(flow: SessionFlow): string;
  // True when the current wave's open tasks draw the stage's status; left out,
  // they draw `pending`.
  runsTasks?: boolean;
}

export interface WorkflowMainExports {
  addStage(stage: MainStage): Disposable;
}

export interface WorkflowPageExports {
  addStage(stage: PageStage): Disposable;
}

export interface WorkflowActionRequest {
  sessionId: string;
  command: string;
}

// Main pushes `flows` (every flow, on start and on each change); the page
// invokes runAction and flows().
export interface WorkflowChannel extends ChannelShape {
  invoke: {
    // Every flow main holds, once main has read flows.json.
    flows(): Promise<SessionFlow[]>;
    // Runs a main-side command (a StageActionSpec.command with side 'main')
    // on the session's flow; rejects with main's error text.
    runAction(request: WorkflowActionRequest): Promise<void>;
  };
  messages: {
    // Every flow main holds, sent on each change.
    flows: SessionFlow[];
  };
}
