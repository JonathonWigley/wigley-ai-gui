import { busyStatus, type PageStage } from '../../../workflow/contract';

export const reviewPageStage: PageStage = {
  id: 'review',
  label: 'Review',
  inStepper: true,
  order: 30,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
