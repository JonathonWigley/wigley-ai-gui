import { finishingStatus, type PageStage } from '../../../workflow/contract';

export const donePageStage: PageStage = {
  id: 'done',
  label: 'Land',
  inStepper: true,
  stepSlot: 'land',
  order: 60,
  actions: [],
  detail: () => '',
  status: finishingStatus,
};
