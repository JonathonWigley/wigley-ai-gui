import { isBusy, type PageStage } from '../../contract';

export const reviewPageStage: PageStage = {
  id: 'review',
  label: 'Review',
  inStepper: true,
  order: 50,
  actions: [
    {
      command: 'resumeMake',
      label: 'Resume make',
      side: 'main',
      available: (flow) =>
        flow.progress !== null && flow.progress.checked < flow.progress.total,
      enabled: (flow) => !isBusy(flow),
    },
    {
      command: 'openPlan',
      label: 'Open plan',
      side: 'page',
      available: (flow) => flow.planDir !== null,
      enabled: () => true,
    },
  ],
  detail(flow) {
    const progress = flow.progress;
    if (progress === null) {
      return '';
    }
    const boxes = `${progress.checked}/${progress.total}`;
    return progress.reviewRounds === 0
      ? boxes
      : `round ${progress.reviewRounds} · ${boxes}`;
  },
};
