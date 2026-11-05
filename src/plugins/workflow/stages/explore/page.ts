import { busyStatus, type PageStage } from '../../contract';
import { OPEN_PLAN_ACTION, planTitleDetail } from '../stage-parts';

export const explorePageStage: PageStage = {
  id: 'explore',
  label: 'Explore',
  inStepper: true,
  stepSlot: 'start',
  order: 20,
  actions: [OPEN_PLAN_ACTION],
  detail: planTitleDetail,
  status: busyStatus,
};
