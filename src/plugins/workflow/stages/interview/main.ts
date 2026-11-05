import { type MainStage, reportsStep } from '../../contract';
import { isInFeatureRun } from '../feature-run';

export const interviewMainStage: MainStage = {
  id: 'interview',
  order: 22,
  reportedAs: 'interview',
  enter(flow, signal) {
    return reportsStep(signal, 'interview') && isInFeatureRun(flow)
      ? 'interview'
      : null;
  },
};
