import { isBusy, type MainStage } from '../../contract';
import { isInFeatureRun } from '../feature-run';

// Waits for nothing busy and a plan with a box: wigley:feature drafts its task
// documents in background subagents after writing plan.md.
export const planReadyMainStage: MainStage = {
  id: 'planReady',
  order: 30,
  enter(flow, signal) {
    const isPlanSignal =
      signal.type === 'turnEnded' || signal.type === 'planChanged';
    const planHasABox =
      flow.planDir !== null &&
      flow.progress !== null &&
      flow.progress.total > 0;
    const inRunBeforeReady = isInFeatureRun(flow) && flow.stage !== 'planReady';
    return isPlanSignal && inRunBeforeReady && !isBusy(flow) && planHasABox
      ? 'planReady'
      : null;
  },
  autoCommand: 'clearAndMake',
};
