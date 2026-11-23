// A declared workflow's layout preview samples: one flow per stage, in stage
// order, idle, with the sample checklist or plan its side pane reads and the
// countdown running on an `auto` stage.

import type { Paths } from '../../../contracts/paths';
import {
  type DeclaredWorkflow,
  type PlanState,
  type PlanTaskLine,
  sampleChecklist,
  sampleFlow,
  type SessionFlow,
} from '../contract';
import { planCounterOf, templateVariables } from './templates';

// The folder every sample flow names.
export const PREVIEW_PROJECT_DIR = 'Workflow preview';

// How long a sample countdown has left.
const SAMPLE_COUNTDOWN_MS = 10_000;

const SAMPLE_CHECKLIST = ['Read the code', 'Make the change', 'Run the tests'];

const SAMPLE_TASKS: readonly Pick<PlanTaskLine, 'group' | 'text'>[] = [
  { group: 1, text: 'Write the contract' },
  { group: 1, text: 'Read the plan file' },
  { group: 1, text: 'Fold the signals' },
  { group: 2, text: 'Draw the row chip' },
  { group: 2, text: 'Add the side pane' },
];

const SAMPLE_CHECKED = 2;

export function previewFlows(
  workflow: DeclaredWorkflow,
  sessionId: string,
  now: number,
  paths: Pick<Paths, 'join'>,
): SessionFlow[] {
  const { decl } = workflow;
  const isPlanPane = decl.sidePane.kind === 'plan';
  const plan = isPlanPane ? samplePlan(workflow, paths) : null;
  const checklist = isPlanPane ? null : sampleChecklist(SAMPLE_CHECKLIST, 1);
  return decl.stages.map((stage) =>
    sampleFlow(sessionId, PREVIEW_PROJECT_DIR, {
      workflow: workflow.id,
      stage: stage.id,
      checklist,
      checklistReported: checklist !== null,
      plan,
      countdownEndsAt:
        stage.auto === undefined ? null : now + SAMPLE_COUNTDOWN_MS,
    }),
  );
}

function samplePlan(
  workflow: DeclaredWorkflow,
  paths: Pick<Paths, 'join'>,
): PlanState {
  const tasks: PlanTaskLine[] = SAMPLE_TASKS.map((task, index) => ({
    ...task,
    done: index < SAMPLE_CHECKED,
    file: null,
    status: null,
    verification: false,
  }));
  const counters = Object.fromEntries(
    namedPlanCounters(workflow).map((name) => [name, 1]),
  );
  return {
    dir: paths.join(PREVIEW_PROJECT_DIR, 'plan-sample'),
    reported: true,
    unreportedDir: null,
    progress: {
      title: 'Sample plan',
      checked: SAMPLE_CHECKED,
      total: tasks.length,
      wave: tasks.find((task) => !task.done)?.group ?? null,
      counters,
      tasks,
    },
    snapshots: {},
  };
}

// Every `{plan.counter.X}` the declaration's templates name.
function namedPlanCounters(workflow: DeclaredWorkflow): string[] {
  const { decl } = workflow;
  const templates = [
    ...decl.stages.flatMap((stage) => [
      stage.progress ?? '',
      stage.chipProgress ?? '',
      ...(stage.detail ?? []),
    ]),
    ...Object.values(decl.actions ?? {}).map((action) => action.text ?? ''),
  ];
  const names = templates
    .flatMap(templateVariables)
    .map(planCounterOf)
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}
