import { busyStatus, type PageStage } from '../../../workflow/contract';

export const interviewPageStage: PageStage = {
  id: 'interview',
  label: 'Interview',
  inStepper: true,
  order: 10,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
