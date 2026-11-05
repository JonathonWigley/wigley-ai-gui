import { type MainStage, reportsStep } from '../../../workflow/contract';

export const fixMainStage: MainStage = {
  id: 'fix',
  order: 40,
  reportedAs: 'fix',
  enter(_flow, signal) {
    return reportsStep(signal, 'fix') ? 'fix' : null;
  },
};
