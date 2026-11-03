import { type MainStage, startsSkill } from '../../contract';

export const primerMainStage: MainStage = {
  id: 'primer',
  order: 10,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:feature-primer') ? 'primer' : null;
  },
  clearsPlan: true,
};
