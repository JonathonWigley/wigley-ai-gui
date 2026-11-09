import { type MainStage, reportsStep } from '../../../workflow/contract';

export const buildMainStage: MainStage = {
  id: 'build',
  order: 20,
  reportedAs: 'build',
  enter(_flow, signal) {
    return reportsStep(signal, 'build') ? 'build' : null;
  },
};
