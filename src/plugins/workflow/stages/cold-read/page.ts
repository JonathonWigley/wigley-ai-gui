import { busyStatus, type PageStage } from '../../contract';
import { OPEN_PLAN_ACTION, planTitleDetail } from '../stage-parts';

export const coldReadPageStage: PageStage = {
  id: 'coldRead',
  label: 'Cold read',
  inStepper: true,
  order: 26,
  actions: [OPEN_PLAN_ACTION],
  detail: planTitleDetail,
  status: busyStatus,
};
