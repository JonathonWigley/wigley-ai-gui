import { busyStatus, type PageStage } from '../../../workflow/contract';

export const scopePageStage: PageStage = {
  id: 'scope',
  label: 'Scope',
  inStepper: true,
  order: 10,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
