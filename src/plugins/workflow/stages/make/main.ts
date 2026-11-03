import { type MainStage, startsSkill } from '../../contract';

export const makeMainStage: MainStage = {
  id: 'make',
  order: 40,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:make') ? 'make' : null;
  },
  recordsReviewRounds: true,
};
