import { IDLE_STAGE, type PageStage } from '../../contract';

export const idlePageStage: PageStage = {
  id: IDLE_STAGE,
  label: 'Idle',
  inStepper: false,
  order: 0,
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
