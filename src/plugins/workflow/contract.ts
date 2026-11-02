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
  turnRunning: boolean;
  // Agent ids the main agent spawned that have not finished.
  runningSubagents: readonly string[];
  // Epoch ms; non-null only while the auto-start counts down.
  countdownEndsAt: number | null;
  // True once the stage was ever other than idle; the Flow tab exists from
  // then on.
  hasLeftIdle: boolean;
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
}

// A flow is busy while a turn runs or a main-agent subagent runs (wigley:make
// and wigley:feature dispatch in the background, and their results arrive in
// turns with no user message).
export function isBusy(flow: SessionFlow): boolean {
  return flow.turnRunning || flow.runningSubagents.length > 0;
}

export interface StageActionSpec {
  // The workflow command id it runs, without the 'workflow.' prefix:
  // 'clearAndMake'.
  command: string;
  // The button's text: 'Clear & make'.
  label: string;
  // 'page': the page runs it (startFeature, openPlan); 'main': through
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
  // The stepper's and the chip's word: 'Plan ready'.
  label: string;
  // Idle is false.
  inStepper: boolean;
  // Equal to the main half's order (page-stages.test.ts pins it); the stepper
  // sorts on it.
  order: number;
  // Actions in order, the main action first. `ww` and the chip's button run
  // the first available one; when that one is disabled, they run nothing and
  // log `nothing to run`.
  actions: readonly StageActionSpec[];
  // The chip's and the strip's detail text: '3/7 · wave 2'; '' for none.
  detail(flow: SessionFlow): string;
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
