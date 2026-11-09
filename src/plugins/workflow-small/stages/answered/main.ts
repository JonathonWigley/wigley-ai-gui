import { type MainStage, reportsStep } from '../../../workflow/contract';

// A session that only answered: it finishes the run as done does, with nothing built.
export const answeredMainStage: MainStage = {
  id: 'answered',
  order: 60,
  reportedAs: 'answered',
  finishes: true,
  enter(_flow, signal) {
    return reportsStep(signal, 'answered') ? 'answered' : null;
  },
};
