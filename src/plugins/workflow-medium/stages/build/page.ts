import {
  busyStatus,
  defaultChecklist,
  type PageStage,
  type SessionFlow,
} from '../../../workflow/contract';

// `<checked>/<total>` of the flow's checklist; null with no list or an empty one.
export function checklistCount(flow: SessionFlow): string | null {
  const checklist = defaultChecklist(flow);
  return checklist === null || checklist.total === 0
    ? null
    : `${checklist.checked}/${checklist.total}`;
}

export const buildPageStage: PageStage = {
  id: 'build',
  label: 'Build',
  inStepper: true,
  runsTasks: true,
  order: 20,
  actions: [],
  detail: () => '',
  status: busyStatus,
  statusProgress(flow) {
    const count = checklistCount(flow);
    return count === null ? '' : ` ${count}`;
  },
};
