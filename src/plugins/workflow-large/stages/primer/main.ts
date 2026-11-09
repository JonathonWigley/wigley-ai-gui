import { startsSkill } from '../../../workflow/contract';
import type { LargeMainStage } from '../../contract';

export const primerMainStage: LargeMainStage = {
  id: 'primer',
  order: 10,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:feature-primer') ? 'primer' : null;
  },
  clearsPlan: true,
};
