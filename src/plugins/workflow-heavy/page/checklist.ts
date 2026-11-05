import type {
  ChecklistGroup,
  ChecklistItem,
  ChecklistView,
  SessionFlow,
} from '../../workflow/contract';
import { heavyStateOf } from '../contract';
import type { PlanProgress } from '../plan-reader';

const TASKS_GROUP_TITLE = 'Tasks';

// The read plan as a checklist; null until the plan is read.
export function heavyChecklist(flow: SessionFlow): ChecklistView | null {
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
