import { isBusy } from '../../../workflow/contract';
import { isInFeatureRun } from '../feature-run';
import {
  heavyEventOf,
  type HeavyMainStage,
  heavyStateOf,
} from '../../contract';

// Waits for nothing busy and a plan with a box: wigley:feature drafts its task
// documents in background subagents after writing plan.md.
export const planReadyMainStage: HeavyMainStage = {
  id: 'planReady',
  order: 30,
  enter(flow, signal) {
    const isPlanSignal =
      signal.type === 'turnEnded' ||
      heavyEventOf(signal)?.type === 'planChanged';
    const { planDir, progress } = heavyStateOf(flow);
    const planHasABox =
      planDir !== null && progress !== null && progress.total > 0;
    const inRunBeforeReady = isInFeatureRun(flow) && flow.stage !== 'planReady';
    return isPlanSignal && inRunBeforeReady && !isBusy(flow) && planHasABox
      ? 'planReady'
      : null;
  },
  autoCommand: 'clearAndMake',
};
