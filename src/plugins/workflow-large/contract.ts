// The Large workflow's id, state, events and stage flags, and its channel: what its
// stage rules, its main part and its page part share.

import type { ChannelShape } from '../../contracts/plugin';
import { isJsonObject } from '../../shared/json';
import type {
  MainStage,
  SessionFlow,
  WorkflowSignal,
} from '../workflow/contract';
import {
  type PlanProgress,
  type PlanTaskLine,
  TASK_STATUSES,
} from '../../shared/plan-progress';

export const LARGE_WORKFLOW_ID = 'workflow-large';

export interface LargeState {
  // The plan folder (holding plan.md), full path.
  planDir: string | null;
  // True when the run reported `planDir` through `plan.py` or
  // `set_workflow_plan`: the plan watch then reads that folder alone while it
  // holds a plan.md. A flow saved before reports reads false.
  planReported: boolean;
  // The unreported folder held before a report moved `planDir` away, when it
  // shares the reported folder's name, else null: the plan watch lists the
  // plan's copies from it once the reported folder lists none. A flow saved
  // before reports reads null.
  unreportedPlanDir: string | null;
  // Null until the plan folder is read.
  progress: PlanProgress | null;
  // The plan's review rounds when make was last entered: review lights only on
  // a round above it. Null when make was entered before the plan was read, or
  // the plan folder changed since. Either way the next read fills it.
  reviewRoundsAtMake: number | null;
  // Epoch ms; non-null only while the auto-start counts down.
  countdownEndsAt: number | null;
}

export const EMPTY_LARGE_STATE: LargeState = {
  planDir: null,
  planReported: false,
  unreportedPlanDir: null,
  progress: null,
  reviewRoundsAtMake: null,
  countdownEndsAt: null,
};

// `state` when it has Large's shape, a missing `planReported` read false and a
// missing `unreportedPlanDir` null; else the empty state. A state holding both
// is returned as is.
export function largeStateIn(state: unknown): LargeState {
  if (!isSavedLargeState(state)) {
    return EMPTY_LARGE_STATE;
  }
  const holdsEveryField =
    state.planReported !== undefined && state.unreportedPlanDir !== undefined;
  return holdsEveryField
    ? (state as LargeState)
    : {
        ...state,
        planReported: state.planReported ?? false,
        unreportedPlanDir: state.unreportedPlanDir ?? null,
      };
}

// The flow's state when it has Large's shape, whichever workflow holds the flow.
export function largeStateOf(flow: SessionFlow): LargeState {
  return largeStateIn(flow.state);
}

export function withLargeState(
  flow: SessionFlow,
  patch: Partial<LargeState>,
): SessionFlow {
  return { ...flow, state: { ...largeStateOf(flow), ...patch } };
}

export type LargeEvent =
  | { type: 'planChanged'; progress: PlanProgress }
  // The run reported its plan folder.
  | { type: 'planReported'; planDir: string }
  | { type: 'planGone' }
  // Make in new session gave this session's plan away.
  | { type: 'handedOff' }
  | { type: 'dismissed' };

const LARGE_EVENT_TYPES: ReadonlySet<unknown> = new Set<LargeEvent['type']>([
  'planChanged',
  'planReported',
  'planGone',
  'handedOff',
  'dismissed',
]);

export function largeSignal(event: LargeEvent): WorkflowSignal {
  return { type: 'custom', event };
}

// The Large event a `custom` signal carries, else null.
export function largeEventOf(signal: WorkflowSignal): LargeEvent | null {
  if (signal.type !== 'custom' || !isJsonObject(signal.event)) {
    return null;
  }
  return LARGE_EVENT_TYPES.has(signal.event.type)
    ? (signal.event as unknown as LargeEvent)
    : null;
}

export interface LargeMainStage extends MainStage {
  // A main-side command the auto-start runs when a flow enters this stage while
  // `workflow-large.autoClearAndMake` is on, after
  // `workflow-large.autoStartSeconds`; left
  // out, entering the stage starts no countdown.
  autoCommand?: string;
  // True for a stage whose skill starts a new plan (primer, explore): a
  // `skillStarted` answered with this stage clears planDir and progress, and a
  // reported step back to it clears neither.
  clearsPlan?: boolean;
  // True for the stage that starts a make run (make): entering it, or entering
  // it again, records the plan's review rounds as reviewRoundsAtMake.
  recordsReviewRounds?: boolean;
}

export interface LargeActionRequest {
  sessionId: string;
  command: string;
}

export interface WorkflowLargeChannel extends ChannelShape {
  invoke: {
    // Runs a main-side command (a StageActionSpec.command) on the session's flow;
    // rejects with main's error text.
    runAction(request: LargeActionRequest): Promise<void>;
  };
  messages: Record<never, never>;
}

// Large's state as a flow saved before the report fields may hold it.
type SavedLargeState = Omit<LargeState, 'planReported' | 'unreportedPlanDir'> &
  Partial<Pick<LargeState, 'planReported' | 'unreportedPlanDir'>>;

function isSavedLargeState(value: unknown): value is SavedLargeState {
  return (
    isJsonObject(value) &&
    isStringOrNull(value.planDir) &&
    (value.planReported === undefined ||
      typeof value.planReported === 'boolean') &&
    (value.unreportedPlanDir === undefined ||
      isStringOrNull(value.unreportedPlanDir)) &&
    (value.progress === null || isPlanProgress(value.progress)) &&
    isNumberOrNull(value.reviewRoundsAtMake) &&
    isNumberOrNull(value.countdownEndsAt)
  );
}

function isPlanProgress(value: unknown): value is PlanProgress {
  return (
    isJsonObject(value) &&
    typeof value.checked === 'number' &&
    typeof value.total === 'number' &&
    isNumberOrNull(value.wave) &&
    typeof value.reviewRounds === 'number' &&
    typeof value.title === 'string' &&
    Array.isArray(value.tasks) &&
    (value.tasks as unknown[]).every(isPlanTaskLine)
  );
}

function isPlanTaskLine(value: unknown): value is PlanTaskLine {
  return (
    isJsonObject(value) &&
    isNumberOrNull(value.wave) &&
    typeof value.text === 'string' &&
    typeof value.done === 'boolean' &&
    (value.file === null || typeof value.file === 'string') &&
    (value.status === null ||
      (TASK_STATUSES as readonly unknown[]).includes(value.status))
  );
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}
