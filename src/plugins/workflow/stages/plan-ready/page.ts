import { detailLine, isBusy, type PageStage, statusText } from '../../contract';

const label = 'Make';
const status: PageStage['status'] = () => 'ready';

export const planReadyPageStage: PageStage = {
  id: 'planReady',
  label,
  inStepper: true,
  stepSlot: 'make',
  order: 30,
  actions: [
    {
      command: 'cancelCountdown',
      label: 'Cancel',
      side: 'main',
      available: (flow) => flow.countdownEndsAt !== null,
      enabled: () => true,
    },
    {
      command: 'clearAndMake',
      label: 'Clear & make',
      side: 'main',
      available: () => true,
      enabled: (flow) => !isBusy(flow),
    },
    {
      command: 'makeInNewSession',
      label: 'Make in new session',
      side: 'main',
      available: () => true,
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
  detail: (flow) =>
    flow.progress === null
      ? ''
      : detailLine(flow.progress.title, `${flow.progress.total} tasks`),
  status,
  statusLine: (flow) => statusText(label, status(flow)),
};
