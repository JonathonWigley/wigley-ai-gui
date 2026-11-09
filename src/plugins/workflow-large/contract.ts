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
  progress: null,
  reviewRoundsAtMake: null,
  countdownEndsAt: null,
};

// `state` when it has Large's shape, else the empty state.
export function largeStateIn(state: unknown): LargeState {
  return isLargeState(state) ? state : EMPTY_LARGE_STATE;
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
  | { type: 'planGone' }
  // Make in new session gave this session's plan away.
  | { type: 'handedOff' }
  | { type: 'dismissed' };

const LARGE_EVENT_TYPES: ReadonlySet<unknown> = new Set<LargeEvent['type']>([
  'planChanged',
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

function isLargeState(value: unknown): value is LargeState {
  return (
    isJsonObject(value) &&
    (value.planDir === null || typeof value.planDir === 'string') &&
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

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}
