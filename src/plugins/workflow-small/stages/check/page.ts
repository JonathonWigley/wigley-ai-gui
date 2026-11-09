import { busyStatus, type PageStage } from '../../../workflow/contract';

export const checkPageStage: PageStage = {
  id: 'check',
  label: 'Check',
  inStepper: true,
  order: 30,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
