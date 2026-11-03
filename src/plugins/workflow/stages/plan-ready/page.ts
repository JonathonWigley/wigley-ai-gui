import { detailLine, isBusy, type PageStage } from '../../contract';

export const planReadyPageStage: PageStage = {
  id: 'planReady',
  label: 'Plan',
  inStepper: true,
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
};
