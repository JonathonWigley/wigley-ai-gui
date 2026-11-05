import { type MainStage, reportsStep } from '../../contract';

export const fixMainStage: MainStage = {
  id: 'fix',
  order: 55,
  reportedAs: 'fix',
  enter(flow, signal) {
    const inMakeOrReview = flow.stage === 'make' || flow.stage === 'review';
    return reportsStep(signal, 'fix') && inMakeOrReview ? 'fix' : null;
  },
};
