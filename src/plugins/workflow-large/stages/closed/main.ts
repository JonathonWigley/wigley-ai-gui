import type { MainStage } from '../../../workflow/contract';
import { largeEventOf, largeStateOf } from '../../contract';

// Closes only a plan folder that was read: `wigley:make` naming a folder not
// written yet keeps make until its plan.md is written.

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  finishes: true,
  enter(flow, signal) {
    const inRun = ['make', 'review', 'fix'].includes(flow.stage);
    const planWasRead = largeStateOf(flow).progress !== null;
    const planGone = largeEventOf(signal)?.type === 'planGone';
    return planGone && inRun && planWasRead ? 'closed' : null;
  },
};
