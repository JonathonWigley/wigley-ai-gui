import {
  busyStatus,
  checklistCount,
  type PageStage,
} from '../../../workflow/contract';

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
