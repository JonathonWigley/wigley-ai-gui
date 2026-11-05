import type { MainStage } from '../../contract';
import { heavyEventOf, heavyStateOf } from '../heavy-contract';

// Closes only a plan folder that was read: `wigley:make` naming a folder not
// written yet keeps make until its plan.md is written.

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  enter(flow, signal) {
    const inRun = ['make', 'review', 'fix'].includes(flow.stage);
    const planWasRead = heavyStateOf(flow).progress !== null;
    const planGone = heavyEventOf(signal)?.type === 'planGone';
    return planGone && inRun && planWasRead ? 'closed' : null;
  },
};
