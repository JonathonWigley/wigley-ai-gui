import { busyStatus, type PageStage } from '../../../workflow/contract';

export const landPageStage: PageStage = {
  id: 'land',
  label: 'Land',
  inStepper: true,
  stepSlot: 'land',
  order: 40,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
