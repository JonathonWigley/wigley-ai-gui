import { startsSkill } from '../../contract';
import type { HeavyMainStage } from '../heavy-contract';

export const primerMainStage: HeavyMainStage = {
  id: 'primer',
  order: 10,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:feature-primer') ? 'primer' : null;
  },
  clearsPlan: true,
};
