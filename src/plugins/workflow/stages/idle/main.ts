import { IDLE_STAGE, type MainStage } from '../../contract';

export const idleMainStage: MainStage = {
  id: IDLE_STAGE,
  order: 0,
  enter(flow, signal) {
    const dismissedClosedRun =
      signal.type === 'dismissed' && flow.stage === 'closed';
    return signal.type === 'handedOff' || dismissedClosedRun
      ? IDLE_STAGE
      : null;
  },
};
