import { busyStatus, type PageStage } from '../../contract';
import { OPEN_PLAN_ACTION, planTitleDetail } from '../stage-parts';

export const interviewPageStage: PageStage = {
  id: 'interview',
  label: 'Interview',
  inStepper: true,
  order: 22,
  actions: [OPEN_PLAN_ACTION],
  detail: planTitleDetail,
  status: busyStatus,
};
