import {
  busyStatus,
  detailLine,
  isBusy,
  type PageStage,
  statusText,
} from '../../contract';

const label = 'Review';
const status = busyStatus;

export const reviewPageStage: PageStage = {
  id: 'review',
  label,
  inStepper: true,
  order: 50,
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
    const round =
      progress.reviewRounds === 0 ? '' : `round ${progress.reviewRounds}`;
    return detailLine(
      round,
      `${progress.checked}/${progress.total}`,
      progress.title,
    );
  },
  status,
  statusLine(flow) {
    const rounds = flow.progress?.reviewRounds ?? 0;
    return detailLine(
      statusText(label, status(flow)),
      rounds === 0 ? '' : `round ${rounds}`,
    );
  },
};
