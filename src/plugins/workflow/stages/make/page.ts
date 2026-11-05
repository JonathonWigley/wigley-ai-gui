import { busyStatus, detailLine, isBusy, type PageStage } from '../../contract';

export const makePageStage: PageStage = {
  id: 'make',
  label: 'Make',
  inStepper: true,
  stepSlot: 'make',
  runsTasks: true,
  order: 40,
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
    const wave = progress.wave === null ? '' : `wave ${progress.wave}`;
    return detailLine(
      `${progress.checked}/${progress.total}`,
      wave,
      progress.title,
    );
  },
  status: busyStatus,
  statusProgress(flow) {
    const progress = flow.progress;
    return progress === null ? '' : ` ${progress.checked}/${progress.total}`;
  },
};
