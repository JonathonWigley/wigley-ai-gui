import { type MainStage, reportsStep } from '../../../workflow/contract';

export const reviewMainStage: MainStage = {
  id: 'review',
  order: 30,
  reportedAs: 'review',
  enter(_flow, signal) {
    return reportsStep(signal, 'review') ? 'review' : null;
  },
};
