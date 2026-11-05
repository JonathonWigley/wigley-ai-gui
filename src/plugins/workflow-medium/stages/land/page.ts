import { busyStatus, type PageStage } from '../../../workflow/contract';

export const landPageStage: PageStage = {
  id: 'land',
  label: 'Land',
  inStepper: true,
  stepSlot: 'land',
  order: 50,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
