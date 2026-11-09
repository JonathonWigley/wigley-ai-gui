import { type MainStage, reportsStep } from '../../../workflow/contract';

export const checkMainStage: MainStage = {
  id: 'check',
  order: 30,
  reportedAs: 'check',
  enter(_flow, signal) {
    return reportsStep(signal, 'check') ? 'check' : null;
  },
};
