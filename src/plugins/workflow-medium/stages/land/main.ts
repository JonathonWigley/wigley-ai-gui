import { type MainStage, reportsStep } from '../../../workflow/contract';

export const landMainStage: MainStage = {
  id: 'land',
  order: 50,
  reportedAs: 'land',
  enter(_flow, signal) {
    return reportsStep(signal, 'land') ? 'land' : null;
  },
};
