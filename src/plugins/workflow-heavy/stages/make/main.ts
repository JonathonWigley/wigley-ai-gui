import { startsSkill } from '../../../workflow/contract';
import type { HeavyMainStage } from '../../contract';

export const makeMainStage: HeavyMainStage = {
  id: 'make',
  order: 40,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:make') ? 'make' : null;
  },
  recordsReviewRounds: true,
};
