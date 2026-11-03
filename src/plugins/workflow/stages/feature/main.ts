import { type MainStage, startsSkill } from '../../contract';

export const featureMainStage: MainStage = {
  id: 'feature',
  order: 20,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:feature') ? 'feature' : null;
  },
  clearsPlan: true,
};
