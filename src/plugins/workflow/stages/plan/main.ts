import { type MainStage, reportsStep } from '../../contract';
import { isInFeatureRun } from '../feature-run';

export const planMainStage: MainStage = {
  id: 'plan',
  order: 24,
  reportedAs: 'plan',
  enter(flow, signal) {
    return reportsStep(signal, 'plan') && isInFeatureRun(flow) ? 'plan' : null;
  },
};
