import { isBusy, type PageStage } from '../../contract';

export const closedPageStage: PageStage = {
  id: 'closed',
  label: 'Closed',
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
    flow.progress === null ? '' : `${flow.progress.title} · done`,
};
