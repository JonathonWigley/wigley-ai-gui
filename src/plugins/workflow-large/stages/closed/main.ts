import type { MainStage } from '../../../workflow/contract';
import { largeEventOf, largeStateOf } from '../../contract';

// Closes only a plan folder that was read: `wigley:make` naming a folder not
// written yet keeps make until its plan.md is written. A closed run whose plan
// is read again while its turn or a subagent runs reopens in the stage it
// closed from: the folder left with a branch switch or a checkout and came
// back, so the run never ended. A read with nothing running, such as a
// reopened session finding a copy another checkout still holds, leaves a
// finished run closed.

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  finishes: true,
  enter(flow, signal) {
    const { progress, closedFrom } = largeStateOf(flow);
    const event = largeEventOf(signal)?.type;
    if (flow.stage === 'closed') {
      const isLive = flow.turnRunning || flow.runningSubagents.length > 0;
      return event === 'planChanged' && isLive ? closedFrom : null;
    }
    const inRun = ['make', 'review', 'fix'].includes(flow.stage);
    const planWasRead = progress !== null;
    return event === 'planGone' && inRun && planWasRead ? 'closed' : null;
  },
};
