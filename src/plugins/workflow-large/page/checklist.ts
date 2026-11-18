import {
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistView,
  defaultChecklist,
  type SessionFlow,
} from '../../workflow/contract';
import { largeStateOf } from '../contract';
import type { PlanProgress } from '../../../shared/plan-progress';

const TASKS_GROUP_TITLE = 'Tasks';

// The read plan as a checklist; until the plan is read, the agent's own
// checklist (`defaultChecklist`).
export function largeChecklist(flow: SessionFlow): ChecklistView | null {
  const { progress } = largeStateOf(flow);
  return progress === null
    ? defaultChecklist(flow)
    : {
        title: progress.title,
        checked: progress.checked,
        total: progress.total,
        groups: waves(progress),
      };
}

// The plan's boxes grouped by the wave each sits under, in the order the
// waves first appear; boxes under no wave heading are the `Tasks` group.
function waves(progress: PlanProgress): ChecklistGroup[] {
  const groups = new Map<number | null, ChecklistItem[]>();
  for (const task of progress.tasks) {
    const group = groups.get(task.wave) ?? [];
    group.push({
      text: task.text,
      done: task.done,
      running: task.status === 'in progress',
    });
    groups.set(task.wave, group);
  }
  return [...groups].map(([wave, items]) => ({
    title: wave === null ? TASKS_GROUP_TITLE : `Wave ${wave}`,
    items,
  }));
}
