import type { PageStage } from '../../contract';

export const primerPageStage: PageStage = {
  id: 'primer',
  label: 'Primer',
  inStepper: true,
  order: 10,
  actions: [
    {
      command: 'startFeature',
      label: 'Start feature',
      side: 'page',
      available: () => true,
      enabled: () => true,
    },
  ],
  detail: () => '',
};
