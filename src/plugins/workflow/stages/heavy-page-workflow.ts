// Heavy's page half: its stages, its checklist from the read plan, and what its
// actions, countdown, progress and preview read from its state.

import type {
  ChecklistGroup,
  ChecklistItem,
  ChecklistView,
  PageWorkflow,
  SessionFlow,
  WorkflowDraw,
} from '../contract';
import { countdownText } from '../page/countdown';
import { PREVIEW_SAMPLES, previewFlow } from '../page/preview';
import type { PlanProgress } from '../plan-reader';
import { HEAVY_WORKFLOW_ID, heavyStateOf } from './heavy-contract';
import { BUILT_IN_PAGE_STAGES } from './index';

const PLAN_FILE = 'plan.md';
const TASKS_GROUP_TITLE = 'Tasks';

// `runMainAction` runs a command in main; `openDoc` opens a file in Docs mode;
// `autoStartSeconds` is the countdown setting the preview's samples run.
export interface HeavyPageDeps {
  draw: WorkflowDraw;
  runMainAction(sessionId: string, command: string): Promise<void>;
  openDoc(path: string): void;
  join(a: string, b: string): string;
  autoStartSeconds(): number;
}

// The read plan as a checklist; null until the plan is read.
export function planChecklist(flow: SessionFlow): ChecklistView | null {
  const { progress } = heavyStateOf(flow);
  return progress === null
    ? null
    : {
        title: progress.title,
        checked: progress.checked,
        total: progress.total,
        groups: waves(progress),
      };
}

export function heavyPageWorkflow(deps: HeavyPageDeps): PageWorkflow {
  return {
    id: HEAVY_WORKFLOW_ID,
    label: 'Heavy',
    badge: 'H',
    stages: BUILT_IN_PAGE_STAGES,
    draw: deps.draw,
    checklist: planChecklist,
    async runAction(sessionId, command, flow) {
      if (command !== 'openPlan') {
        await deps.runMainAction(sessionId, command);
        return;
      }
      const { planDir } = heavyStateOf(flow);
      if (planDir === null) {
        throw new Error('the session has no plan');
      }
      deps.openDoc(deps.join(planDir, PLAN_FILE));
    },
    countdownText(flow, now) {
      const { countdownEndsAt } = heavyStateOf(flow);
      return countdownEndsAt === null
        ? null
        : countdownText(countdownEndsAt, now);
    },
    progressText(flow) {
      const { progress } = heavyStateOf(flow);
      return progress === null ? null : progressText(progress);
    },
    hasPlan: (flow) => heavyStateOf(flow).progress !== null,
    previewFlows: (sessionId, now) =>
      PREVIEW_SAMPLES.map((_, index) =>
        previewFlow(index, sessionId, now, deps.autoStartSeconds()),
      ),
  };
}

// `<checked>/<total>`, then ` wave <n>` while a wave is open and
// ` review <r>` once a review round is logged.
function progressText(progress: PlanProgress): string {
  const wave = progress.wave === null ? '' : ` wave ${progress.wave}`;
  const review =
    progress.reviewRounds > 0 ? ` review ${progress.reviewRounds}` : '';
  return `${progress.checked}/${progress.total}${wave}${review}`;
}

// The plan's boxes grouped by the wave each sits under, in the order the
// waves first appear; boxes under no wave heading are the `Tasks` group.
function waves(progress: PlanProgress): ChecklistGroup[] {
  const groups = new Map<number | null, ChecklistItem[]>();
  for (const task of progress.tasks) {
    const group = groups.get(task.wave) ?? [];
    group.push({ text: task.text, done: task.done });
    groups.set(task.wave, group);
  }
  return [...groups].map(([wave, items]) => ({
    title: wave === null ? TASKS_GROUP_TITLE : `Wave ${wave}`,
    items,
  }));
}
