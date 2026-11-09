import type { MainStage } from '../../../workflow/contract';
import { largeEventOf, largeStateOf } from '../../contract';

// Closes only a plan folder that was read: `wigley:make` naming a folder not
// written yet keeps make until its plan.md is written. A closed run whose plan
// folder is read again reopens in the stage it closed from: the folder left
// with a branch switch or a checkout and came back, so the run never ended.

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  finishes: true,
  enter(flow, signal) {
    const { progress, closedFrom } = largeStateOf(flow);
    const event = largeEventOf(signal)?.type;
    if (flow.stage === 'closed') {
      return event === 'planChanged' ? closedFrom : null;
    }
    const inRun = ['make', 'review', 'fix'].includes(flow.stage);
    const planWasRead = progress !== null;
    return event === 'planGone' && inRun && planWasRead ? 'closed' : null;
  },
};
