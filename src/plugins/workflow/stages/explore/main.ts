import { type MainStage, reportsStep, startsSkill } from '../../contract';
import { isInFeatureRun } from '../feature-run';

export const exploreMainStage: MainStage = {
  id: 'explore',
  order: 20,
  reportedAs: 'explore',
  enter(flow, signal) {
    const reportedInRun =
      reportsStep(signal, 'explore') && isInFeatureRun(flow);
    return startsSkill(signal, 'wigley:feature') || reportedInRun
      ? 'explore'
      : null;
  },
  clearsPlan: true,
};
