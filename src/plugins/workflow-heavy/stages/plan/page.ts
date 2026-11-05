import { busyStatus, type PageStage } from '../../../workflow/contract';
import { OPEN_PLAN_ACTION, planTitleDetail } from '../stage-parts';

export const planPageStage: PageStage = {
  id: 'plan',
  label: 'Plan',
  inStepper: true,
  order: 24,
  actions: [OPEN_PLAN_ACTION],
  detail: planTitleDetail,
  status: busyStatus,
};
