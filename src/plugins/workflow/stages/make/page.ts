import {
  busyStatus,
  detailLine,
  isBusy,
  type PageStage,
  statusText,
} from '../../contract';

const label = 'Make';
const status = busyStatus;

export const makePageStage: PageStage = {
  id: 'make',
  label,
  inStepper: true,
  stepSlot: 'make',
  runsTasks: true,
  order: 40,
  actions: [
    {
      command: 'resumeMake',
      label: 'Resume make',
      side: 'main',
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
  status,
  statusLine(flow) {
    const line = statusText(label, status(flow));
    const progress = flow.progress;
    return progress === null
      ? line
      : `${line} ${progress.checked}/${progress.total}`;
  },
};
