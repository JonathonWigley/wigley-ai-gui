import type { PlanFormat } from '../../../contracts/contributions';
import {
  type ChecklistGroup,
  type ChecklistItem,
  defaultChecklist,
  type PlanProgress,
} from '../contract';
import type { PlanPane } from '../declared/plan-pane';

const TASKS_GROUP_TITLE = 'Tasks';
const GROUP_NUMBER = '{1}';

// The read plan as a checklist; until the plan is read, the agent's own
// checklist (`defaultChecklist`).
export function createPlanPane(): PlanPane {
  return {
    checklist(flow, format) {
      const progress = flow.plan?.progress ?? null;
      return progress === null
        ? defaultChecklist(flow)
        : {
            title: progress.title,
            checked: progress.checked,
            total: progress.total,
            groups: groups(progress, format),
          };
    },
  };
}

// The plan's boxes grouped by the group each sits under, in the order the
// groups first appear: each titled `groupHeading.title` with its number, and
// boxes under no group, or every box with no `groupHeading`, the `Tasks`
// group. A box runs while its task document's status is `taskDocs.running`.
function groups(
  progress: PlanProgress,
  format: PlanFormat | null,
): ChecklistGroup[] {
  const byGroup = new Map<number | null, ChecklistItem[]>();
  const running = format?.taskDocs?.running;
  const groupHeading = format?.groupHeading;
  for (const task of progress.tasks) {
    const group = groupHeading === undefined ? null : task.group;
    const items = byGroup.get(group) ?? [];
    items.push({
      text: task.text,
      done: task.done,
      running: running !== undefined && task.status === running,
    });
    byGroup.set(group, items);
  }
  const titleOf = (group: number | null) =>
    group === null || groupHeading === undefined
      ? TASKS_GROUP_TITLE
      : groupHeading.title.replaceAll(GROUP_NUMBER, String(group));
  return [...byGroup].map(([group, items]) => ({
    title: titleOf(group),
    items,
  }));
}
