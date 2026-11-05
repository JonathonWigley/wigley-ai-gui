import { reportsStep, startsSkill } from '../../../workflow/contract';
import { isInFeatureRun } from '../feature-run';
import type { HeavyMainStage } from '../../contract';

export const exploreMainStage: HeavyMainStage = {
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
