import type { MainStage } from '../../contract';

export const closedMainStage: MainStage = {
  id: 'closed',
  order: 60,
  enter(flow, signal) {
    const inRun = flow.stage === 'make' || flow.stage === 'review';
    return signal.type === 'planGone' && inRun ? 'closed' : null;
  },
};
