import {
  type PageStage,
  STAGE_ACTIVITY_RANK,
} from '../../../workflow/contract';

// Off the trail and with no status, so the row's tag and every step read neutral.
// A turn ending here unseen reads answered on the row in place of done.
export const answeredPageStage: PageStage = {
  id: 'answered',
  label: 'Answered',
  inStepper: false,
  order: 60,
  actions: [],
  detail: () => '',
  status: () => null,
  unseenActivity: {
    word: 'answered',
    tone: 'success',
    rank: STAGE_ACTIVITY_RANK,
  },
};
