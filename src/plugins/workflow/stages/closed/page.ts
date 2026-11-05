import {
  detailLine,
  isBusy,
  type PageStage,
  STAGE_ACTIVITY_RANK,
} from '../../contract';

export const closedPageStage: PageStage = {
  id: 'closed',
  label: 'Close',
  inStepper: true,
  order: 60,
  actions: [
    {
      command: 'retro',
      label: 'Retro',
      side: 'main',
      available: () => true,
      enabled: (flow) => !isBusy(flow),
    },
    {
      command: 'dismiss',
      label: 'Dismiss',
      side: 'main',
      keyOnly: true,
      available: () => true,
      enabled: () => true,
    },
  ],
  detail: (flow) =>
    flow.progress === null ? '' : detailLine(flow.progress.title, 'done'),
  status: () => 'done',
  statusProgress(flow) {
    const progress = flow.progress;
    return progress === null ? '' : ` · ${progress.checked}/${progress.total}`;
  },
  rowActivity: {
    word: 'closed',
    tone: 'success',
    rank: STAGE_ACTIVITY_RANK,
    emphasis: 'raised',
  },
};
