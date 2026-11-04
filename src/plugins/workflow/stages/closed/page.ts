import { detailLine, isBusy, type PageStage, statusText } from '../../contract';

const label = 'Close';
const status: PageStage['status'] = () => 'done';

export const closedPageStage: PageStage = {
  id: 'closed',
  label,
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
      available: () => true,
      enabled: () => true,
    },
  ],
  detail: (flow) =>
    flow.progress === null ? '' : detailLine(flow.progress.title, 'done'),
  status,
  statusLine(flow) {
    const progress = flow.progress;
    return detailLine(
      statusText(label, status(flow)),
      progress === null ? '' : `${progress.checked}/${progress.total}`,
    );
  },
};
