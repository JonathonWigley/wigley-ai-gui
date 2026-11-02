import type { MainStage } from '../../contract';

// Closes only a plan folder that was read: `wigley:make` naming a folder not
// written yet keeps make until its plan.md is written.

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  enter(flow, signal) {
    const inRun = flow.stage === 'make' || flow.stage === 'review';
    const planWasRead = flow.progress !== null;
    return signal.type === 'planGone' && inRun && planWasRead ? 'closed' : null;
  },
};
