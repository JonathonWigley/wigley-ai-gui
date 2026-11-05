import { type MainStage, reportsStep } from '../../contract';
import { isInFeatureRun } from '../feature-run';

export const coldReadMainStage: MainStage = {
  id: 'coldRead',
  order: 26,
  reportedAs: 'cold_read',
  enter(flow, signal) {
    return reportsStep(signal, 'coldRead') && isInFeatureRun(flow)
      ? 'coldRead'
      : null;
  },
};
