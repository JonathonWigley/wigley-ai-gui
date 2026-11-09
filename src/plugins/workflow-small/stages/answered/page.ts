import type { PageStage } from '../../../workflow/contract';

// Off the trail and with no status, so the row's tag and every step read neutral.
export const answeredPageStage: PageStage = {
  id: 'answered',
  label: 'Answered',
  inStepper: false,
  order: 60,
  actions: [],
  detail: () => '',
  status: () => null,
};
