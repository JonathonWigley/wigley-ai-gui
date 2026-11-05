import { IDLE_STAGE, type PageStage } from '../../../workflow/contract';

export const idlePageStage: PageStage = {
  id: IDLE_STAGE,
  label: 'Idle',
  inStepper: false,
  order: 0,
  actions: [],
  detail: () => '',
  status: () => null,
};
