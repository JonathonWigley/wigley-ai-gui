// Large's layout preview samples: one flow per press, through every Large
// stage, make both busy and not, the plan-ready countdown on the second plan
// ready. The stage ids are sample data, not stage rules.
import type { StageId, SessionFlow } from '../../workflow/contract';
import type {
  PlanProgress,
  PlanTaskLine,
  TaskStatus,
} from '../../../shared/plan-progress';
import { LARGE_WORKFLOW_ID, type LargeState } from '../contract';

// `busy` sets the sample's `turnRunning`; `countdown` starts its auto-start.
export const PREVIEW_SAMPLES: readonly {
  stage: StageId;
  busy: boolean;
  countdown: boolean;
}[] = [
  { stage: 'idle', busy: false, countdown: false },
  { stage: 'primer', busy: true, countdown: false },
  { stage: 'explore', busy: false, countdown: false },
  { stage: 'interview', busy: true, countdown: false },
  { stage: 'plan', busy: false, countdown: false },
  { stage: 'coldRead', busy: true, countdown: false },
  { stage: 'planReady', busy: false, countdown: false },
  { stage: 'planReady', busy: false, countdown: true },
  { stage: 'make', busy: true, countdown: false },
  { stage: 'make', busy: false, countdown: false },
  { stage: 'review', busy: true, countdown: false },
  { stage: 'fix', busy: true, countdown: false },
  { stage: 'closed', busy: false, countdown: false },
];

const PREVIEW_PROJECT = 'Workflow preview';
const PREVIEW_PLAN_DIR = '~/docs/features/preview/plan-preview';
const PREVIEW_TITLE = 'Preview plan';

// The sample plan's seven tasks, by the wave each sits under.
const PREVIEW_TASKS: readonly Omit<PlanTaskLine, 'done' | 'status'>[] = [
  { wave: 1, text: 'Write the contract', file: null },
  { wave: 1, text: 'Read the plan file', file: null },
  { wave: 1, text: 'Fold the signals', file: null },
  { wave: 2, text: 'Draw the row chip', file: null },
  { wave: 2, text: 'Draw the composer strip', file: null },
  { wave: 2, text: 'Add the side pane', file: null },
  { wave: 3, text: 'Run the self-test', file: null },
];

// The stages whose sample tasks carry a status: each done task `done`, the
// first open one `in progress`.
const STAGES_RUNNING_TASKS: ReadonlySet<StageId> = new Set([
  'make',
  'review',
  'fix',
]);

// How far the sample plan has come at each stage that has one.
const PREVIEW_PROGRESS: Readonly<
  Record<StageId, { checked: number; reviewRounds: number }>
> = {
  plan: { checked: 0, reviewRounds: 0 },
  coldRead: { checked: 0, reviewRounds: 0 },
  planReady: { checked: 0, reviewRounds: 0 },
  make: { checked: 3, reviewRounds: 0 },
  review: { checked: 6, reviewRounds: 1 },
  fix: { checked: 6, reviewRounds: 1 },
  closed: { checked: 7, reviewRounds: 1 },
};

// The sample flow `index` of PREVIEW_SAMPLES shows, over the preview session.
export function previewFlow(
  index: number,
  sessionId: string,
  now: number,
  autoStartSeconds: number,
): SessionFlow {
  const { stage, busy, countdown } = PREVIEW_SAMPLES[index];
  const progress = previewProgress(stage);
  const state: LargeState = {
    planDir: progress === null ? null : PREVIEW_PLAN_DIR,
    progress,
    reviewRoundsAtMake: null,
    countdownEndsAt: countdown ? now + autoStartSeconds * 1000 : null,
  };
  return {
    sessionId,
    projectDir: PREVIEW_PROJECT,
    workflow: LARGE_WORKFLOW_ID,
    movedUpFrom: null,
    stage,
    checklist: null,
    state,
    missedLevel: false,
    turnRunning: busy,
    runningSubagents: [],
  };
}

function previewProgress(stage: StageId): PlanProgress | null {
  const reached = PREVIEW_PROGRESS[stage];
  if (reached === undefined) {
    return null;
  }
  const runsTasks = STAGES_RUNNING_TASKS.has(stage);
  const tasks = PREVIEW_TASKS.map((task, index) => ({
    ...task,
    done: index < reached.checked,
    status: runsTasks ? sampleStatus(index, reached.checked) : null,
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

function sampleStatus(index: number, checked: number): TaskStatus | null {
  if (index < checked) {
    return 'done';
  }
  return index === checked ? 'in progress' : null;
}
