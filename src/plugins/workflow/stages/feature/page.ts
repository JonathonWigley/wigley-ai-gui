import type { PageStage } from '../../contract';

export const featurePageStage: PageStage = {
  id: 'feature',
  label: 'Feature',
  inStepper: true,
  stepSlot: 'start',
  order: 20,
  actions: [
    {
      command: 'openPlan',
      label: 'Open plan',
      side: 'page',
      available: (flow) => flow.planDir !== null,
      enabled: () => true,
    },
  ],
  detail: (flow) => (flow.progress === null ? '' : flow.progress.title),
};
