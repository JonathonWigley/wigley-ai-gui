// The Heavy workflow's id, state, events and stage flags: what its stage rules,
// its runtime and its page halves share.

import type { MainStage, SessionFlow, WorkflowSignal } from '../contract';
import type { PlanProgress, PlanTaskLine } from '../plan-reader';

export const HEAVY_WORKFLOW_ID = 'workflow-heavy';

export interface HeavyState {
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

export const EMPTY_HEAVY_STATE: HeavyState = {
  planDir: null,
  progress: null,
  reviewRoundsAtMake: null,
  countdownEndsAt: null,
};

// `state` when it has Heavy's shape, else the empty state.
export function heavyStateIn(state: unknown): HeavyState {
  return isHeavyState(state) ? state : EMPTY_HEAVY_STATE;
}

// The flow's state when it has Heavy's shape, whichever workflow holds the flow.
export function heavyStateOf(flow: SessionFlow): HeavyState {
  return heavyStateIn(flow.state);
}

export function withHeavyState(
  flow: SessionFlow,
  patch: Partial<HeavyState>,
): SessionFlow {
  return { ...flow, state: { ...heavyStateOf(flow), ...patch } };
}

export type HeavyEvent =
  | { type: 'planChanged'; progress: PlanProgress }
  | { type: 'planGone' }
  // Make in new session gave this session's plan away.
  | { type: 'handedOff' }
  | { type: 'dismissed' };

const HEAVY_EVENT_TYPES: ReadonlySet<unknown> = new Set<HeavyEvent['type']>([
  'planChanged',
  'planGone',
  'handedOff',
  'dismissed',
]);

export function heavySignal(event: HeavyEvent): WorkflowSignal {
  return { type: 'custom', event };
}

// The Heavy event a `custom` signal carries, else null.
export function heavyEventOf(signal: WorkflowSignal): HeavyEvent | null {
  if (signal.type !== 'custom' || !isRecord(signal.event)) {
    return null;
  }
  return HEAVY_EVENT_TYPES.has(signal.event.type)
    ? (signal.event as unknown as HeavyEvent)
    : null;
}

export interface HeavyMainStage extends MainStage {
  // A main-side command the auto-start runs when a flow enters this stage while
  // `workflow.autoClearAndMake` is on, after `workflow.autoStartSeconds`; left
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

function isHeavyState(value: unknown): value is HeavyState {
  return (
    isRecord(value) &&
    (value.planDir === null || typeof value.planDir === 'string') &&
    (value.progress === null || isPlanProgress(value.progress)) &&
    isNumberOrNull(value.reviewRoundsAtMake) &&
    isNumberOrNull(value.countdownEndsAt)
  );
}

function isPlanProgress(value: unknown): value is PlanProgress {
  return (
    isRecord(value) &&
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
    isRecord(value) &&
    isNumberOrNull(value.wave) &&
    typeof value.text === 'string' &&
    typeof value.done === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}
