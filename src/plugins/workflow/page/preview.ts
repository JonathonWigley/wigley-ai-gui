// The layout preview's sample flows (`Space z l w`): one per press, through
// every built-in stage, the plan-ready countdown on the second plan ready.
// The stage ids are sample data, not stage rules.
import type { StageId, SessionFlow } from '../contract';
import type { PlanProgress, PlanTaskLine } from '../plan-reader';

export const PREVIEW_STAGES: readonly StageId[] = [
  'idle',
  'primer',
  'feature',
  'planReady',
  'planReady',
  'make',
  'review',
  'closed',
];

const COUNTDOWN_INDEX = 4;
const PREVIEW_PROJECT = 'Workflow preview';
const PREVIEW_PLAN_DIR = '~/docs/features/preview/plan-preview';
const PREVIEW_TITLE = 'Preview plan';

// The sample plan's seven tasks, by the wave each sits under.
const PREVIEW_TASKS: readonly Omit<PlanTaskLine, 'done'>[] = [
  { wave: 1, text: 'Write the contract' },
  { wave: 1, text: 'Read the plan file' },
  { wave: 1, text: 'Fold the signals' },
  { wave: 2, text: 'Draw the row chip' },
  { wave: 2, text: 'Draw the composer strip' },
  { wave: 2, text: 'Add the Flow tab' },
  { wave: 3, text: 'Run the self-test' },
];

// How far the sample plan has come at each stage that has one.
const PREVIEW_PROGRESS: Readonly<
  Record<StageId, { checked: number; reviewRounds: number }>
> = {
  feature: { checked: 0, reviewRounds: 0 },
  planReady: { checked: 0, reviewRounds: 0 },
  make: { checked: 3, reviewRounds: 0 },
  review: { checked: 6, reviewRounds: 1 },
  closed: { checked: 7, reviewRounds: 1 },
};

// The sample flow `index` of PREVIEW_STAGES shows, over the preview session.
// It has left idle in every sample, idle included, so the Flow tab shows from
// the first press.
export function previewFlow(
  index: number,
  sessionId: string,
  now: number,
  autoStartSeconds: number,
): SessionFlow {
  const stage = PREVIEW_STAGES[index];
  const progress = previewProgress(stage);
  return {
    sessionId,
    projectDir: PREVIEW_PROJECT,
    stage,
    planDir: progress === null ? null : PREVIEW_PLAN_DIR,
    progress,
    turnRunning: false,
    runningSubagents: [],
    countdownEndsAt:
      index === COUNTDOWN_INDEX ? now + autoStartSeconds * 1000 : null,
    hasLeftIdle: true,
  };
}

function previewProgress(stage: StageId): PlanProgress | null {
  const reached = PREVIEW_PROGRESS[stage];
  if (reached === undefined) {
    return null;
  }
  const tasks = PREVIEW_TASKS.map((task, index) => ({
    ...task,
    done: index < reached.checked,
  }));
  return {
    checked: reached.checked,
    total: tasks.length,
    wave: tasks.find((task) => !task.done)?.wave ?? null,
    reviewRounds: reached.reviewRounds,
    title: PREVIEW_TITLE,
    tasks,
  };
}
