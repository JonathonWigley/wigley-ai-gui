import { busyStatus, detailLine, isBusy, type PageStage } from '../../contract';

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
      keyOnly: true,
      available: (flow) =>
        !isBusy(flow) &&
        flow.progress !== null &&
        flow.progress.checked < flow.progress.total,
      enabled: () => true,
    },
    {
      command: 'openPlan',
      label: 'Open plan',
      side: 'page',
      keyOnly: true,
      available: (flow) => flow.planDir !== null,
      enabled: () => true,
    },
  ],
  detail(flow) {
    const progress = flow.progress;
    if (progress === null) {
      return '';
    }
    const round =
      progress.reviewRounds === 0 ? '' : `round ${progress.reviewRounds}`;
    return detailLine(
      round,
      `${progress.checked}/${progress.total}`,
      progress.title,
    );
  },
  status: busyStatus,
  statusProgress(flow) {
    const rounds = flow.progress?.reviewRounds ?? 0;
    return rounds === 0 ? '' : ` · round ${rounds}`;
  },
};
