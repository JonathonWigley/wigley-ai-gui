import { type MainStage, reportsStep } from '../../../workflow/contract';

export const doneMainStage: MainStage = {
  id: 'done',
  order: 60,
  reportedAs: 'done',
  finishes: true,
  enter(_flow, signal) {
    return reportsStep(signal, 'done') ? 'done' : null;
  },
};
