import { startsSkill } from '../../../workflow/contract';
import type { LargeMainStage } from '../../contract';

export const makeMainStage: LargeMainStage = {
  id: 'make',
  order: 40,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:make') ? 'make' : null;
  },
  recordsReviewRounds: true,
};
